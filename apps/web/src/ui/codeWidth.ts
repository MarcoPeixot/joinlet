export const CODE_WIDTH = { initial: 400, min: 300, max: 760, canvasRoom: 520 } as const;

/** Width of the docked code panel: within its bounds, and never squeezing the canvas below `canvasRoom`. */
export function clampCodeWidth(width: number, viewport: number): number {
  if (!Number.isFinite(width)) return CODE_WIDTH.initial;
  const max = Math.max(CODE_WIDTH.min, Math.min(CODE_WIDTH.max, viewport - CODE_WIDTH.canvasRoom));
  return Math.round(Math.min(max, Math.max(CODE_WIDTH.min, width)));
}
