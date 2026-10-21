import { groupTitleBox } from '@strukt/core';
import type { DiagramModel, EdgeEl, GroupEl, ID, Port, Rect } from '@strukt/core';
import type { Point } from './route';

const EPS = 1e-6;
const cx = (r: Rect) => r.x + r.w / 2;
const cy = (r: Rect) => r.y + r.h / 2;
const near = (a: number, b: number) => Math.abs(a - b) < EPS;
const VECTORS: Record<Port, Point> = { right: [1, 0], bottom: [0, 1], left: [-1, 0], top: [0, -1] };

function crosses(a: Point, b: Point, r: Rect): boolean {
  return Math.min(a[0], b[0]) < r.x + r.w - EPS && Math.max(a[0], b[0]) > r.x + EPS && Math.min(a[1], b[1]) < r.y + r.h - EPS && Math.max(a[1], b[1]) > r.y + EPS;
}

function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out.at(-1), previous = out.at(-2);
    if (last && near(last[0], point[0]) && near(last[1], point[1])) continue;
    if (last && previous && ((near(last[0], point[0]) && near(previous[0], point[0]) && (point[1] - last[1]) * (last[1] - previous[1]) >= 0) || (near(last[1], point[1]) && near(previous[1], point[1]) && (point[0] - last[0]) * (last[0] - previous[0]) >= 0))) out.pop();
    out.push(point);
  }
  return out;
}

function faceAt(point: Point | undefined, r: Rect): Port | undefined {
  if (!point) return undefined;
  if (near(point[0], r.x)) return 'left';
  if (near(point[0], r.x + r.w)) return 'right';
  if (near(point[1], r.y)) return 'top';
  if (near(point[1], r.y + r.h)) return 'bottom';
  return undefined;
}

function preferredFaces(a: Rect, b: Rect): [Port, Port] {
  if (b.x >= a.x + a.w) return ['right', 'left'];
  if (a.x >= b.x + b.w) return ['left', 'right'];
  return cy(b) >= cy(a) ? ['bottom', 'top'] : ['top', 'bottom'];
}

function anchor(r: Rect, face: Port, header: boolean): Point {
  if (face === 'top' || face === 'bottom') return [cx(r), face === 'top' ? r.y : r.y + r.h];
  return [face === 'left' ? r.x : r.x + r.w, header ? r.y + 36 : cy(r)];
}

function followsFace(a: Point, b: Point, face: Port): boolean {
  const vector = VECTORS[face];
  return vector[0] ? near(a[1], b[1]) && (b[0] - a[0]) * vector[0] > EPS : near(a[0], b[0]) && (b[1] - a[1]) * vector[1] > EPS;
}

function segmentStats(points: readonly Point[], others: readonly Point[][]): { length: number; bends: number; crossings: number; overlaps: number } {
  let length = 0, crossings = 0, overlaps = 0;
  for (let i = 1; i < points.length; i++) length += Math.abs(points[i]![0] - points[i - 1]![0]) + Math.abs(points[i]![1] - points[i - 1]![1]);
  for (const other of others) {
    let coincident = false;
    for (let i = 1; i < points.length; i++) for (let j = 1; j < other.length; j++) {
      const a = points[i - 1]!, b = points[i]!, c = other[j - 1]!, d = other[j]!;
      const vertical = near(a[0], b[0]), otherVertical = near(c[0], d[0]);
      if (vertical !== otherVertical) {
        const v1 = vertical ? a : c, v2 = vertical ? b : d, h1 = vertical ? c : a, h2 = vertical ? d : b;
        if (v1[0] > Math.min(h1[0], h2[0]) + EPS && v1[0] < Math.max(h1[0], h2[0]) - EPS && h1[1] > Math.min(v1[1], v2[1]) + EPS && h1[1] < Math.max(v1[1], v2[1]) - EPS) crossings++;
      } else {
        const along = vertical ? 1 : 0, across = vertical ? 0 : 1;
        if (near(a[across], c[across]) && Math.min(Math.max(a[along], b[along]), Math.max(c[along], d[along])) > Math.max(Math.min(a[along], b[along]), Math.min(c[along], d[along])) + EPS) coincident = true;
      }
    }
    if (coincident) overlaps++;
  }
  return { length, bends: points.length - 2, crossings, overlaps };
}

function proposals(model: DiagramModel, rects: Readonly<Record<ID, Rect>>, edge: EdgeEl, old: readonly Point[] | undefined, geometricFaces = false): Point[][] {
  const a = rects[edge.from]!, b = rects[edge.to]!;
  const defaults = preferredFaces(a, b);
  const from = edge.fromPort ?? (geometricFaces ? defaults[0] : faceAt(old?.[0], a) ?? defaults[0]);
  const to = edge.toPort ?? (geometricFaces ? defaults[1] : faceAt(old?.at(-1), b) ?? defaults[1]);
  const start = old?.[0] && faceAt(old[0], a) === from ? old[0] : anchor(a, from, model.elements[edge.from]?.kind === 'group');
  const end = old?.at(-1) && faceAt(old.at(-1), b) === to ? old.at(-1)! : anchor(b, to, model.elements[edge.to]?.kind === 'group');
  const pairs: [Point, Point][] = [[start, end]];
  if (model.elements[edge.from]?.kind === 'group' || model.elements[edge.to]?.kind === 'group') {
    pairs.push([model.elements[edge.from]?.kind === 'group' ? anchor(a, from, true) : start, model.elements[edge.to]?.kind === 'group' ? anchor(b, to, true) : end]);
  }
  const out: Point[][] = [];
  const horizontal = (from === 'right' || from === 'left') && (to === 'right' || to === 'left');
  const vertical = (from === 'top' || from === 'bottom') && (to === 'top' || to === 'bottom');
  if (horizontal && from !== to && model.elements[edge.from]?.kind === 'node' && model.elements[edge.to]?.kind === 'node') {
    const lo = Math.max(a.y, b.y) + 12, hi = Math.min(a.y + a.h, b.y + b.h) - 12;
    if (hi >= lo) for (const y of new Set([start[1], end[1], (lo + hi) / 2, lo + (hi - lo) / 3, lo + (hi - lo) * 2 / 3])) {
      if (y >= lo && y <= hi) out.push([[start[0], y], [end[0], y]]);
    }
  }
  if (vertical && from !== to && model.elements[edge.from]?.kind === 'node' && model.elements[edge.to]?.kind === 'node') {
    const lo = Math.max(a.x, b.x) + 12, hi = Math.min(a.x + a.w, b.x + b.w) - 12;
    if (hi >= lo) for (const x of new Set([start[0], end[0], (lo + hi) / 2, lo + (hi - lo) / 3, lo + (hi - lo) * 2 / 3])) {
      if (x >= lo && x <= hi) out.push([[x, start[1]], [x, end[1]]]);
    }
  }
  for (const [s, t] of pairs) {
    out.push([s, [t[0], s[1]], t], [s, [s[0], t[1]], t]);
    if (horizontal) {
      const tracks = from !== to ? [(s[0] + t[0]) / 2, s[0] + VECTORS[from][0] * 12, t[0] + VECTORS[to][0] * 12] : [12, 20, 28].map((offset) => from === 'right' ? Math.max(s[0], t[0]) + offset : Math.min(s[0], t[0]) - offset);
      for (const x of tracks) out.push([s, [x, s[1]], [x, t[1]], t]);
    }
    if (vertical) {
      const tracks = from !== to ? [(s[1] + t[1]) / 2, s[1] + VECTORS[from][1] * 12, t[1] + VECTORS[to][1] * 12] : [12, 20, 28].map((offset) => from === 'bottom' ? Math.max(s[1], t[1]) + offset : Math.min(s[1], t[1]) - offset);
      for (const y of tracks) out.push([s, [s[0], y], [t[0], y], t]);
    }
  }
  return out.map(simplify).filter((points) => points.length >= 2 && followsFace(points[0]!, points[1]!, from) && followsFace(points.at(-1)!, points.at(-2)!, to));
}

/** Shortcuts in compact stacks keep the generic router's safe paths and improve them without metric regressions. */
export function groupCompositionRoutes(model: DiagramModel, rects: Readonly<Record<ID, Rect>>, baseline: Readonly<Record<ID, Point[]>> = {}): Record<ID, Point[]> {
  const groups = model.order.filter((id) => model.elements[id]?.kind === 'group' && rects[id]);
  const cards = model.order.filter((id) => model.elements[id]?.kind === 'node' && rects[id]);
  if (groups.length < 2 || cards.length < 3 || cards.some((id) => {
    const node = model.elements[id];
    return node?.kind !== 'node' || node.presentation !== 'card' || node.shape;
  })) return {};
  if (groups.some((id) => {
    const children = cards.filter((child) => model.elements[child]!.parentId === id);
    return children.some((child) => Math.abs(rects[child]!.x - rects[children[0]!]!.x) > 1);
  })) return {};
  const obstacles = [...cards.map((id) => rects[id]!), ...groups.map((id) => groupTitleBox(model.elements[id] as GroupEl, rects[id]!))];
  const safe = (points: readonly Point[]) => points.length >= 2 && points.slice(1).every((point, i) => (near(point[0], points[i]![0]) || near(point[1], points[i]![1])) && !obstacles.some((r) => crosses(points[i]!, point, r)));
  const current = { ...baseline }, out: Record<ID, Point[]> = {};
  for (const edge of model.edges) {
    if (!rects[edge.from] || !rects[edge.to] || edge.from === edge.to) continue;
    const old = current[edge.id], others = Object.entries(current).filter(([id]) => id !== edge.id).map(([, points]) => points);
    const oldStats = old ? segmentStats(old, others) : undefined;
    const keepSafe = old && safe(old) && (!edge.fromPort || faceAt(old[0], rects[edge.from]!) === edge.fromPort && followsFace(old[0]!, old[1]!, edge.fromPort)) && (!edge.toPort || faceAt(old.at(-1), rects[edge.to]!) === edge.toPort && followsFace(old.at(-1)!, old.at(-2)!, edge.toPort));
    let best = oldStats, chosen: Point[] | undefined;
    for (const points of [...proposals(model, rects, edge, old), ...proposals(model, rects, edge, old, true)]) {
      if (!safe(points)) continue;
      const stats = segmentStats(points, others);
      if (keepSafe && oldStats && (stats.length > oldStats.length + EPS || stats.bends > oldStats.bends || stats.crossings > oldStats.crossings || stats.overlaps > oldStats.overlaps)) continue;
      if (!best || !keepSafe && !chosen || stats.overlaps < best.overlaps || stats.overlaps === best.overlaps && (stats.crossings < best.crossings || stats.crossings === best.crossings && (stats.bends < best.bends || stats.bends === best.bends && stats.length < best.length - EPS))) {
        chosen = points;
        best = stats;
      }
    }
    if (chosen) { out[edge.id] = chosen; current[edge.id] = chosen; }
  }
  return out;
}
