import type { Rect, Size } from './geometry';
import type { Direction } from './model';

export function nextPosition(source: Rect, dir: Direction, size: Size, gap = 80): { x: number; y: number } {
  const cx = source.x + source.w / 2;
  const cy = source.y + source.h / 2;
  switch (dir) {
    case 'right':
      return { x: source.x + source.w + gap, y: cy - size.h / 2 };
    case 'left':
      return { x: source.x - gap - size.w, y: cy - size.h / 2 };
    case 'down':
      return { x: cx - size.w / 2, y: source.y + source.h + gap };
    case 'up':
      return { x: cx - size.w / 2, y: source.y - gap - size.h };
  }
}

export function intersects(a: Rect, b: Rect, margin = 0): boolean {
  return a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;
}

export function findFreeSpot(
  pos: { x: number; y: number },
  size: Size,
  dir: Direction,
  occupied: readonly Rect[],
  step = 24,
): { x: number; y: number } {
  let spot = { ...pos };
  for (let i = 0; i < 50; i++) {
    const candidate = { ...spot, ...size };
    if (!occupied.some((other) => intersects(other, candidate, 12))) return spot;
    spot = dir === 'right' || dir === 'left' ? { x: spot.x, y: spot.y + size.h + step } : { x: spot.x + size.w + step, y: spot.y };
  }
  return spot;
}
