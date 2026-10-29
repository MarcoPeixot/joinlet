import type { Point } from '@strukt/layout';

/** How long a connection takes to glide to the route the router just found. */
export const ROUTE_TWEEN_MS = 240;

/** Splits the longest segments at their midpoints until the route has `count` vertices (same shape, more corners). */
function padTo(points: readonly Point[], count: number): Point[] {
  const out = points.map((p) => [p[0], p[1]] as Point);
  while (out.length < count) {
    let at = 1;
    let longest = -1;
    for (let i = 1; i < out.length; i++) {
      const length = Math.hypot(out[i]![0] - out[i - 1]![0], out[i]![1] - out[i - 1]![1]);
      if (length > longest) { longest = length; at = i; }
    }
    const a = out[at - 1]!, b = out[at]!;
    out.splice(at, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  return out;
}

/** Both routes with the same number of vertices, so each corner of one can travel to a corner of the other. */
export function matchRoutes(from: readonly Point[], to: readonly Point[]): [Point[], Point[]] {
  const count = Math.max(from.length, to.length);
  return [padTo(from, count), padTo(to, count)];
}

export const lerpPoint = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** The route `t` of the way (0–1) between two matched routes. */
export function lerpRoute(from: readonly Point[], to: readonly Point[], t: number): Point[] {
  return to.map((point, i) => lerpPoint(from[i] ?? point, point, t));
}

/** Fast start, gentle landing. */
export const easeOut = (t: number) => 1 - (1 - t) ** 3;
