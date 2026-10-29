export type TooltipSide = 'top' | 'right' | 'bottom' | 'left';

interface Box { x: number; y: number; w: number; h: number }

const OPPOSITE: Record<TooltipSide, TooltipSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/**
 * Where the bubble goes: `offset` px off the asked side of its trigger, centered on it, flipped to the other side
 * when it would leave the viewport, and kept `padding` px inside it along the other axis.
 */
export function placeTooltip(
  anchor: Box,
  size: { w: number; h: number },
  side: TooltipSide,
  viewport: { w: number; h: number },
  offset = 7,
  padding = 8,
): { x: number; y: number; side: TooltipSide } {
  const at = (s: TooltipSide) => ({
    top: { x: anchor.x + anchor.w / 2 - size.w / 2, y: anchor.y - offset - size.h },
    bottom: { x: anchor.x + anchor.w / 2 - size.w / 2, y: anchor.y + anchor.h + offset },
    left: { x: anchor.x - offset - size.w, y: anchor.y + anchor.h / 2 - size.h / 2 },
    right: { x: anchor.x + anchor.w + offset, y: anchor.y + anchor.h / 2 - size.h / 2 },
  })[s];
  const fits = (s: TooltipSide) => {
    const p = at(s);
    return s === 'top' || s === 'bottom' ? p.y >= padding && p.y + size.h <= viewport.h - padding : p.x >= padding && p.x + size.w <= viewport.w - padding;
  };
  const chosen = fits(side) || !fits(OPPOSITE[side]) ? side : OPPOSITE[side];
  const p = at(chosen);
  const clamp = (v: number, length: number, total: number) => Math.max(padding, Math.min(v, total - padding - length));
  return chosen === 'top' || chosen === 'bottom'
    ? { x: clamp(p.x, size.w, viewport.w), y: p.y, side: chosen }
    : { x: p.x, y: clamp(p.y, size.h, viewport.h), side: chosen };
}
