import { computeRects, copyElements, topLevel } from '@strukt/core';
import type { DiagramModel, LayoutState } from '@strukt/core';

/** Isolates selected components, including group contents, at their actual canvas positions. */
export function selectedDiagram(model: DiagramModel, layout: LayoutState, ids: string[]) {
  const clip = copyElements(model, layout, topLevel(model, ids));
  const elements = Object.fromEntries(clip.elements.map(el => [el.id, el]));
  const selected: DiagramModel = { ...model, elements, order: clip.elements.map(el => el.id), edges: clip.edges };
  const rects = computeRects(model, layout);
  return { model: selected, layout: { ...layout, nodes: clip.boxes }, rects: Object.fromEntries(selected.order.map(id => [id, rects[id]!])) };
}
