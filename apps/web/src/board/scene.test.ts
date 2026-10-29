import type { DiagramOp } from '@strukt/core';
import type { Board } from '@strukt/workspace';
import { describe, expect, it } from 'vitest';
import { createDiagramStore } from '../state/diagramStore';
import type { Snapshot } from '../state/diagramStore';
import { boardToScene, matchConnections, removalOps, sceneToBoard } from './scene';

const board: Board = {
  version: 1,
  sections: [{ id: 's1', title: 'Core', x: 0, y: 0, w: 800, h: 400 }],
  cards: [
    { id: 'diagram:api', kind: 'diagram', slug: 'api', x: 40, y: 60, w: 280, h: 200 },
    { id: 'n1', kind: 'note', x: 1000, y: 60, w: 200, h: 160, text: 'Lembrar', color: '#cfe4ff' },
  ],
  connections: [{ id: 'c1', from: 'diagram:api', to: 'n1', label: 'usa', bend: 0.3 }],
};
const title = (card: Board['cards'][number]) => card.text ?? card.slug ?? card.id;
const all = (b: Board) => new Set([...b.cards.map((c) => c.id), ...b.sections.map((s) => s.id)]);

function edit(snapshot: Snapshot, ops: DiagramOp[], positions: Snapshot['layout']['nodes'] = {}): Snapshot {
  const store = createDiagramStore(snapshot);
  if (!store.getState().apply(ops, positions)) throw new Error(store.getState().lastError!);
  return store.getState();
}

describe('boardToScene', () => {
  it('draws sections as groups, cards as nodes at their size, connections as labelled edges', () => {
    const { model, layout } = boardToScene(board, title);
    expect(model.elements.s1).toMatchObject({ kind: 'group', label: 'Core' });
    expect(model.elements['diagram:api']).toMatchObject({ kind: 'node', parentId: 's1', label: 'api' });
    expect(model.elements.n1).toMatchObject({ kind: 'node', label: 'Lembrar', color: '#cfe4ff' });
    expect(model.elements.n1!.parentId).toBeUndefined();
    expect(layout.nodes['diagram:api']).toEqual({ x: 40, y: 60, w: 280, h: 200 });
    expect(model.edges).toEqual([expect.objectContaining({ from: 'diagram:api', to: 'n1', label: 'usa' })]);
  });
});

describe('sceneToBoard', () => {
  it('gives the board back unchanged but for sections hugging their cards', () => {
    const back = sceneToBoard(boardToScene(board, title), board, all(board));
    expect(back.cards).toEqual(board.cards);
    expect(back.connections).toEqual(board.connections);
    const s = back.sections[0]!;
    expect(s).toMatchObject({ id: 's1', title: 'Core' });
    // Hugs its one card (28 px of padding, 44 for the title).
    expect(s).toMatchObject({ x: 12, y: 16, w: 336, h: 272 });
  });

  it('keeps what the scene did not draw (a folder filter) and drops what it removed', () => {
    const shown: Board = { ...board, cards: [board.cards[0]!], connections: [] };
    const scene = edit(boardToScene(shown, title), [{ op: 'remove', id: 'diagram:api' }]);
    const back = sceneToBoard(scene, board, all(shown));
    expect(back.cards.map((c) => c.id)).toEqual(['n1']);
    expect(back.connections).toEqual([]);
  });

  it('turns new nodes into notes and new edges into connections, keeping a moved card where it went', () => {
    let scene = boardToScene(board, title);
    scene = edit(scene, [{ op: 'add_node', id: 'n2', label: 'Nova', color: '#fdf3b5' }, { op: 'connect', from: 'n1', to: 'n2', label: 'segue' }], { n2: { x: 1300, y: 60, w: 200, h: 160 }, n1: { x: 1000, y: 300, w: 200, h: 160 } });
    const back = sceneToBoard(scene, board, all(board));
    expect(back.cards.find((c) => c.id === 'n2')).toEqual({ id: 'n2', kind: 'note', x: 1300, y: 60, w: 200, h: 160, text: 'Nova', color: '#fdf3b5' });
    expect(back.cards.find((c) => c.id === 'n1')).toMatchObject({ y: 300 });
    expect(back.connections).toEqual([board.connections[0], { id: expect.any(String), from: 'n1', to: 'n2', label: 'segue' }]);
  });

  it('deletes notes, sections (moving their cards out) and connections, never item cards', () => {
    const { model } = boardToScene(board, title);
    const all = removalOps(model, { nodes: ['s1', 'n1', 'diagram:api'], edges: [model.edges[0]!.id] }, board);
    expect(all.refused).toBe(true);
    expect(all.ops).toEqual([
      { op: 'remove_edge', edgeId: model.edges[0]!.id },
      { op: 'move_to_group', id: 'diagram:api', parentId: null },
      { op: 'remove', id: 's1' },
      { op: 'remove', id: 'n1' },
    ]);
    expect(removalOps(model, { nodes: ['n1'], edges: [] }, board).refused).toBe(false);
  });

  it('keeps the id and bend of the connection an edge draws when its label changes', () => {
    const twice: Board = { ...board, connections: [board.connections[0]!, { id: 'c9', from: 'diagram:api', to: 'n1', bend: 0.7 }] };
    const scene = boardToScene(twice, title);
    expect([...matchConnections(scene, twice.connections).values()].map((c) => c.id)).toEqual(['c1', 'c9']);
    const back = sceneToBoard(edit(scene, [{ op: 'update_edge', edgeId: scene.model.edges[1]!.id, set: { label: 'x' } }]), twice, all(twice));
    expect(back.connections).toEqual([board.connections[0], { id: 'c9', from: 'diagram:api', to: 'n1', bend: 0.7, label: 'x' }]);
  });
});


describe('Overview connection identity and history', () => {
  it.each([0, 1])('deleting parallel connection %i preserves the others through undo, redo and reload', (removed) => {
    const base: Board = { ...board, connections: [0, 1, 2].map((i) => ({
      id: `connection-${i}`, from: 'diagram:api', to: 'n1', label: 'same label', bend: (i + 1) / 4,
    })) };
    const store = createDiagramStore(boardToScene(base, title));
    const archive = base.connections;
    store.getState().apply([{ op: 'remove_edge', edgeId: store.getState().model.edges[removed]!.id }]);
    const after = sceneToBoard(store.getState(), base, all(base), archive);
    expect(after.connections).toEqual(base.connections.filter((_, i) => i !== removed));
    store.getState().undo();
    const restored = sceneToBoard(store.getState(), after, all(base), archive);
    expect(restored.connections).toEqual(base.connections);
    store.getState().redo();
    expect(sceneToBoard(store.getState(), restored, all(base), archive).connections).toEqual(after.connections);
    expect(sceneToBoard(boardToScene(after, title), after, all(after)).connections).toEqual(after.connections);
  });

  it('a new connection keeps its generated id through edits, removal and restoration', () => {
    const store = createDiagramStore(boardToScene(board, title));
    store.getState().apply([{ op: 'connect', from: 'n1', to: 'diagram:api', label: 'back' }]);
    const created = sceneToBoard(store.getState(), board, all(board));
    const id = created.connections[1]!.id;
    const edgeId = store.getState().model.edges[1]!.id;
    store.getState().apply([{ op: 'update_edge', edgeId, set: { label: 'changed' } }]);
    const edited = sceneToBoard(store.getState(), created, all(board));
    expect(edited.connections[1]).toMatchObject({ id, label: 'changed' });
    store.getState().apply([{ op: 'remove_edge', edgeId }]);
    const removed = sceneToBoard(store.getState(), edited, all(board));
    store.getState().undo();
    expect(sceneToBoard(store.getState(), removed, all(board), edited.connections).connections).toEqual(edited.connections);
  });
});
