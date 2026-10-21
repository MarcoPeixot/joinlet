import { descendantsOf, snapRect } from '@strukt/core';
import type { DiagramModel, ID, Rect, SnapGuide } from '@strukt/core';

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

/**
 * Snaps a single dragged element's proposed absolute position (`x`, `y`) against every
 * other rect, ignoring the element itself, its descendants, and its ancestor chain (a
 * group can't snap against the rects it contains, or against itself).
 */
export function snapDraggedRect(model: DiagramModel, rects: Readonly<Record<ID, Rect>>, id: ID, x: number, y: number): SnapResult {
  const current = rects[id];
  if (!current) return { x, y, guides: [] };
  const exclude = new Set([id, ...descendantsOf(model, id)]);
  for (let p = model.elements[id]?.parentId; p; p = model.elements[p]?.parentId) exclude.add(p);
  const others = Object.entries(rects)
    .filter(([rid]) => !exclude.has(rid))
    .map(([, r]) => r);
  return snapRect({ x, y, w: current.w, h: current.h }, others);
}
