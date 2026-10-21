import type { DiagramOp } from '@strukt/core';
import { EXAMPLE_OPS, EXAMPLE_POSITIONS } from '../samples/example';
import { diagramStore } from '../state/appStore';

/** Replaces the current diagram in one undoable step. */
export function loadExample(): void {
  const state = diagramStore.getState();
  const roots = state.model.order.filter((id) => !state.model.elements[id]?.parentId);
  state.apply([...roots.map((id): DiagramOp => ({ op: 'remove', id })), ...EXAMPLE_OPS], EXAMPLE_POSITIONS);
}
