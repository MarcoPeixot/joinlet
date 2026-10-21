import { describe, expect, it } from 'vitest';
import { createDiagramStore } from './diagramStore';
import { COLLAB_WAITING_LOCK, DRAFT_LOCK, VIEW_LOCK } from './locks';
import { enforceViewOnly } from './viewOnly';

const node = [{ op: 'add_node' as const, id: 'A' }];

describe('view-only store', () => {
  it('refuses edits from the start', () => {
    const store = createDiagramStore();
    enforceViewOnly(store);
    expect(store.getState().readOnly).toBe(VIEW_LOCK);
    expect(store.getState().apply(node)).toBe(false);
    expect(store.getState().model.order).toEqual([]);
  });

  it('takes the lock back whenever another owner releases its own', () => {
    const store = createDiagramStore();
    enforceViewOnly(store);
    store.getState().setReadOnly(DRAFT_LOCK);
    expect(store.getState().readOnly).toBe(DRAFT_LOCK);
    store.getState().setReadOnly(null);
    expect(store.getState().readOnly).toBe(VIEW_LOCK);
    store.setState({ readOnly: COLLAB_WAITING_LOCK });
    store.setState({ readOnly: null });
    expect(store.getState().readOnly).toBe(VIEW_LOCK);
    expect(store.getState().apply(node)).toBe(false);
  });

  it('still loads another diagram, and keeps the lock', () => {
    const store = createDiagramStore();
    enforceViewOnly(store);
    const other = createDiagramStore();
    other.getState().setReadOnly(null);
    other.getState().apply(node);
    store.getState().load({ model: other.getState().model, layout: other.getState().layout });
    expect(store.getState().model.order).toEqual(['A']);
    expect(store.getState().readOnly).toBe(VIEW_LOCK);
  });

  it('stop gives the store back', () => {
    const store = createDiagramStore();
    const stop = enforceViewOnly(store);
    stop();
    expect(store.getState().readOnly).toBeNull();
    store.getState().setReadOnly(null);
    expect(store.getState().readOnly).toBeNull();
  });
});
