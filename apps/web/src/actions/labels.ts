import { own } from '@strukt/core';
import type { ID } from '@strukt/core';
import { diagramStore } from '../state/appStore';
import type { DiagramStore } from '../state/diagramStore';
import { collaborationSession } from '../workspace/boot';

/**
 * Canvas label edits keep the DSL clean: an element still named by its label is renamed;
 * otherwise (name taken, or a custom label already exists) only the label changes. `renames: false` (the Overview,
 * whose ids are the board's) only ever changes the label.
 */
export function commitLabel(id: ID, raw: string, store: DiagramStore = diagramStore, renames = true): void {
  const value = raw.trim();
  const state = store.getState();
  const el = own(state.model.elements, id);
  if (!el || !value || value === (el.label ?? el.id)) return;
  // Shared room: ids are the merge key, so a rename would fork concurrent edits of the same node.
  if (renames && el.label === undefined && !collaborationSession() && !own(state.model.elements, value)) {
    state.apply([{ op: 'rename', id, to: value }]);
    return;
  }
  state.apply([{ op: 'update', id, set: { label: value === el.id ? null : value } }]);
}
