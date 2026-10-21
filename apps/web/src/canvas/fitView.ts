export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** True when `bounds` (flow coordinates) sits entirely inside the viewport `[tx, ty, zoom]` of a `width`×`height` pane. */
export function boundsFitViewport(bounds: Box | null, [tx, ty, zoom]: readonly [number, number, number], width: number, height: number): boolean {
  if (!bounds) return true;
  if (width <= 0 || height <= 0 || zoom <= 0) return false;
  const left = -tx / zoom;
  const top = -ty / zoom;
  return bounds.x >= left && bounds.y >= top && bounds.x + bounds.w <= left + width / zoom && bounds.y + bounds.h <= top + height / zoom;
}
