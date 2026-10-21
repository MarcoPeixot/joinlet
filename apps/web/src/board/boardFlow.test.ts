import { addNote, addSection, connectCards, emptyBoard, moveBoard, reconcileBoard, updateConnection } from '@strukt/workspace';
import { emptyManifest } from '@strukt/workspace';
import type { WorkspaceData } from '@strukt/workspace';
import { describe, expect, it } from 'vitest';
import { boardToFlow, deletableIds, deletePlan, diagramFor, docFor, followSection, sketchFor, startSectionDrag } from './boardFlow';

const manifest = { ...emptyManifest('Loja'), diagrams: [{ slug: 'loja', title: 'Loja' }] };

function sample() {
  let board = reconcileBoard(emptyBoard(), manifest);
  board = addNote(board, 'n1', { x: 400, y: 60 });
  board = addSection(board, 's1', { x: 0, y: 0 }, 'Pagamentos');
  board = moveBoard(board, { s1: { x: 0, y: 0, w: 800, h: 400 } });
  return connectCards(board, 'c1', 'diagram:loja', 'n1');
}

function emptyData(): WorkspaceData {
  return { manifest: emptyManifest('Loja'), diagrams: {}, docs: {}, sketches: {}, board: emptyBoard() };
}

describe('boardToFlow', () => {
  it('projects sections under cards, with fixed sizes, selection and connections', () => {
    const { nodes, edges } = boardToFlow(sample(), new Set(['n1']));
    expect(nodes.map((n) => [n.id, n.type, n.zIndex])).toEqual([['s1', 'section', 0], ['diagram:loja', 'card', 1], ['n1', 'card', 1]]);
    expect(nodes[1]).toMatchObject({ position: { x: 40, y: 40 }, width: 280, height: 200, measured: { width: 280, height: 200 }, selected: false });
    expect(nodes[2]!.selected).toBe(true);
    expect(edges).toEqual([expect.objectContaining({ id: 'c1', type: 'float', source: 'diagram:loja', target: 'n1' })]);
  });

  it('hands each edge its connection, label and bend included', () => {
    const board = updateConnection(sample(), 'c1', { label: 'HTTP', bend: 0.3 });
    expect(boardToFlow(board, new Set(['c1'])).edges).toEqual([
      {
        id: 'c1',
        type: 'float',
        source: 'diagram:loja',
        target: 'n1',
        selected: true,
        data: { connection: { id: 'c1', from: 'diagram:loja', to: 'n1', label: 'HTTP', bend: 0.3 } },
      },
    ]);
  });
});

describe('boardToFlow autoFocus', () => {
  it('flags only the requested card (a new note), and none without a request', () => {
    const cards = (focus?: string | null) =>
      boardToFlow(sample(), new Set(), focus).nodes.flatMap((n) => (n.type === 'card' ? [[n.id, n.data.autoFocus]] : []));
    expect(cards('n1')).toEqual([['diagram:loja', false], ['n1', true]]);
    expect(cards(null)).toEqual([['diagram:loja', false], ['n1', false]]);
    expect(cards()).toEqual([['diagram:loja', false], ['n1', false]]);
  });
});

describe('deletableIds', () => {
  it('lets notes, sections and connections go but never item cards (those are deleted from the sidebar)', () => {
    expect(deletableIds(sample(), ['diagram:loja', 'n1', 's1', 'c1', 'ghost'])).toEqual(['n1', 's1', 'c1']);
  });
});

describe('section drag', () => {
  it('moves the cards whose center was inside the section when the drag started', () => {
    const drag = startSectionDrag(sample(), 's1')!;
    expect(Object.keys(drag.cards).sort()).toEqual(['diagram:loja', 'n1']);
    expect(followSection(drag, { x: 100, y: 50 })).toEqual({
      s1: { x: 100, y: 50 },
      'diagram:loja': { x: 140, y: 90 },
      n1: { x: 500, y: 110 },
    });
  });
});

describe('content selectors (own(), not map[slug])', () => {
  it('a slug shaped like an Object.prototype member reads as missing content, never a function', () => {
    const data = emptyData();
    expect(diagramFor(data, 'constructor')).toBeUndefined();
    expect(docFor(data, 'toString')).toBeUndefined();
    expect(sketchFor(data, 'valueOf')).toBeUndefined();
    expect(diagramFor(null, 'constructor')).toBeUndefined();
  });
});

describe('deletePlan', () => {
  it('flags a refusal even when the only refused id is a node and everything else asked is a deletable edge', () => {
    expect(deletePlan(sample(), ['diagram:loja'], ['c1'])).toEqual({ ids: ['c1'], refused: true });
  });
  it('does not flag a refusal when everything asked can go', () => {
    expect(deletePlan(sample(), ['n1', 's1'], ['c1'])).toEqual({ ids: ['n1', 's1', 'c1'], refused: false });
  });
});

