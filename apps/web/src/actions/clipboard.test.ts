import { computeRects, emptyLayout, emptyModel } from '@strukt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { diagramStore } from '../state/appStore';
import { copySelection, duplicateSelection, pasteClipboard } from './clipboard';

beforeEach(() => {
  diagramStore.getState().load({ model: emptyModel(), layout: emptyLayout() });
});

describe('copySelection', () => {
  it('returns false and copies nothing when the selection is empty', () => {
    diagramStore.getState().apply([{ op: 'add_node', id: 'A' }]);
    diagramStore.getState().select({ nodes: [], edges: [] });

    expect(copySelection()).toBe(false);
  });

  it('returns true when nodes are selected', () => {
    diagramStore.getState().apply([{ op: 'add_node', id: 'A' }]);
    diagramStore.getState().select({ nodes: ['A'], edges: [] });

    expect(copySelection()).toBe(true);
  });
});

describe('pasteClipboard', () => {
  it('pastes a group with its children under fresh names, offset from the originals', () => {
    diagramStore.getState().apply(
      [
        { op: 'add_group', id: 'G' },
        { op: 'add_node', id: 'A', parentId: 'G' },
      ],
      { A: { x: 100, y: 100 } },
    );
    const before = diagramStore.getState();
    const rectsBefore = computeRects(before.model, before.layout);
    diagramStore.getState().select({ nodes: ['G'], edges: [] });

    expect(copySelection()).toBe(true);
    pasteClipboard();

    const state = diagramStore.getState();
    expect(state.model.order).toEqual(['G', 'A', 'G 2', 'A 2']);
    expect(state.model.elements['G 2'].kind).toBe('group');
    expect(state.model.elements['A 2'].parentId).toBe('G 2');
    expect(state.layout.nodes['A 2']).toEqual({ x: rectsBefore['A'].x + 32, y: rectsBefore['A'].y + 32 });
    // The pasted group is derived from its pasted child: no computed box is stored for it.
    expect(state.layout.nodes['G 2']).toBeUndefined();
    const rectsAfter = computeRects(state.model, state.layout);
    expect(rectsAfter['G 2']).toEqual({ ...rectsBefore['G'], x: rectsBefore['G'].x + 32, y: rectsBefore['G'].y + 32 });
    // Only the pasted group is selected: its pasted child is dropped by topLevel.
    expect(state.selection).toEqual({ nodes: ['G 2'], edges: [] });
  });

  it('keeps pasted icon nodes resizable by shape instead of freezing their icon size', () => {
    diagramStore.getState().apply([{ op: 'add_node', id: 'R', icon: 'redis' }], { R: { x: 0, y: 0 } });
    diagramStore.getState().select({ nodes: ['R'], edges: [] });

    duplicateSelection();
    diagramStore.getState().apply([{ op: 'update', id: 'R 2', set: { shape: 'rectangle' } }]);

    const state = diagramStore.getState();
    expect(state.layout.nodes['R 2']).toEqual({ x: 32, y: 32 });
    expect(computeRects(state.model, state.layout)['R 2']).toEqual({ x: 32, y: 32, w: 160, h: 64 });
  });

  it('accumulates the offset by 32px on each repeated paste', () => {
    diagramStore.getState().apply([{ op: 'add_node', id: 'A' }], { A: { x: 10, y: 20 } });
    diagramStore.getState().select({ nodes: ['A'], edges: [] });

    expect(copySelection()).toBe(true);
    pasteClipboard();
    pasteClipboard();

    const state = diagramStore.getState();
    expect(state.model.order).toEqual(['A', 'A 2', 'A 3']);
    expect(state.layout.nodes['A 2']).toMatchObject({ x: 42, y: 52 });
    expect(state.layout.nodes['A 3']).toMatchObject({ x: 74, y: 84 });
  });
});

describe('duplicateSelection', () => {
  it('copies then pastes the current selection, offset by 32px, selecting the duplicate', () => {
    diagramStore.getState().apply([{ op: 'add_node', id: 'A' }], { A: { x: 5, y: 5 } });
    diagramStore.getState().select({ nodes: ['A'], edges: [] });

    duplicateSelection();

    const state = diagramStore.getState();
    expect(state.model.order).toEqual(['A', 'A 2']);
    expect(state.layout.nodes['A 2']).toMatchObject({ x: 37, y: 37 });
    expect(state.selection).toEqual({ nodes: ['A 2'], edges: [] });
  });

  it('is a no-op when the selection is empty', () => {
    diagramStore.getState().apply([{ op: 'add_node', id: 'A' }]);
    diagramStore.getState().select({ nodes: [], edges: [] });
    const before = diagramStore.getState().model.order.length;

    duplicateSelection();

    expect(diagramStore.getState().model.order.length).toBe(before);
  });
});
