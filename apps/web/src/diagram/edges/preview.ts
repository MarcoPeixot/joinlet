import type { Rect } from '@strukt/core';
import { routeOrthogonal } from '@strukt/layout';
import type { Point } from '@strukt/layout';

/**
 * The connection being dragged, drawn like the edge it will become: over a target it is exactly the line the new
 * edge shows the moment it is created (`cachedRoute`'s fallback for an edge without a route yet), so releasing
 * changes nothing; elsewhere it elbows from the source border to the pointer the same way.
 */
export function previewRoute(from: Rect, to: Rect | Point): Point[] {
  if (!Array.isArray(to)) return routeOrthogonal(from, to).points;
  const [x, y] = to;
  // Still over the source: nothing to draw yet.
  if (x >= from.x && x <= from.x + from.w && y >= from.y && y <= from.y + from.h) return [];
  // Straight out of the facing side while the pointer is level with the source, never a 1 px step.
  if (x >= from.x && x <= from.x + from.w && (y < from.y || y > from.y + from.h)) return [[x, y < from.y ? from.y : from.y + from.h], [x, y]];
  if (y >= from.y && y <= from.y + from.h && (x < from.x || x > from.x + from.w)) return [[x < from.x ? from.x : from.x + from.w, y], [x, y]];
  return routeOrthogonal(from, { x, y, w: 0, h: 0 }).points;
}
