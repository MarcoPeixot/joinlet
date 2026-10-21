import type { Point } from '@strukt/layout';
import { clampBend } from '@strukt/workspace';

type Box = { x: number; y: number; w: number; h: number };
export type Side = 'left' | 'right' | 'top' | 'bottom';
/** The axis the middle segment moves along when dragged ('x' for H–V–H lines). */
export type BendAxis = 'x' | 'y';

export interface ConnectionRoute {
  points: Point[];
  sourceSide: Side;
  targetSide: Side;
  /** Midpoint of the middle segment: where its drag grip (and the label) sit. */
  handle: Point;
  axis: BendAxis;
}

/** Below this the two ends count as aligned and the middle segment goes away. */
const ALIGNED = 0.5;
/** Narrower than this, facing sides leave no room for the dot, the leads and the arrowhead. */
const MIN_GAP = 20;
/** How far past the cards the line goes around them, at bend 1 (16 px at the default bend). */
const AROUND = 32;

const center = (box: Box): Point => [box.x + box.w / 2, box.y + box.h / 2];

/**
 * Facing sides along the axis with room between the cards (≥ 20 px); with room on both axes, the one
 * where the centers are farther apart (horizontal on a tie). With room on neither (flush, narrow or
 * overlapping cards) the line goes around: under side-by-side cards, to the right of stacked ones.
 * `axis` is the one the middle run moves along when dragged.
 */
function planOf(a: Box, b: Box): { axis: BendAxis; around: boolean } {
  const roomX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)) >= MIN_GAP;
  const roomY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h)) >= MIN_GAP;
  const [ax, ay] = center(a);
  const [bx, by] = center(b);
  const wide = Math.abs(bx - ax) >= Math.abs(by - ay);
  if (roomX !== roomY) return { axis: roomX ? 'x' : 'y', around: false };
  if (roomX) return { axis: wide ? 'x' : 'y', around: false };
  return { axis: wide ? 'y' : 'x', around: true };
}

/** Where the line leaves `a` and enters `b` along `axis` (the facing sides), and whether it runs toward +axis. */
function span(a: Box, b: Box, axis: BendAxis): { from: number; to: number; forward: boolean } {
  const [lo, size] = axis === 'x' ? (['x', 'w'] as const) : (['y', 'h'] as const);
  const forward = b[lo] + b[size] / 2 >= a[lo] + a[size] / 2;
  return { from: forward ? a[lo] + a[size] : a[lo], to: forward ? b[lo] : b[lo] + b[size], forward };
}

/** The far side of both cards along `axis`: the outer run of a line going around them sits past it. */
const outerEdge = (a: Box, b: Box, axis: BendAxis) => (axis === 'x' ? Math.max(a.x + a.w, b.x + b.w) : Math.max(a.y + a.h, b.y + b.h));

/**
 * Elbow line between two cards (like IcePanel's): out of the side of `a` facing `b`, from the middle
 * of that side, into the facing side of `b`, with the middle segment at `bend` (0..1) of the gap.
 * Without room between them, out of one side of `a` and into the same side of `b`, around them, the
 * outer run `AROUND × bend` past both.
 */
export function connectionRoute(a: Box, b: Box, bend = 0.5): ConnectionRoute {
  const { axis, around } = planOf(a, b);
  const [ax, ay] = center(a);
  const [bx, by] = center(b);
  if (around) {
    const out = outerEdge(a, b, axis) + AROUND * bend;
    return axis === 'x'
      ? { points: [[a.x + a.w, ay], [out, ay], [out, by], [b.x + b.w, by]], sourceSide: 'right', targetSide: 'right', handle: [out, (ay + by) / 2], axis }
      : { points: [[ax, a.y + a.h], [ax, out], [bx, out], [bx, b.y + b.h]], sourceSide: 'bottom', targetSide: 'bottom', handle: [(ax + bx) / 2, out], axis };
  }
  const { from, to, forward } = span(a, b, axis);
  const mid = from + bend * (to - from);
  if (axis === 'x') {
    const start: Point = [from, ay];
    const end: Point = [to, by];
    return {
      points: Math.abs(by - ay) < ALIGNED ? [start, end] : [start, [mid, ay], [mid, by], end],
      sourceSide: forward ? 'right' : 'left',
      targetSide: forward ? 'left' : 'right',
      handle: [mid, (ay + by) / 2],
      axis,
    };
  }
  const start: Point = [ax, from];
  const end: Point = [bx, to];
  return {
    points: Math.abs(bx - ax) < ALIGNED ? [start, end] : [start, [ax, mid], [bx, mid], end],
    sourceSide: forward ? 'bottom' : 'top',
    targetSide: forward ? 'top' : 'bottom',
    handle: [(ax + bx) / 2, mid],
    axis,
  };
}

/** The bend that puts the middle run under the pointer (flow coordinates), clamped like `board.json`. */
export function bendFromPointer(a: Box, b: Box, pointer: { x: number; y: number }): number {
  const { axis, around } = planOf(a, b);
  const at = axis === 'x' ? pointer.x : pointer.y;
  let t: number;
  if (around) t = (at - outerEdge(a, b, axis)) / AROUND;
  else {
    const { from, to } = span(a, b, axis);
    t = (at - from) / (to - from);
  }
  return Number.isFinite(t) ? clampBend(t) : 0.5;
}
