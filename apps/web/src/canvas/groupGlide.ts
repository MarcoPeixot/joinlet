import type { ID, Rect } from '@strukt/core';

/** Time constant of the glide (ms): about 95% of the way after three of them. */
export const GLIDE_TAU = 70;

/**
 * One frame of a group gliding to `to`: each EDGE eases on its own (left, top, right, bottom), so an edge whose place
 * does not change never moves, however often the target changes on the way. Lands exactly within half a pixel.
 */
export function glideRect(from: Rect, to: Rect, dt: number, tau = GLIDE_TAU): Rect {
  const k = 1 - Math.exp(-Math.max(0, dt) / tau);
  const edge = (a: number, b: number) => (Math.abs(b - a) < 0.5 ? b : a + (b - a) * k);
  const left = edge(from.x, to.x);
  const top = edge(from.y, to.y);
  const right = edge(from.x + from.w, to.x + to.w);
  const bottom = edge(from.y + from.h, to.y + to.h);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

const same = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export interface GroupGlide {
  /** Glides the groups toward `targets`; one shown for the first time starts from `from` (where it is on screen). */
  to(targets: Record<ID, Rect>, from: Readonly<Record<ID, Rect>>): void;
  /** Like `to`, then `done` once every group has landed. */
  settle(targets: Record<ID, Rect>, from: Readonly<Record<ID, Rect>>, done: () => void): void;
  stop(): void;
}

/** Runs the glide frame by frame, handing `paint` the rects to draw the groups at. */
export function createGroupGlide(
  paint: (shown: Record<ID, Rect>) => void,
  frame: (tick: () => void) => number = requestAnimationFrame,
  cancel: (id: number) => void = cancelAnimationFrame,
  now: () => number = () => performance.now(),
): GroupGlide {
  let shown: Record<ID, Rect> = {};
  let targets: Record<ID, Rect> = {};
  let done: (() => void) | null = null;
  let pending = 0;
  let last = 0;
  const tick = () => {
    const t = now();
    const dt = Math.min(64, t - last);
    last = t;
    let moving = false;
    const next: Record<ID, Rect> = {};
    for (const [id, target] of Object.entries(targets)) {
      next[id] = glideRect(Object.hasOwn(shown, id) ? shown[id]! : target, target, dt);
      if (!same(next[id]!, target)) moving = true;
    }
    shown = next;
    paint(shown);
    if (moving) pending = frame(tick);
    else {
      pending = 0;
      const finished = done;
      done = null;
      finished?.();
    }
  };
  const to = (next: Record<ID, Rect>, from: Readonly<Record<ID, Rect>>) => {
    for (const id of Object.keys(next)) if (!Object.hasOwn(shown, id) && Object.hasOwn(from, id)) shown[id] = from[id]!;
    targets = next;
    done = null;
    if (!pending) {
      last = now();
      pending = frame(tick);
    }
  };
  return {
    to,
    settle(next, from, finished) {
      to(next, from);
      done = finished;
    },
    stop() {
      if (pending) cancel(pending);
      pending = 0;
      shown = {};
      targets = {};
      done = null;
    },
  };
}
