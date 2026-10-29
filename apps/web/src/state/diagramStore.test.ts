import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDiagramStore } from './diagramStore';
import { clearSnapshot, loadSnapshot } from './persist';

describe('diagram gestures', () => {
  it('a gesture that only refreshed routes leaves no undo entry; a real move leaves one', () => {
    const store = createDiagramStore();
    store.getState().apply([{ op: 'add_node', id: 'A' }], { A: { x: 0, y: 0 } });
    const before = store.getState().past.length;
    store.getState().beginGesture();
    store.getState().setRoutes({ 'A→B': { points: [] } } as never);
    store.getState().endGesture();
    expect(store.getState().past).toHaveLength(before);

    store.getState().beginGesture();
    store.getState().moveLive({ A: { x: 40, y: 40 } });
    store.getState().endGesture();
    expect(store.getState().past).toHaveLength(before + 1);
  });
});

describe('diagram store', () => {
  it('applies ops with history, undo and redo', () => {
    const store = createDiagramStore();
    expect(store.getState().apply([{ op: 'add_node', id: 'A' }], { A: { x: 10, y: 10 } })).toBe(true);
    expect(store.getState().layout.nodes.A).toEqual({ x: 10, y: 10 });
    store.getState().undo();
    expect(store.getState().model.order).toEqual([]);
    store.getState().redo();
    expect(store.getState().model.order).toEqual(['A']);
  });

  it('records failures without touching history', () => {
    const store = createDiagramStore();
    expect(store.getState().apply([{ op: 'remove', id: 'Nope' }])).toBe(false);
    expect(store.getState().lastError).toBe('Elemento "Nope" não existe.');
    expect(store.getState().past).toHaveLength(0);
  });

  it('bumps the error sequence on every failure, even for the same message', () => {
    const store = createDiagramStore();
    store.getState().apply([{ op: 'remove', id: 'Nope' }]);
    store.getState().apply([{ op: 'remove', id: 'Nope' }]);
    expect(store.getState().errorSeq).toBe(2);
    store.getState().apply([{ op: 'add_node', id: 'A' }], { A: { x: 0, y: 0 } });
    expect(store.getState().lastError).toBeNull();
    store.getState().beginGesture();
    store.getState().endGesture([{ op: 'move_to_group', id: 'A', parentId: 'Nope' }]);
    expect(store.getState().errorSeq).toBe(3);
    store.getState().beginGesture();
    store.getState().moveLive({ A: { x: 5, y: 0 } });
    store.getState().endGesture();
    expect(store.getState().lastError).toBeNull();
    expect(store.getState().errorSeq).toBe(3);
  });

  it('collapses a drag gesture into one undo step', () => {
    const store = createDiagramStore();
    store.getState().apply([{ op: 'add_node', id: 'A' }], { A: { x: 0, y: 0 } });
    store.getState().beginGesture();
    for (const x of [5, 10, 15]) store.getState().moveLive({ A: { x, y: 0 } });
    store.getState().endGesture();
    expect(store.getState().past).toHaveLength(2);
    store.getState().undo();
    expect(store.getState().layout.nodes.A).toEqual({ x: 0, y: 0 });
  });

  it('commits a drag that regroups the node as one undo step', () => {
    const store = createDiagramStore();
    store.getState().apply([{ op: 'add_group', id: 'G' }, { op: 'add_node', id: 'A' }], { A: { x: 0, y: 0 }, G: { x: 300, y: 0 } });
    store.getState().beginGesture();
    store.getState().moveLive({ A: { x: 320, y: 60 } });
    store.getState().endGesture([{ op: 'move_to_group', id: 'A', parentId: 'G' }]);
    expect(store.getState().model.elements.A?.parentId).toBe('G');
    expect(store.getState().layout.nodes.A).toEqual({ x: 320, y: 60 });
    expect(store.getState().past).toHaveLength(2);
    expect(store.getState().pending).toBeNull();
    store.getState().undo();
    expect(store.getState().model.elements.A?.parentId).toBeUndefined();
    expect(store.getState().layout.nodes.A).toEqual({ x: 0, y: 0 });
  });

  it('keeps the drag as one step and reports the error when the gesture ops fail', () => {
    const store = createDiagramStore();
    store.getState().apply([{ op: 'add_node', id: 'A' }], { A: { x: 0, y: 0 } });
    store.getState().beginGesture();
    store.getState().moveLive({ A: { x: 40, y: 0 } });
    store.getState().endGesture([{ op: 'move_to_group', id: 'A', parentId: 'Nope' }]);
    expect(store.getState().lastError).toBe('Elemento "Nope" não existe.');
    expect(store.getState().layout.nodes.A).toEqual({ x: 40, y: 0 });
    expect(store.getState().past).toHaveLength(2);
    store.getState().undo();
    expect(store.getState().layout.nodes.A).toEqual({ x: 0, y: 0 });
  });

  it('ignores a nested beginGesture while one is pending', () => {
    const store = createDiagramStore();
    store.getState().apply([{ op: 'add_node', id: 'A' }], { A: { x: 0, y: 0 } });
    store.getState().beginGesture();
    store.getState().moveLive({ A: { x: 10, y: 0 } });
    store.getState().beginGesture();
    store.getState().moveLive({ A: { x: 20, y: 0 } });
    store.getState().endGesture();
    store.getState().undo();
    expect(store.getState().layout.nodes.A).toEqual({ x: 0, y: 0 });
  });

  it('keeps selected edges on the same connection when ids are renumbered', () => {
    const store = createDiagramStore();
    store.getState().apply([
      { op: 'add_node', id: 'A' },
      { op: 'add_node', id: 'B' },
      { op: 'connect', from: 'A', to: 'B', label: 'one' },
      { op: 'connect', from: 'A', to: 'B', label: 'two' },
    ]);
    store.getState().select({ edges: ['A→B'] });
    store.getState().apply([{ op: 'remove_edge', edgeId: 'A→B' }]);
    expect(store.getState().model.edges.map((e) => [e.id, e.label])).toEqual([['A→B', 'two']]);
    expect(store.getState().selection.edges).toEqual([]);

    store.getState().apply([{ op: 'connect', from: 'A', to: 'B', label: 'three' }]);
    store.getState().select({ edges: ['A→B#2'] });
    store.getState().apply([{ op: 'remove_edge', edgeId: 'A→B' }]);
    expect(store.getState().selection.edges).toEqual(['A→B']);
    store.getState().apply([{ op: 'rename', id: 'A', to: 'API' }]);
    expect(store.getState().selection.edges).toEqual(['API→B']);
  });

  it('clears selected edges on undo/redo: a renumbered id could point at a parallel sibling', () => {
    const store = createDiagramStore();
    store.getState().apply([
      { op: 'add_node', id: 'A' },
      { op: 'add_node', id: 'B' },
      { op: 'connect', from: 'A', to: 'B', label: 'one' },
      { op: 'connect', from: 'A', to: 'B', label: 'two' },
    ]);
    store.getState().apply([{ op: 'remove_edge', edgeId: 'A→B' }]);
    store.getState().select({ nodes: ['A'], edges: ['A→B'] });
    store.getState().undo();
    // "A→B" is now the restored edge "one", not the selected "two".
    expect(store.getState().selection).toEqual({ nodes: ['A'], edges: [] });
    store.getState().select({ edges: ['A→B#2'] });
    store.getState().redo();
    expect(store.getState().selection).toEqual({ nodes: ['A'], edges: [] });
  });

  it('prunes a removed element named like an Object.prototype member from the selection', () => {
    const store = createDiagramStore();
    store.getState().apply([{ op: 'add_node', id: 'constructor' }, { op: 'add_node', id: 'A' }]);
    store.getState().select({ nodes: ['constructor', 'A'] });
    store.getState().apply([{ op: 'remove', id: 'constructor' }]);
    expect(store.getState().selection.nodes).toEqual(['A']);
  });

  it('follows renames in selection and layout, prunes removed selection', () => {
    const store = createDiagramStore();
    store.getState().apply([{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }], { A: { x: 1, y: 1 } });
    store.getState().select({ nodes: ['A', 'B'] });
    store.getState().apply([{ op: 'rename', id: 'A', to: 'API' }, { op: 'remove', id: 'B' }]);
    expect(store.getState().selection.nodes).toEqual(['API']);
    expect(store.getState().layout.nodes.API).toEqual({ x: 1, y: 1 });
  });
});

describe('route cache (derived state)', () => {
  const routed = () => {
    const store = createDiagramStore();
    store.getState().apply([{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }, { op: 'connect', from: 'A', to: 'B' }], {
      A: { x: 0, y: 0 },
      B: { x: 300, y: 0 },
    });
    store.getState().setRoutes({ 'A→B': { points: [[160, 32], [300, 32]], key: 'k' } });
    return store;
  };

  it('keeps routes out of history, so undo/redo never restore stale ones: they carry the live ones', () => {
    const store = routed();
    store.getState().apply([{ op: 'update', id: 'A', set: { label: 'Alfa' } }]);
    expect(store.getState().past.every((s) => Object.keys(s.layout.edges).length === 0)).toBe(true);
    store.getState().setRoutes({ 'A→B': { points: [[0, 0], [1, 1]], key: 'k2' } });
    store.getState().undo();
    expect(store.getState().layout.edges['A→B']?.key).toBe('k2');
    expect(store.getState().future[0]?.layout.edges).toEqual({});
    store.getState().apply([{ op: 'remove_edge', edgeId: 'A→B' }]);
    store.getState().undo();
    expect(store.getState().layout.edges).toEqual({});
  });

  it('an edit keeps the routes it did not touch, so connecting or disconnecting never redraws every edge', () => {
    const store = routed();
    store.getState().apply([{ op: 'add_node', id: 'C' }, { op: 'connect', from: 'B', to: 'C' }], { C: { x: 600, y: 0 } });
    expect(Object.keys(store.getState().layout.edges)).toEqual(['A→B']);
    store.getState().setRoutes({ ...store.getState().layout.edges, 'B→C': { points: [[0, 0], [1, 1]], key: 'bc' } });
    store.getState().apply([{ op: 'remove_edge', edgeId: 'B→C' }]);
    expect(store.getState().layout.edges).toEqual({ 'A→B': { points: [[160, 32], [300, 32]], key: 'k' } });
    // Restyling a connection keeps its route on screen until the router redraws it.
    store.getState().apply([{ op: 'update_edge', edgeId: 'A→B', set: { toPort: 'top', connector: '<>', color: 'red' } }]);
    expect(store.getState().layout.edges['A→B']?.key).toBe('k');
  });

  it('moveLive keeps the cached routes; setRoutes is not an undo step', () => {
    const store = routed();
    const past = store.getState().past.length;
    store.getState().moveLive({ B: { x: 320, y: 0 } });
    expect(store.getState().layout.edges['A→B']?.key).toBe('k');
    expect(store.getState().past).toHaveLength(past);
  });
});

describe('arrange', () => {
  it('moves nodes as one undo step without cloning the model', () => {
    const store = createDiagramStore();
    store.getState().apply([{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }], { A: { x: 0, y: 0 }, B: { x: 300, y: 0 } });
    const { model } = store.getState();
    store.getState().arrange({ A: { x: 10, y: 20 }, Ghost: { x: 1, y: 1 } });
    expect(store.getState().model).toBe(model);
    expect(store.getState().layout.nodes).toEqual({ A: { x: 10, y: 20 }, B: { x: 300, y: 0 } });
    store.getState().undo();
    expect(store.getState().layout.nodes.A).toEqual({ x: 0, y: 0 });
    expect(store.getState().model).toBe(model);
  });
});

describe('own() through moveLive and arrange', () => {
  // Documents intent (CLAUDE.md's own() rule): passes before and after the fix, since spreading a
  // function (the Object.prototype.constructor read a plain `nodes[id]` would find) yields {}.
  it('moveLive on a hostile id with no layout entry writes exactly the given box', () => {
    const store = createDiagramStore();
    store.getState().apply([{ op: 'add_node', id: 'constructor' }]);
    expect(Object.hasOwn(store.getState().layout.nodes, 'constructor')).toBe(false);
    store.getState().moveLive({ constructor: { x: 3, y: 4 } });
    expect(Object.hasOwn(store.getState().layout.nodes, 'constructor')).toBe(true);
    expect(store.getState().layout.nodes.constructor).toEqual({ x: 3, y: 4 });
  });

  it('arrange on a hostile id with no layout entry writes exactly the given box', () => {
    const store = createDiagramStore();
    store.getState().apply([{ op: 'add_node', id: 'constructor' }]);
    expect(Object.hasOwn(store.getState().layout.nodes, 'constructor')).toBe(false);
    store.getState().arrange({ constructor: { x: 3, y: 4 } });
    expect(Object.hasOwn(store.getState().layout.nodes, 'constructor')).toBe(true);
    expect(store.getState().layout.nodes.constructor).toEqual({ x: 3, y: 4 });
  });
});

describe('persistence', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the scratch diagram of older builds without routes, clears it and rejects garbage', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      removeItem: (k: string) => void data.delete(k),
    });
    const store = createDiagramStore();
    store.getState().apply([{ op: 'add_node', id: 'A' }], { A: { x: 3, y: 4 } });
    const layout = { nodes: { A: { x: 3, y: 4 } }, edges: { A: { points: [[0, 0]] } } };
    data.set('strukt:scratch:v1', JSON.stringify({ model: store.getState().model, layout }));
    expect(loadSnapshot()?.layout).toEqual({ nodes: { A: { x: 3, y: 4 } }, edges: {} });
    clearSnapshot();
    expect(loadSnapshot()).toBeNull();
    data.set('strukt:scratch:v1', '{"nope":1}');
    expect(loadSnapshot()).toBeNull();
  });

  it('normalizes edge ids saved by older builds', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null });
    const store = createDiagramStore();
    store.getState().apply([{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }, { op: 'connect', from: 'A', to: 'B' }]);
    const { model } = store.getState();
    const stale = { ...model, edges: [{ ...model.edges[0]!, id: 'A→B#2' }] };
    data.set('strukt:scratch:v1', JSON.stringify({ model: stale, layout: { nodes: {}, edges: {} } }));
    expect(loadSnapshot()?.model.edges.map((e) => e.id)).toEqual(['A→B']);
  });
});

describe('read-only while an AI draft is pending', () => {
  it('refuses every mutation with the lock reason and keeps history intact', () => {
    const store = createDiagramStore();
    store.getState().apply([{ op: 'add_node', id: 'A' }], { A: { x: 0, y: 0 } });
    const before = store.getState();
    store.getState().setReadOnly('Revise a proposta da IA.');
    expect(store.getState().apply([{ op: 'add_node', id: 'B' }])).toBe(false);
    expect(store.getState()).toMatchObject({ lastError: 'Revise a proposta da IA.', errorSeq: before.errorSeq + 1 });
    store.getState().undo();
    store.getState().redo();
    store.getState().arrange({ A: { x: 50, y: 50 } });
    store.getState().beginGesture();
    store.getState().moveLive({ A: { x: 9, y: 9 } });
    store.getState().load({ model: before.model, layout: { nodes: {}, edges: {} } });
    expect(store.getState()).toMatchObject({ model: before.model, layout: before.layout, past: before.past, pending: null, errorSeq: before.errorSeq + 5 });
    store.getState().select({ nodes: ['A'] });
    expect(store.getState().selection.nodes).toEqual(['A']);
    store.getState().setReadOnly(null);
    expect(store.getState().apply([{ op: 'add_node', id: 'B' }])).toBe(true);
  });

  it('lets a gesture begun before the lock finish, but refuses endGesture with nothing pending', () => {
    const store = createDiagramStore();
    store.getState().apply([{ op: 'add_node', id: 'A' }], { A: { x: 0, y: 0 } });
    store.getState().beginGesture();
    store.getState().setReadOnly('Revise a proposta da IA.');
    store.getState().endGesture([{ op: 'rename', id: 'A', to: 'B' }]);
    expect(store.getState().model.elements.B).toBeDefined();
    expect(store.getState().pending).toBeNull();

    // Locked, and no gesture pending this time: must not start committing ops.
    store.getState().endGesture([{ op: 'add_node', id: 'C' }]);
    expect(store.getState().model.elements.C).toBeUndefined();
  });
});
