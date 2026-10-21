import type { Rect } from './geometry';

export interface SnapGuide {
  axis: 'x' | 'y';
  pos: number;
  from: number;
  to: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

const xLines = (r: Rect) => [r.x, r.x + r.w / 2, r.x + r.w];
const yLines = (r: Rect) => [r.y, r.y + r.h / 2, r.y + r.h];

function best(moving: number[], others: readonly Rect[], lines: (r: Rect) => number[], threshold: number) {
  let found: { delta: number; pos: number } | null = null;
  for (const other of others) {
    for (const a of moving) {
      for (const b of lines(other)) {
        const delta = b - a;
        if (Math.abs(delta) <= threshold && (!found || Math.abs(delta) < Math.abs(found.delta))) found = { delta, pos: b };
      }
    }
  }
  return found;
}

/** Aligns edges/centers of `moving` with nearby rects (Figma-style smart guides). */
export function snapRect(moving: Rect, others: readonly Rect[], threshold = 6): SnapResult {
  const bx = best(xLines(moving), others, xLines, threshold);
  const by = best(yLines(moving), others, yLines, threshold);
  const snapped: Rect = { ...moving, x: moving.x + (bx?.delta ?? 0), y: moving.y + (by?.delta ?? 0) };
  const guides: SnapGuide[] = [];
  if (bx) {
    const aligned = [snapped, ...others.filter((r) => xLines(r).some((v) => Math.abs(v - bx.pos) < 0.5))];
    guides.push({ axis: 'x', pos: bx.pos, from: Math.min(...aligned.map((r) => r.y)), to: Math.max(...aligned.map((r) => r.y + r.h)) });
  }
  if (by) {
    const aligned = [snapped, ...others.filter((r) => yLines(r).some((v) => Math.abs(v - by.pos) < 0.5))];
    guides.push({ axis: 'y', pos: by.pos, from: Math.min(...aligned.map((r) => r.x)), to: Math.max(...aligned.map((r) => r.x + r.w)) });
  }
  return { x: snapped.x, y: snapped.y, guides };
}
