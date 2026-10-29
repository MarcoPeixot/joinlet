import type { Rect } from '@strukt/core';

export type Point = [number, number];
export type Side = 'top' | 'right' | 'bottom' | 'left';

export interface Route {
  points: Point[];
  sourceSide: Side;
  targetSide: Side;
}

/** Minimum shared span for a straight connector instead of an elbow. */
const MIN_OVERLAP = 16;
/** How far past two touching boxes the line that goes around them runs. */
const AROUND = 16;

/**
 * Obstacle-unaware orthogonal route between two boxes (M1).
 * M2 replaces callers with @eraserlabs/layout behind an EdgeRouter interface.
 */
export function routeOrthogonal(a: Rect, b: Rect): Route {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  const toRight = bx >= ax;
  const toBottom = by >= ay;
  const gapX = toRight ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
  const gapY = toBottom ? b.y - (a.y + a.h) : a.y - (b.y + b.h);
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const hSides: [Side, Side] = toRight ? ['right', 'left'] : ['left', 'right'];
  const vSides: [Side, Side] = toBottom ? ['bottom', 'top'] : ['top', 'bottom'];
  const sx = toRight ? a.x + a.w : a.x;
  const tx = toRight ? b.x : b.x + b.w;
  const sy = toBottom ? a.y + a.h : a.y;
  const ty = toBottom ? b.y : b.y + b.h;

  if (gapX > 0 && overlapY >= MIN_OVERLAP) {
    const y = Math.max(a.y, b.y) + overlapY / 2;
    return { points: [[sx, y], [tx, y]], sourceSide: hSides[0], targetSide: hSides[1] };
  }
  if (gapY > 0 && overlapX >= MIN_OVERLAP) {
    const x = Math.max(a.x, b.x) + overlapX / 2;
    return { points: [[x, sy], [x, ty]], sourceSide: vSides[0], targetSide: vSides[1] };
  }
  const horizontal = gapX > 0 && (gapY <= 0 || Math.abs(bx - ax) >= Math.abs(by - ay));
  if (horizontal) {
    const mx = (sx + tx) / 2;
    return { points: [[sx, ay], [mx, ay], [mx, by], [tx, by]], sourceSide: hSides[0], targetSide: hSides[1] };
  }
  if (gapY > 0) {
    const my = (sy + ty) / 2;
    return { points: [[ax, sy], [ax, my], [bx, my], [bx, ty]], sourceSide: vSides[0], targetSide: vSides[1] };
  }
  // Touching or overlapping: no room between them, so the line goes around both (a straight one would run under
  // them, hidden), out of and into the same side: to the right of stacked boxes, under side-by-side ones.
  if (Math.abs(bx - ax) < Math.abs(by - ay)) {
    const out = Math.max(a.x + a.w, b.x + b.w) + AROUND;
    return { points: [[a.x + a.w, ay], [out, ay], [out, by], [b.x + b.w, by]], sourceSide: 'right', targetSide: 'right' };
  }
  const out = Math.max(a.y + a.h, b.y + b.h) + AROUND;
  return { points: [[ax, a.y + a.h], [ax, out], [bx, out], [bx, b.y + b.h]], sourceSide: 'bottom', targetSide: 'bottom' };
}
