import type { Box } from './fitView';

export const MINIMAP_SIZE = { width: 168, height: 96 } as const;

/** Frame the diagram itself: moving the viewport must not shrink or shift its miniature. */
export function miniMapTransform(boxes: readonly Box[], width = MINIMAP_SIZE.width, height = MINIMAP_SIZE.height, padding = 10) {
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  const bounds = { x: left, y: top, w: right - left, h: bottom - top };
  const scale = Math.min((width - padding * 2) / Math.max(bounds.w, 1), (height - padding * 2) / Math.max(bounds.h, 1));
  return { bounds, scale, x: (width - bounds.w * scale) / 2 - left * scale, y: (height - bounds.h * scale) / 2 - top * scale };
}
