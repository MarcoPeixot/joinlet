import type { ID, Rect } from '@strukt/core';
import type { Point } from './route';

/** Rough advance width, ~0.56 em per character: the canvas measures real text, placement and export estimate. */
export const textWidth = (text: string, fontSize: number) => text.length * fontSize * 0.56;

/** An edge label's pill: 12 px text with 6 px padding each side (`.strukt-edge-label`), 20 px tall like the export. */
export function edgeLabelSize(text: string): { w: number; h: number } {
  return { w: textWidth(text, 12) + 12, h: 20 };
}

export interface LabelRequest {
  id: ID;
  points: readonly Point[];
  w: number;
  h: number;
}

export interface LabelObstacles {
  /** Node boxes (icon nodes with their name). */
  boxes: readonly Rect[];
  /** Group rects: labels keep off a band around their border. */
  borders?: readonly Rect[];
  /** Other connectors should remain visible through the label's surrounding space. */
  routes?: Readonly<Record<ID, readonly Point[]>>;
}

/** Half-width of the band around a group border that labels keep off. */
export const BORDER_BAND = 6;
/** Distance between the spots tried along a segment. */
const STEP = 8;
const MAX_ROUTE_OBSTACLES = 150;

const area = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const inset = (r: Rect, d: number): Rect => ({ x: r.x + d, y: r.y + d, w: Math.max(0, r.w - 2 * d), h: Math.max(0, r.h - 2 * d) });

/** How much of `box` lies within `BORDER_BAND` of the rect's border. */
const bandArea = (box: Rect, r: Rect) => area(box, inset(r, -BORDER_BAND)) - area(box, inset(r, BORDER_BAND));

/**
 * Label centers to try, best first: the longest segment before the shorter ones, and on each segment its
 * middle, then 8 px steps either way while the label stays within the segment.
 */
function candidates(points: readonly Point[], w: number, h: number, includeNearby: boolean, avoidRoutes = false): Point[] {
  const segments = points
    .slice(1)
    .map((b, i) => ({ a: points[i]!, b, length: Math.hypot(b[0] - points[i]![0], b[1] - points[i]![1]) }))
    .filter((s) => s.length > 0)
    .sort((s, t) => t.length - s.length);
  const out: Point[] = [];
  const nearby: Point[] = [];
  for (const { a, b, length } of segments) {
    const ux = (b[0] - a[0]) / length;
    const uy = (b[1] - a[1]) / length;
    const half = Math.abs(ux) * (w / 2) + Math.abs(uy) * (h / 2);
    const room = Math.max(0, length / 2 - half);
    for (let k = 0; k * STEP <= room; k++) {
      for (const d of k ? [k * STEP, -k * STEP] : [0]) {
        const at: Point = [a[0] + ux * (length / 2 + d), a[1] + uy * (length / 2 + d)];
        out.push(at);
        if (includeNearby) for (const shift of avoidRoutes ? [4, 8, 12, 16, 24, 32, 48, 64, 80] : [4, 8, 12, 16]) {
          nearby.push([at[0] - uy * shift, at[1] + ux * shift], [at[0] + uy * shift, at[1] - ux * shift]);
        }
      }
    }
  }
  return includeNearby ? [...out, ...nearby] : out;
}

/**
 * Places edge labels on their routes, in order, so they overlap neither node boxes, group borders nor
 * the labels placed before them: the first clear spot among the candidates, or else the one overlapping
 * least. Routes with fewer than 2 points get no label position.
 */
export function placeLabels(requests: readonly LabelRequest[], obstacles: LabelObstacles): Record<ID, Point> {
  const placed: Rect[] = [];
  const out: Record<ID, Point> = {};
  const routes = Object.entries(obstacles.routes ?? {});
  const avoidRoutes = routes.length > 0 && routes.length <= MAX_ROUTE_OBSTACLES;
  const routeBoxes = (avoidRoutes ? routes : []).flatMap(([id, points]) => points.slice(1).map((point, index) => ({
    id,
    box: { x: Math.min(points[index]![0], point[0]) - 1, y: Math.min(points[index]![1], point[1]) - 1, w: Math.abs(points[index]![0] - point[0]) + 2, h: Math.abs(points[index]![1] - point[1]) + 2 },
  })));
  for (const { id, points, w, h } of requests) {
    let best: { at: Point; box: Rect; cost: number; routeCost: number } | null = null;
    for (const at of candidates(points, w, h, placed.length > 0 || avoidRoutes, avoidRoutes)) {
      const box = { x: at[0] - w / 2, y: at[1] - h / 2, w, h };
      let cost = 0;
      for (const r of obstacles.boxes) cost += area(box, r);
      for (const r of obstacles.borders ?? []) cost += bandArea(box, r);
      for (const r of placed) cost += area(box, r);
      let routeCost = 0;
      for (const route of routeBoxes) if (route.id !== id) routeCost += area(box, route.box);
      if (!best || cost < best.cost || cost === best.cost && routeCost < best.routeCost) best = { at, box, cost, routeCost };
      if (cost === 0 && routeCost === 0) break;
    }
    if (!best) continue;
    out[id] = best.at;
    placed.push(best.box);
  }
  return out;
}
