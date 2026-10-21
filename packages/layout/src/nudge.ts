import type { ID, Rect } from '@strukt/core';
import type { Point } from './route';

/**
 * Minimum distance between parallel runs of different connections. The corridor router keeps its own
 * tracks 8 px apart (a constant it does not expose), which reads as two lines stuck together.
 */
export const PARALLEL_GAP = 12;

interface Run {
  route: ID;
  /** Index of the segment's first point; the segment is points[index] → points[index + 1]. */
  index: number;
  /** x of a vertical run, y of a horizontal one. */
  coord: number;
  lo: number;
  hi: number;
  /** Where the neighbours sit across the run: runs turning in from the left (or top) go first. */
  side: number;
}

const EPS = 1e-6;

/** True when an axis-aligned segment enters the rect's interior. */
function crosses([ax, ay]: Point, [bx, by]: Point, r: Rect): boolean {
  return Math.min(ax, bx) < r.x + r.w && Math.max(ax, bx) > r.x && Math.min(ay, by) < r.y + r.h && Math.max(ay, by) > r.y;
}

/** A joining segment must keep its direction and not shrink below 8 px (or its own length, if shorter). */
const folds = (before: number, after: number) => Math.sign(before) !== Math.sign(after) || Math.abs(after) < Math.min(8, Math.abs(before)) - EPS;

/** Interior runs only: the first and last segments attach to the nodes and stay where the router put them. */
function runsOf(routes: Readonly<Record<ID, Point[]>>, vertical: boolean): Run[] {
  const [along, across] = vertical ? [1, 0] : [0, 1];
  const runs: Run[] = [];
  for (const [route, points] of Object.entries(routes)) {
    for (let index = 1; index + 2 < points.length; index++) {
      const a = points[index]!;
      const b = points[index + 1]!;
      if (Math.abs(a[across] - b[across]) > EPS || Math.abs(a[along] - b[along]) < EPS) continue;
      const side = (points[index - 1]![across] + points[index + 2]![across]) / 2;
      runs.push({ route, index, coord: a[across], lo: Math.min(a[along], b[along]), hi: Math.max(a[along], b[along]), side });
    }
  }
  return runs;
}

/** Runs of different routes closer than `gap` whose spans overlap, grouped transitively. */
function clusters(runs: readonly Run[], gap: number): Run[][] {
  const parent = runs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const a = runs[i]!;
      const b = runs[j]!;
      if (a.route !== b.route && Math.abs(a.coord - b.coord) < gap - EPS && Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > EPS) {
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map<number, Run[]>();
  runs.forEach((run, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), run]));
  return [...groups.values()].filter((group) => group.length > 1);
}

/**
 * Spreads parallel runs of different connections that are closer than `gap` (and overlap along their
 * length) to exactly `gap` apart, around the middle of each group. A group stays as it was when moving
 * any of its runs, or the segments joining them, would enter an obstacle they did not already cross (a
 * last segment does cross its own node's label box on the way to the icon), or when a joining segment
 * would fold back (a short lead turning back into its node). Returns new arrays only for the routes it changed.
 */
export function nudgeParallels(routes: Readonly<Record<ID, Point[]>>, obstacles: readonly Rect[], gap = PARALLEL_GAP): Record<ID, Point[]> {
  const out: Record<ID, Point[]> = { ...routes };
  for (const vertical of [true, false]) {
    const across = vertical ? 0 : 1;
    for (const group of clusters(runsOf(out, vertical), gap)) {
      group.sort((a, b) => a.coord - b.coord || a.side - b.side);
      const middle = (group[0]!.coord + group[group.length - 1]!.coord) / 2;
      const moved = new Map<ID, Point[]>();
      const pointsOf = (route: ID) => moved.get(route) ?? out[route]!.map((p): Point => [p[0], p[1]]);
      for (const [k, run] of group.entries()) {
        const points = pointsOf(run.route);
        const coord = middle + (k - (group.length - 1) / 2) * gap;
        points[run.index]![across] = coord;
        points[run.index + 1]![across] = coord;
        moved.set(run.route, points);
      }
      const blocked = group.some((run) => {
        const points = moved.get(run.route)!;
        const before = out[run.route]!;
        const joins = [run.index - 1, run.index + 1];
        return (
          [run.index - 1, run.index, run.index + 1].some((i) =>
            obstacles.some((r) => crosses(points[i]!, points[i + 1]!, r) && !crosses(before[i]!, before[i + 1]!, r)),
          ) ||
          joins.some((i) => folds(before[i]![across] - before[i + 1]![across], points[i]![across] - points[i + 1]![across]))
        );
      });
      if (!blocked) for (const [route, points] of moved) out[route] = points;
    }
  }
  return out;
}
