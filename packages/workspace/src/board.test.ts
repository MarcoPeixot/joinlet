import { describe, expect, it } from 'vitest';
import {
  BOARD_MAX_ITEMS, BOARD_CARD_GAP, CARD_SIZE, NOTE_COLORS, NOTE_SIZE, addNote, addSection, cardsInSection, connectCards, emptyBoard, freeSpot, itemCardId,
  moveBoard, parseBoard, printBoard, reconcileBoard, removeFromBoard, spaceBoard, updateCard, updateConnection, updateSection,
} from './board';
import type { Board } from './board';
import { emptyManifest } from './manifest';

const manifest = {
  ...emptyManifest('Loja'),
  diagrams: [{ slug: 'loja', title: 'Loja' }],
  docs: [{ slug: 'api', title: 'API' }],
  sketches: [{ slug: 'ideias', title: 'Ideias' }],
};

describe('reconcileBoard', () => {
  it('gives every item a card, in free grid cells', () => {
    const board = reconcileBoard(emptyBoard(), manifest);
    expect(board.cards.map((c) => c.id)).toEqual(['diagram:loja', 'doc:api', 'sketch:ideias']);
    expect(board.cards[0]).toEqual({ id: 'diagram:loja', kind: 'diagram', slug: 'loja', x: 40, y: 40, ...CARD_SIZE });
    expect(board.cards[1]!.x).toBe(40 + CARD_SIZE.w + BOARD_CARD_GAP);
    expect(new Set(board.cards.map((c) => `${c.x},${c.y}`)).size).toBe(3);
  });

  it('(b) terminates next to a huge section, falling back below everything when the scan finds no free cell', () => {
    const one = { ...emptyManifest('x'), docs: [{ slug: 'api', title: 'API' }] };
    const big: Board = { ...emptyBoard(), sections: [{ id: 's', title: 'Enorme', x: 0, y: 0, w: 100_000, h: 100_000 }] };
    expect(reconcileBoard(big, one).cards[0]!.y).toBeGreaterThanOrEqual(100_040);
    const taller: Board = { ...big, sections: [...big.sections, { id: 't', title: 'Outra', x: 0, y: 100_000, w: 100_000, h: 100_000 }] };
    expect(reconcileBoard(taller, one).cards[0]).toMatchObject({ x: 40, y: 200_000 + BOARD_CARD_GAP });
  });

  describe('in linear time', () => {
    const docs = (n: number) => ({ ...emptyManifest('x'), docs: Array.from({ length: n }, (_, i) => ({ slug: `d${i}`, title: `D${i}` })) });
    const overlapping = (cards: readonly Board['cards'][number][]) => {
      for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i]!;
        const b = cards[j]!;
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return [a.id, b.id];
      }
      return null;
    };

    it('reconciles a hostile board (5000 far-away notes, the grid fully covered) with 400 uncarded items quickly', () => {
      const notes = Array.from({ length: 5000 }, (_, i) => ({
        id: `n${i}`, kind: 'note' as const, x: 500_000 + (i % 100) * 300, y: 500_000 + Math.floor(i / 100) * 200, w: 200, h: 160,
      }));
      const hostile: Board = {
        ...emptyBoard(),
        cards: notes,
        sections: [
          { id: 's1', title: 'S1', x: 0, y: 0, w: 100_000, h: 100_000 },
          { id: 's2', title: 'S2', x: 0, y: 100_000, w: 100_000, h: 100_000 },
        ],
      };
      const start = performance.now();
      const board = reconcileBoard(hostile, docs(400));
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(1500);
      const added = board.cards.filter((c) => c.kind === 'doc');
      expect(added.map((c) => c.id).sort()).toEqual(Array.from({ length: 400 }, (_, i) => `doc:d${i}`).sort());
      expect(new Set(added.map((c) => c.id)).size).toBe(400);
      expect(overlapping(added)).toBeNull();
      // Below everything, the far notes included (lowest note: y 509800 + h 160).
      expect(added[0]).toMatchObject({ x: 40, y: 509_960 + BOARD_CARD_GAP });
    });

    /** The placement before the linear rewrite: one full grid scan per missing item (reference for equivalence). */
    function reference(board: Board, manifest: ReturnType<typeof docs>): Board['cards'] {
      const grid = { x: 40, y: 40, gap: BOARD_CARD_GAP, columns: 4 };
      const cards = board.cards.filter((c) => c.kind === 'note');
      for (const { slug } of manifest.docs) {
        const taken = [...cards, ...board.sections];
        let spot: { x: number; y: number } | null = null;
        for (let i = 0; i < 2000 && !spot; i++) {
          const cell = { x: grid.x + (i % 4) * (CARD_SIZE.w + grid.gap), y: grid.y + Math.floor(i / 4) * (CARD_SIZE.h + grid.gap), ...CARD_SIZE };
          if (!taken.some((b) => b.x < cell.x + cell.w && cell.x < b.x + b.w && b.y < cell.y + cell.h && cell.y < b.y + b.h)) spot = cell;
        }
        spot ??= { x: grid.x, y: Math.max(grid.y, ...taken.map((b) => b.y + b.h)) + grid.gap };
        cards.push({ id: `doc:${slug}`, kind: 'doc', slug, x: spot.x, y: spot.y, ...CARD_SIZE });
      }
      return cards;
    }

    it('places cards exactly where the one-scan-per-item placement did (random boards, fractional and touching boxes)', () => {
      let seed = 42;
      const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
      for (let round = 0; round < 40; round++) {
        const box = () => {
          const snap = rand() < 0.3; // touching the grid lines exactly
          const x = snap ? 40 + Math.floor(rand() * 5) * 320 - (rand() < 0.5 ? 40 : 0) : rand() * 1600 - 200;
          const y = snap ? 40 + Math.floor(rand() * 40) * 240 - (rand() < 0.5 ? 40 : 0) : rand() * 9000 - 200;
          return { x, y, w: snap ? 280 : 1 + rand() * 900, h: snap ? 200 : 1 + rand() * 700 };
        };
        const board: Board = {
          ...emptyBoard(),
          cards: Array.from({ length: Math.floor(rand() * 60) }, (_, i) => ({ id: `n${i}`, kind: 'note' as const, ...box() })),
          sections: Array.from({ length: Math.floor(rand() * 8) }, (_, i) => ({ id: `s${i}`, title: 'S', ...box() })),
        };
        // Every 10th round leaves only the last 16 cells free, so 25 items also fall back below everything.
        if (round % 10 === 0) board.sections.push({ id: 'big', title: 'B', x: 0, y: 0, w: 1300, h: 119_000 });
        const manifest = docs(round % 10 === 0 ? 25 : 1 + Math.floor(rand() * 30));
        expect(reconcileBoard(board, manifest).cards).toEqual(reference(board, manifest));
      }
    });
  });

  it('skips cells taken by existing cards and sections', () => {
    const start: Board = { ...emptyBoard(), sections: [{ id: 's', title: 'Seção', x: 0, y: 0, w: 330, h: 260 }] };
    const board = reconcileBoard(start, { ...emptyManifest('x'), docs: [{ slug: 'api', title: 'API' }] });
    expect(board.cards[0]).toMatchObject({ x: 40 + CARD_SIZE.w + BOARD_CARD_GAP, y: 40 });
  });

  it('drops cards (and their connections) whose item is gone, and returns the same board when nothing changes', () => {
    let board = reconcileBoard(emptyBoard(), manifest);
    board = addNote(board, 'n1', { x: 0, y: 900 });
    board = connectCards(board, 'c1', 'doc:api', 'n1');
    board = connectCards(board, 'c2', 'diagram:loja', 'n1');
    expect(reconcileBoard(board, manifest)).toBe(board);
    const next = reconcileBoard(board, { ...manifest, docs: [] });
    expect(next.cards.map((c) => c.id)).toEqual(['diagram:loja', 'sketch:ideias', 'n1']);
    expect(next.connections.map((c) => c.id)).toEqual(['c2']);
  });
});

describe('spaceBoard', () => {
  it('widens a legacy grid once, preserving card order, content, sizes, links and manual bends', () => {
    const original: Board = { ...emptyBoard(), cards: [
      { id: 'a', kind: 'note', x: 40, y: 40, w: 280, h: 200, text: 'Keep me', color: '#fdf3b5' },
      { id: 'b', kind: 'note', x: 360, y: 40, w: 280, h: 200 },
      { id: 'c', kind: 'note', x: 40, y: 280, w: 280, h: 200 },
      { id: 'd', kind: 'note', x: 360, y: 280, w: 280, h: 200 },
    ], connections: [{ id: 'ab', from: 'a', to: 'b', label: 'Manual', bend: .3 }] };
    const spaced = spaceBoard(original);
    expect(spaced.cards.map(c => [c.x, c.y])).toEqual([[40, 40], [440, 40], [40, 360], [440, 360]]);
    expect(spaced.cards.map(({x,y,...rest}) => rest)).toEqual(original.cards.map(({x,y,...rest}) => rest));
    expect(spaced.connections).toBe(original.connections);
    expect(spaceBoard(spaced)).toBe(spaced);
    expect(original.cards[1]!.x).toBe(360);
  });

  it('keeps overlapping clusters together, leaves wide gaps alone and expands containing sections', () => {
    const original: Board = { ...emptyBoard(), cards: [
      { id: 'a', kind: 'note', x: -100, y: 0, w: 200, h: 160 },
      { id: 'b', kind: 'note', x: -80, y: 20, w: 200, h: 160 },
      { id: 'c', kind: 'note', x: 140, y: 400, w: 200, h: 160 },
    ], sections: [{id:'s', title:'Group', x:-120,y:-20,w:480,h:600}] };
    const spaced = spaceBoard(original);
    expect(spaced.cards.map(c => [c.x, c.y])).toEqual([[-100, 0], [-80, 20], [240, 400]]);
    expect(spaced.sections[0]).toEqual({...original.sections[0],w:580});
    expect(cardsInSection(spaced, 's')).toEqual(cardsInSection(original, 's'));
    expect(spaceBoard(emptyBoard())).toEqual(emptyBoard());
  });

  it('spaces touching cards without resizing them and refuses to exceed board bounds', () => {
    let board = addNote(addNote(emptyBoard(), 'a', {x:0,y:0}), 'b', {x:200,y:0});
    expect(spaceBoard(board).cards[1]!.x).toBe(320);
    board = moveBoard(board, {a:{x:999_780},b:{x:1_000_000}});
    expect(spaceBoard(board)).toBe(board);
  });
});

describe('board edits', () => {
  it('adds notes with the first post-it color and sections with a title', () => {
    let board = addNote(emptyBoard(), 'n1', { x: 10, y: 20 });
    board = addSection(board, 's1', { x: 0, y: 0 }, 'Pagamentos');
    expect(board.cards[0]).toMatchObject({ id: 'n1', kind: 'note', text: '', color: NOTE_COLORS[0], x: 10, y: 20 });
    expect(board.sections[0]).toMatchObject({ id: 's1', title: 'Pagamentos', x: 0, y: 0 });
  });

  it('finds a free spot for a new note next to the requested point', () => {
    const board = reconcileBoard(emptyBoard(), manifest);
    expect(freeSpot(board, { x: 1000, y: 1000 }, NOTE_SIZE)).toEqual({ x: 1000, y: 1000 });
    // The item cards fill the row at y = 40 (and the cell below overlaps the first card): the closest free cell is above.
    expect(freeSpot(board, { x: 40, y: 40 }, NOTE_SIZE)).toEqual({ x: 40, y: -140 });
  });

  describe('freeSpot (nearest free cell around the point, inside the visible bounds)', () => {
    const notesAt = (...points: { x: number; y: number }[]) => points.reduce((b, at, i) => addNote(b, `n${i}`, at), emptyBoard());

    it('(a) skips cells outside the bounds (e.g. to the right) and picks a free one inside them', () => {
      const board = notesAt({ x: 0, y: 0 });
      expect(freeSpot(board, { x: 0, y: 0 }, NOTE_SIZE, { x: 0, y: 0, w: 200, h: 1000 })).toEqual({ x: 0, y: 180 });
    });

    it('(b) returns the point itself when every candidate inside the bounds overlaps a card', () => {
      const board = moveBoard(notesAt({ x: 0, y: 0 }), { n0: { w: 250, h: 200 } });
      expect(freeSpot(board, { x: 10, y: 10 }, NOTE_SIZE, { x: 0, y: 0, w: 250, h: 200 })).toEqual({ x: 10, y: 10 });
    });

    it('(c) without bounds, prefers a free neighbour above or to the left when it is closer than any cell to the right', () => {
      expect(freeSpot(notesAt({ x: 0, y: 0 }, { x: 0, y: 180 }), { x: 0, y: 0 }, NOTE_SIZE)).toEqual({ x: 0, y: -180 });
      const boxedIn = notesAt({ x: 0, y: 0 }, { x: 0, y: 180 }, { x: 0, y: -180 }, { x: 220, y: 0 });
      expect(freeSpot(boxedIn, { x: 0, y: 0 }, NOTE_SIZE)).toEqual({ x: -220, y: 0 });
    });

    it('breaks ties toward the right and below', () => {
      expect(freeSpot(notesAt({ x: 0, y: 0 }), { x: 0, y: 0 }, NOTE_SIZE)).toEqual({ x: 0, y: 180 });
      expect(freeSpot(notesAt({ x: 0, y: 0 }, { x: 0, y: 180 }, { x: 0, y: -180 }), { x: 0, y: 0 }, NOTE_SIZE)).toEqual({ x: 220, y: 0 });
    });
  });

  it('connects each pair of cards once and never a card to itself', () => {
    let board = addNote(addNote(emptyBoard(), 'a', { x: 0, y: 0 }), 'b', { x: 300, y: 0 });
    board = connectCards(board, 'c1', 'a', 'b');
    expect(connectCards(board, 'c2', 'b', 'a')).toBe(board);
    expect(connectCards(board, 'c3', 'a', 'a')).toBe(board);
    expect(connectCards(board, 'c4', 'a', 'ghost')).toBe(board);
    expect(board.connections).toEqual([{ id: 'c1', from: 'a', to: 'b' }]);
  });

  it('moves, updates and removes (removing a card removes its connections)', () => {
    let board = addNote(addNote(emptyBoard(), 'a', { x: 0, y: 0 }), 'b', { x: 300, y: 0 });
    board = addSection(connectCards(board, 'c1', 'a', 'b'), 's1', { x: 0, y: 0 }, 'S');
    board = moveBoard(board, { a: { x: 5, y: 6 }, s1: { x: 7, y: 8, w: 900, h: 500 } });
    expect(board.cards[0]).toMatchObject({ x: 5, y: 6 });
    expect(board.sections[0]).toMatchObject({ x: 7, y: 8, w: 900, h: 500 });
    board = updateCard(board, 'a', { text: 'oi', color: NOTE_COLORS[2] });
    board = updateSection(board, 's1', { title: 'Novo' });
    expect(board.cards[0]).toMatchObject({ text: 'oi', color: NOTE_COLORS[2] });
    expect(board.sections[0]!.title).toBe('Novo');
    board = removeFromBoard(board, ['b', 's1']);
    expect(board.cards.map((c) => c.id)).toEqual(['a']);
    expect(board.sections).toEqual([]);
    expect(board.connections).toEqual([]);
  });

  describe('updateConnection (label and bend of the middle segment)', () => {
    const linked = () => connectCards(addNote(addNote(emptyBoard(), 'a', { x: 0, y: 0 }), 'b', { x: 300, y: 0 }), 'c1', 'a', 'b');

    it('sets a label (whitespace collapsed, at most 200 characters) and removes it with null or an empty text', () => {
      let board = updateConnection(linked(), 'c1', { label: '  HTTP\n  /  gRPC\t' });
      expect(board.connections[0]).toEqual({ id: 'c1', from: 'a', to: 'b', label: 'HTTP / gRPC' });
      expect(updateConnection(board, 'c1', { label: 'x'.repeat(300) }).connections[0]!.label).toHaveLength(200);
      expect(updateConnection(board, 'c1', { label: null }).connections[0]).toEqual({ id: 'c1', from: 'a', to: 'b' });
      board = updateConnection(board, 'c1', { label: ' \n ' });
      expect(board.connections[0]).toEqual({ id: 'c1', from: 'a', to: 'b' });
    });

    it('sets the bend clamped to [0.05, 0.95], removes it with null and leaves fields missing from the patch alone', () => {
      let board = updateConnection(linked(), 'c1', { label: 'HTTP', bend: 0.3 });
      expect(board.connections[0]).toMatchObject({ label: 'HTTP', bend: 0.3 });
      expect(updateConnection(board, 'c1', { bend: -2 }).connections[0]!.bend).toBe(0.05);
      expect(updateConnection(board, 'c1', { bend: 7 }).connections[0]!.bend).toBe(0.95);
      expect(updateConnection(board, 'c1', { bend: Number.NaN }).connections[0]!.bend).toBe(0.3);
      board = updateConnection(board, 'c1', { bend: null });
      expect(board.connections[0]).toEqual({ id: 'c1', from: 'a', to: 'b', label: 'HTTP' });
    });

    it('returns the same board for an unknown id', () => {
      const board = linked();
      expect(updateConnection(board, 'ghost', { label: 'x' })).toBe(board);
      expect(updateConnection(board, 'constructor', { bend: 0.2 })).toBe(board);
    });
  });

  it('finds the cards whose center lies inside a section', () => {
    let board = addSection(emptyBoard(), 's', { x: 0, y: 0 }, 'S');
    board = moveBoard(board, { s: { x: 0, y: 0, w: 500, h: 400 } });
    board = addNote(addNote(board, 'in', { x: 100, y: 100 }), 'out', { x: 450, y: 350 });
    expect(cardsInSection(board, 's')).toEqual(['in']);
  });
});

describe('board.json', () => {
  it('round-trips and rounds coordinates', () => {
    let board = reconcileBoard(emptyBoard(), manifest);
    board = moveBoard(board, { [itemCardId('doc', 'api')]: { x: 10.6, y: -3.2 } });
    const text = printBoard(board);
    expect(text).toContain('"x": 11');
    expect(parseBoard(text)).toEqual(moveBoard(board, { 'doc:api': { x: 11, y: -3 } }));
  });

  it('drops invalid cards, sections and connections and falls back to an empty board', () => {
    const text = JSON.stringify({
      version: 1,
      cards: [{ id: 'n', kind: 'note', x: 0, y: 0, w: 10, h: 10, color: 'url(evil)' }, { id: 'x', kind: 'video', x: 0, y: 0, w: 1, h: 1 }],
      sections: [{ id: 's', title: 3 }],
      connections: [{ id: 'c', from: 'n', to: 'missing' }],
    });
    expect(parseBoard(text)).toEqual({ version: 1, cards: [{ id: 'n', kind: 'note', x: 0, y: 0, w: 10, h: 10 }], sections: [], connections: [] });
    expect(parseBoard(null)).toEqual(emptyBoard());
    expect(parseBoard('nope')).toEqual(emptyBoard());
  });

  it('drops a note card impersonating an item card id, so reconcileBoard still cards the real item', () => {
    const text = JSON.stringify({
      version: 1,
      cards: [{ id: 'diagram:loja', kind: 'note', x: 0, y: 0, w: 10, h: 10 }],
      sections: [],
      connections: [],
    });
    const board = parseBoard(text);
    expect(board.cards).toEqual([]);
    const reconciled = reconcileBoard(board, { ...emptyManifest('x'), diagrams: [{ slug: 'loja', title: 'Loja' }] });
    expect(reconciled.cards).toEqual([{ id: 'diagram:loja', kind: 'diagram', slug: 'loja', x: 40, y: 40, ...CARD_SIZE }]);
  });

  it('drops item cards with a missing slug or an id that does not match itemCardId, taking their connections along', () => {
    const text = JSON.stringify({
      version: 1,
      cards: [
        { id: 'diagram:sem-slug', kind: 'diagram', x: 0, y: 0, w: 10, h: 10 },
        { id: 'diagram:errado', kind: 'diagram', slug: 'loja', x: 0, y: 0, w: 10, h: 10 },
        { id: 'diagram:loja', kind: 'diagram', slug: 'loja', x: 0, y: 0, w: 10, h: 10 },
        { id: 'n1', kind: 'note', x: 0, y: 0, w: 10, h: 10 },
      ],
      sections: [],
      connections: [
        { id: 'c1', from: 'diagram:sem-slug', to: 'n1' },
        { id: 'c2', from: 'diagram:errado', to: 'n1' },
        { id: 'c3', from: 'diagram:loja', to: 'n1' },
      ],
    });
    const board = parseBoard(text);
    expect(board.cards.map((c) => c.id)).toEqual(['diagram:loja', 'n1']);
    expect(board.connections.map((c) => c.id)).toEqual(['c3']);
  });

  it('(a) drops boxes that are too big or too far away', () => {
    const text = JSON.stringify({
      version: 1,
      cards: [{ id: 'longe', kind: 'note', x: 1e9, y: 0, w: 10, h: 10 }, { id: 'ok', kind: 'note', x: -1_000_000, y: 1_000_000, w: 100_000, h: 10 }],
      sections: [{ id: 'enorme', title: 'S', x: 0, y: 0, w: 1e300, h: 10 }],
      connections: [],
    });
    const board = parseBoard(text);
    expect(board.cards.map((c) => c.id)).toEqual(['ok']);
    expect(board.sections).toEqual([]);
  });

  it('(c) drops __proto__ ids, item-shaped section ids and repeated ids (cards and sections share one namespace)', () => {
    const note = (id: string, x = 0) => ({ id, kind: 'note', x, y: 0, w: 10, h: 10 });
    const section = (id: string) => ({ id, title: 'S', x: 0, y: 0, w: 10, h: 10 });
    const text = JSON.stringify({
      version: 1,
      cards: [note('__proto__'), note('n1'), note('n1', 50), note('n2')],
      sections: [section('__proto__'), section('diagram:x'), section('n2'), section('s1')],
      connections: [
        { id: '__proto__', from: 'n1', to: 'n2' },
        { id: 'c1', from: 'n1', to: 'n2' },
        { id: 'c1', from: 'n2', to: 'n1' },
      ],
    });
    const board = parseBoard(text);
    expect(board.cards.map((c) => [c.id, c.x])).toEqual([['n1', 0], ['n2', 0]]);
    expect(board.sections.map((s) => s.id)).toEqual(['s1']);
    expect(board.connections).toEqual([{ id: 'c1', from: 'n1', to: 'n2' }]);
  });

  it('keeps a connection label (one line, at most 200 characters) and a finite bend clamped to [0.05, 0.95]', () => {
    const note = (id: string) => ({ id, kind: 'note', x: 0, y: 0, w: 10, h: 10 });
    const text = JSON.stringify({
      version: 1,
      cards: [note('a'), note('b'), note('c'), note('d')],
      sections: [],
      connections: [
        { id: 'c1', from: 'a', to: 'b', label: 'HTTP\n\n  REST ', bend: 0.25 },
        { id: 'c2', from: 'a', to: 'c', label: 'y'.repeat(500), bend: 3 },
        { id: 'c3', from: 'a', to: 'd', label: 42, bend: 'far' },
        { id: 'c4', from: 'b', to: 'c', label: '   ', bend: -1 },
        { id: 'c5', from: 'b', to: 'd', bend: null },
      ],
    });
    const connections = parseBoard(text).connections;
    expect(connections[0]).toEqual({ id: 'c1', from: 'a', to: 'b', label: 'HTTP REST', bend: 0.25 });
    expect(connections[1]!.label).toHaveLength(200);
    expect(connections[1]!.bend).toBe(0.95);
    expect(connections[2]).toEqual({ id: 'c3', from: 'a', to: 'd' });
    expect(connections[3]).toEqual({ id: 'c4', from: 'b', to: 'c', bend: 0.05 });
    expect(connections[4]).toEqual({ id: 'c5', from: 'b', to: 'd' });
  });

  it('prints the bend rounded to 3 decimals and round-trips label and bend', () => {
    let board = connectCards(addNote(addNote(emptyBoard(), 'a', { x: 0, y: 0 }), 'b', { x: 300, y: 0 }), 'c1', 'a', 'b');
    board = updateConnection(board, 'c1', { label: 'HTTP', bend: 0.123456 });
    const text = printBoard(board);
    expect(text).toContain('"bend": 0.123');
    expect(parseBoard(text).connections).toEqual([{ id: 'c1', from: 'a', to: 'b', label: 'HTTP', bend: 0.123 }]);
  });

  it('keeps at most BOARD_MAX_ITEMS cards', () => {
    const cards = Array.from({ length: BOARD_MAX_ITEMS + 5 }, (_, i) => ({ id: `n${i}`, kind: 'note', x: 0, y: 0, w: 10, h: 10 }));
    expect(parseBoard(JSON.stringify({ version: 1, cards, sections: [], connections: [] })).cards).toHaveLength(BOARD_MAX_ITEMS);
  });

  it('accepts only valid CSS hex color lengths (3, 4, 6 or 8 digits)', () => {
    const card = (id: string, color: string) => ({ id, kind: 'note', x: 0, y: 0, w: 10, h: 10, color });
    const text = JSON.stringify({
      version: 1,
      cards: [
        card('bad5', '#12345'),
        card('bad7', '#1234567'),
        card('ok3', '#abc'),
        card('ok4', '#abcd'),
        card('ok6', '#aabbcc'),
        card('ok8', '#aabbccdd'),
      ],
      sections: [],
      connections: [],
    });
    const colors = Object.fromEntries(parseBoard(text).cards.map((c) => [c.id, c.color]));
    expect(colors).toEqual({ bad5: undefined, bad7: undefined, ok3: '#abc', ok4: '#abcd', ok6: '#aabbcc', ok8: '#aabbccdd' });
  });
});
