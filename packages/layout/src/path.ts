import type { Point } from './route';

const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (p: Point) => `${r2(p[0])} ${r2(p[1])}`;
const dist = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function towards(from: Point, to: Point, len: number): Point {
  const d = dist(from, to) || 1;
  return [from[0] + ((to[0] - from[0]) / d) * len, from[1] + ((to[1] - from[1]) / d) * len];
}

/** SVG path with each interior corner rounded (Eraser "elbow" corners). */
export function roundedPath(points: readonly Point[], radius = 8): string {
  if (points.length === 0) return '';
  let d = `M ${fmt(points[0])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const r = Math.min(radius, dist(prev, cur) / 2, dist(cur, next) / 2);
    if (r < 0.5) {
      d += ` L ${fmt(cur)}`;
      continue;
    }
    d += ` L ${fmt(towards(cur, prev, r))} Q ${fmt(cur)} ${fmt(towards(cur, next, r))}`;
  }
  if (points.length > 1) d += ` L ${fmt(points[points.length - 1])}`;
  return d;
}

export function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}

export function pointAtHalf(points: readonly Point[]): Point {
  if (points.length === 0) return [0, 0];
  let remaining = polylineLength(points) / 2;
  for (let i = 1; i < points.length; i++) {
    const segment = dist(points[i - 1], points[i]);
    if (segment >= remaining) return towards(points[i - 1], points[i], remaining);
    remaining -= segment;
  }
  return points[points.length - 1];
}

export function trimEnd(points: readonly Point[], len: number): Point[] {
  const out = [...points];
  if (out.length < 2) return out;
  const last = out.length - 1;
  out[last] = towards(out[last], out[last - 1], Math.min(len, dist(out[last - 1], out[last])));
  return out;
}

export function trimStart(points: readonly Point[], len: number): Point[] {
  return trimEnd([...points].reverse(), len).reverse();
}

/** Filled triangle whose tip sits on `tip`, pointing away from `from`. */
export function arrowHead(tip: Point, from: Point, size = 10): string {
  const d = dist(from, tip) || 1;
  const ux = (tip[0] - from[0]) / d;
  const uy = (tip[1] - from[1]) / d;
  const bx = tip[0] - ux * size;
  const by = tip[1] - uy * size;
  const half = size * 0.45;
  return `M ${fmt(tip)} L ${fmt([bx - uy * half, by + ux * half])} L ${fmt([bx + uy * half, by - ux * half])} Z`;
}
