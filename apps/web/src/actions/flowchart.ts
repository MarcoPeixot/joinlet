import { uiText } from '../i18n';
import { computeRects, defaultSize, findFreeSpot, nextPosition, nodeVariant } from '@strukt/core';
import type { Direction, Rect } from '@strukt/core';
import { diagramStore } from '../state/appStore';
import { uiStore } from '../ui/uiStore';
import { newElementIdentity } from './elements';

/** ⌘+arrow: creates a node like the selected one in that direction, already connected (Excalidraw flowchart UX). */
export function flowchartStep(dir: Direction): void {
  const state = diagramStore.getState();
  if (state.selection.nodes.length !== 1) return;
  const sourceId = state.selection.nodes[0];
  const source = state.model.elements[sourceId];
  if (source?.kind !== 'node') return;
  const rects = computeRects(state.model, state.layout);
  const from = rects[sourceId];
  if (!from) return;
  const size = defaultSize(source);
  const occupied = state.model.order
    .filter((id) => state.model.elements[id]?.kind === 'node')
    .map((id) => rects[id])
    .filter((r): r is Rect => Boolean(r));
  const spot = findFreeSpot(nextPosition(from, dir, size), size, dir, occupied);
  const { id, label } = newElementIdentity(nodeVariant(source) === 'icon' ? uiText("Serviço") : uiText("Nó"));
  const ok = state.apply(
    [
      { op: 'add_node', id, label, parentId: source.parentId, shape: source.shape, icon: source.icon, color: source.color },
      { op: 'connect', from: sourceId, to: id },
    ],
    { [id]: { x: Math.round(spot.x), y: Math.round(spot.y) } },
  );
  if (ok) {
    state.select({ nodes: [id], edges: [] });
    uiStore.setState({ editingId: id });
  }
}
