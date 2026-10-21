import { VIEW_LOCK } from './locks';
import type { DiagramStore } from './diagramStore';

/**
 * Keeps a diagram store read-only for the session of a read-only link: whoever releases its own lock (a draft, a
 * presentation, the wait for the room) hands the store back to this one, never to "free". Returns the undo.
 */
export function enforceViewOnly(store: DiagramStore): () => void {
  if (!store.getState().readOnly) store.setState({ readOnly: VIEW_LOCK });
  const stop = store.subscribe((state) => {
    if (state.readOnly === null) store.setState({ readOnly: VIEW_LOCK });
  });
  return () => {
    stop();
    if (store.getState().readOnly === VIEW_LOCK) store.setState({ readOnly: null });
  };
}
