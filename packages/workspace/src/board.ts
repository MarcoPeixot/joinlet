import { RESERVED_NAME, own } from '@strukt/core';
import { stableStringify } from './json';
import { ITEM_KINDS, ITEM_LIST } from './manifest';
import type { ItemKind, Manifest } from './manifest';

/**
 * The Quadro (overview board, `board.json`): cards for workspace items plus free notes, sections
 * that frame cards and connections between cards. Pure data; the canvas is a projection.
 */
export type CardKind = ItemKind | 'note';

export interface BoardCard {
  id: string;
  kind: CardKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Item cards: the item's slug. */
  slug?: string;
  /** Notes: text and post-it color. */
  text?: string;
  color?: string;
}

export interface BoardSection {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoardConnection {
  id: string;
  from: string;
  to: string;
  label?: string;
  /** Where the middle segment of the elbow line sits, as a fraction of the gap between the cards (0.5 when absent). */
  bend?: number;
}

export interface Board {
  version: 1;
  cards: BoardCard[];
  sections: BoardSection[];
  connections: BoardConnection[];
}

/** Post-it colors (from Lacuna's Quadro): pastels that read in light and dark themes, with dark text. */
export const NOTE_COLORS = ['#fdf3b5', '#d9f2c5', '#cfe4ff', '#ffd9e0', '#e6dcff', '#ffe3bd'] as const;
export const CARD_SIZE = { w: 280, h: 200 };
export const NOTE_SIZE = { w: 200, h: 160 };
export const SECTION_SIZE = { w: 640, h: 420 };
const GRID = { x: 40, y: 40, gap: 40, columns: 4 };
/** Bounds for a hand-edited or hostile `board.json` (sizes and coordinates, and entries per list). */
export const BOARD_MAX_COORD = 1_000_000;
export const BOARD_MAX_SIZE = 100_000;
export const BOARD_MAX_ITEMS = 5_000;
/** A connection label is one line of at most this many characters. */
export const CONNECTION_LABEL_MAX = 200;
const BEND_MIN = 0.05;
const BEND_MAX = 0.95;
/** Grid cells tried for a new item card before going below everything. */
const FREE_CELL_SCAN = 2000;
const GRID_ROWS = FREE_CELL_SCAN / GRID.columns;
const GRID_STEP = { x: CARD_SIZE.w + GRID.gap, y: CARD_SIZE.h + GRID.gap };

type Box = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };

export const itemCardId = (kind: ItemKind, slug: string) => `${kind}:${slug}`;

export function emptyBoard(): Board {
  return { version: 1, cards: [], sections: [], connections: [] };
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * `[lo, hi]`: the indexes `i` in `[0, count)` whose cell `[origin + i·step, + size)` overlaps
 * `[start, start + length)` (strictly, like `overlaps`); empty when `lo > hi`.
 */
function cellSpan(start: number, length: number, origin: number, step: number, size: number, count: number): [number, number] {
  const hits = (i: number) => start < origin + i * step + size && origin + i * step < start + length;
  let lo = Math.min(count, Math.max(0, Math.floor((start - origin - size) / step) + 1));
  let hi = Math.max(-1, Math.min(count - 1, Math.ceil((start + length - origin) / step) - 1));
  // The divisions can round across a cell edge: settle both ends on the exact predicate.
  while (lo > 0 && hits(lo - 1)) lo--;
  while (lo <= hi && !hits(lo)) lo++;
  while (hi < count - 1 && hits(hi + 1)) hi++;
  while (hi >= lo && !hits(hi)) hi--;
  return [lo, hi];
}

/**
 * The grid cells (row-major, 4 columns, the first `FREE_CELL_SCAN`) that overlap no box, in order.
 * Linear in boxes + cells: per column, each box adds +1/−1 at the ends of the rows it covers.
 */
function freeCells(taken: readonly Box[]): number[] {
  const cover = new Int32Array(GRID.columns * (GRID_ROWS + 1));
  for (const box of taken) {
    const [c0, c1] = cellSpan(box.x, box.w, GRID.x, GRID_STEP.x, CARD_SIZE.w, GRID.columns);
    const [r0, r1] = cellSpan(box.y, box.h, GRID.y, GRID_STEP.y, CARD_SIZE.h, GRID_ROWS);
    if (c0 > c1 || r0 > r1) continue;
    for (let c = c0; c <= c1; c++) {
      cover[c * (GRID_ROWS + 1) + r0]! += 1;
      cover[c * (GRID_ROWS + 1) + r1 + 1]! -= 1;
    }
  }
  const covered = new Uint8Array(FREE_CELL_SCAN);
  for (let c = 0; c < GRID.columns; c++) {
    let depth = 0;
    for (let r = 0; r < GRID_ROWS; r++) {
      depth += cover[c * (GRID_ROWS + 1) + r]!;
      if (depth > 0) covered[r * GRID.columns + c] = 1;
    }
  }
  const free: number[] = [];
  for (let i = 0; i < FREE_CELL_SCAN; i++) if (!covered[i]) free.push(i);
  return free;
}

/**
 * Every item gets exactly one card; cards of removed items go away with their connections. New cards
 * take the free grid cells in order; once those run out, they stack below everything on the board.
 */
export function reconcileBoard(board: Board, manifest: Manifest): Board {
  const wanted = new Map<string, { kind: ItemKind; slug: string }>();
  for (const kind of ITEM_KINDS) for (const { slug } of manifest[ITEM_LIST[kind]]) wanted.set(itemCardId(kind, slug), { kind, slug });
  const kept = board.cards.filter((card) => card.kind === 'note' || wanted.has(card.id));
  const present = new Set(kept.map((card) => card.id));
  const missing = [...wanted].filter(([id]) => !present.has(id));
  if (!missing.length && kept.length === board.cards.length) return board;
  const cards = [...kept];
  const taken: readonly Box[] = [...kept, ...board.sections];
  const free = freeCells(taken);
  let bottom = taken.reduce((max, box) => Math.max(max, box.y + box.h), GRID.y);
  missing.forEach(([id, { kind, slug }], k) => {
    const i = free[k];
    const spot =
      i === undefined
        ? { x: GRID.x, y: bottom + GRID.gap }
        : { x: GRID.x + (i % GRID.columns) * GRID_STEP.x, y: GRID.y + Math.floor(i / GRID.columns) * GRID_STEP.y };
    bottom = Math.max(bottom, spot.y + CARD_SIZE.h);
    cards.push({ id, kind, slug, ...spot, ...CARD_SIZE });
  });
  const ids = new Set(cards.map((card) => card.id));
  return { ...board, cards, connections: board.connections.filter((c) => ids.has(c.from) && ids.has(c.to)) };
}

const RING = 6;
/** 0, 1, −1, 2, −2, …: a stable sort by distance then keeps right before left and below before above. */
const RING_ORDER = [0, ...Array.from({ length: RING }, (_, i) => [i + 1, -(i + 1)]).flat()];

const inside = (box: Box, bounds: Box) =>
  box.x >= bounds.x && box.y >= bounds.y && box.x + box.w <= bounds.x + bounds.w && box.y + box.h <= bounds.y + bounds.h;

/**
 * The closest cell around `at` (up to 6 steps each way, nearest first) where a box of `size` covers
 * no card and, when `bounds` is given (the visible pane), fits inside it; `at` itself when none does.
 */
export function freeSpot(board: Board, at: Point, size: { w: number; h: number }, bounds?: Box): Point {
  const step = { x: size.w + GRID.gap / 2, y: size.h + GRID.gap / 2 };
  const candidates = RING_ORDER.flatMap((row) => RING_ORDER.map((col) => ({ col, row, distance: Math.hypot(col * step.x, row * step.y) })));
  candidates.sort((a, b) => a.distance - b.distance);
  for (const { col, row } of candidates) {
    const box = { x: at.x + col * step.x, y: at.y + row * step.y, ...size };
    if (bounds && !inside(box, bounds)) continue;
    if (!board.cards.some((card) => overlaps(card, box))) return { x: box.x, y: box.y };
  }
  return at;
}

export function addNote(board: Board, id: string, at: Point, color: string = NOTE_COLORS[0]): Board {
  return { ...board, cards: [...board.cards, { id, kind: 'note', text: '', color, x: at.x, y: at.y, ...NOTE_SIZE }] };
}

export function addSection(board: Board, id: string, at: Point, title: string): Board {
  return { ...board, sections: [...board.sections, { id, title, x: at.x, y: at.y, ...SECTION_SIZE }] };
}

/** One connection per pair of distinct, existing cards (either direction counts). */
export function connectCards(board: Board, id: string, from: string, to: string): Board {
  const ids = new Set(board.cards.map((card) => card.id));
  if (from === to || !ids.has(from) || !ids.has(to)) return board;
  if (board.connections.some((c) => (c.from === from && c.to === to) || (c.from === to && c.to === from))) return board;
  return { ...board, connections: [...board.connections, { id, from, to }] };
}

/** Moves (and optionally resizes) cards and sections by id. */
export function moveBoard(board: Board, boxes: Readonly<Record<string, Partial<Box>>>): Board {
  const place = <T extends Box & { id: string }>(item: T): T => {
    const box = own(boxes, item.id);
    return box ? { ...item, ...box } : item;
  };
  return { ...board, cards: board.cards.map(place), sections: board.sections.map(place) };
}

export function updateCard(board: Board, id: string, patch: Pick<Partial<BoardCard>, 'text' | 'color'>): Board {
  return { ...board, cards: board.cards.map((card) => (card.id === id ? { ...card, ...patch } : card)) };
}

export function updateSection(board: Board, id: string, patch: Pick<Partial<BoardSection>, 'title'>): Board {
  return { ...board, sections: board.sections.map((section) => (section.id === id ? { ...section, ...patch } : section)) };
}

/** One line (whitespace runs collapsed), at most `CONNECTION_LABEL_MAX` characters; empty means no label. */
const connectionLabel = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, CONNECTION_LABEL_MAX);
export const clampBend = (bend: number) => Math.min(BEND_MAX, Math.max(BEND_MIN, bend));

/**
 * Sets or removes (`null`) a connection's label and bend; a field missing from the patch, or a
 * non-finite bend, is left alone. An unknown id returns the same board.
 */
export function updateConnection(board: Board, id: string, patch: { label?: string | null; bend?: number | null }): Board {
  if (!board.connections.some((c) => c.id === id)) return board;
  const edit = ({ label, bend, ...rest }: BoardConnection): BoardConnection => {
    if (patch.label !== undefined) label = patch.label === null ? undefined : connectionLabel(patch.label) || undefined;
    if (patch.bend === null) bend = undefined;
    else if (patch.bend !== undefined && Number.isFinite(patch.bend)) bend = clampBend(patch.bend);
    return { ...rest, ...(label ? { label } : {}), ...(bend !== undefined ? { bend } : {}) };
  };
  return { ...board, connections: board.connections.map((c) => (c.id === id ? edit(c) : c)) };
}

/** Removes cards, sections and connections by id; a removed card takes its connections along. */
export function removeFromBoard(board: Board, ids: readonly string[]): Board {
  const gone = new Set(ids);
  const cards = board.cards.filter((card) => !gone.has(card.id));
  const kept = new Set(cards.map((card) => card.id));
  return {
    ...board,
    cards,
    sections: board.sections.filter((section) => !gone.has(section.id)),
    connections: board.connections.filter((c) => !gone.has(c.id) && kept.has(c.from) && kept.has(c.to)),
  };
}

/** Cards whose center lies inside the section: they move along when the section is dragged. */
export function cardsInSection(board: Board, sectionId: string): string[] {
  const s = board.sections.find((section) => section.id === sectionId);
  if (!s) return [];
  return board.cards.filter((c) => {
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    return cx >= s.x && cx <= s.x + s.w && cy >= s.y && cy <= s.y + s.h;
  }).map((c) => c.id);
}

const round = <T extends Box>(item: T): T => ({ ...item, x: Math.round(item.x), y: Math.round(item.y), w: Math.round(item.w), h: Math.round(item.h) });
const roundBend = (c: BoardConnection): BoardConnection => (c.bend === undefined ? c : { ...c, bend: Math.round(c.bend * 1000) / 1000 });

export function printBoard(board: Board): string {
  return stableStringify({ ...board, cards: board.cards.map(round), sections: board.sections.map(round), connections: board.connections.map(roundBend) });
}

const CARD_KINDS = new Set<string>([...ITEM_KINDS, 'note']);
const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBox = (v: Partial<Box>) =>
  finite(v.x) && finite(v.y) && finite(v.w) && finite(v.h) &&
  Math.abs(v.x) <= BOARD_MAX_COORD && Math.abs(v.y) <= BOARD_MAX_COORD &&
  v.w > 0 && v.h > 0 && v.w <= BOARD_MAX_SIZE && v.h <= BOARD_MAX_SIZE;
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
/** Any id shaped like an item card's (`<kind>:...`), whatever the card's own `kind` field claims to be. */
const looksLikeItemCardId = (id: string) => ITEM_KINDS.some((kind) => id.startsWith(`${kind}:`));

/**
 * Lenient: invalid entries are dropped; a missing or broken file is an empty board (reconcile
 * refills it). Item-kind cards are trusted only when `id === itemCardId(kind, slug)` — a
 * hand-edited or hostile file can't otherwise plant a fake card at a real item's id and make
 * `reconcileBoard` skip carding that item (nor plant a `note` or a section at that id, since
 * notes and sections never get an item-shaped id). Cards and sections share React Flow's node
 * namespace, so an id is kept once across both (first wins); `__proto__` is never an id.
 */
export function parseBoard(text: string | null): Board {
  if (!text) return emptyBoard();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return emptyBoard();
  }
  if (!data || typeof data !== 'object') return emptyBoard();
  const nodeIds = new Set<string>();
  /** Keeps at most `BOARD_MAX_ITEMS` entries that `parse` accepts. */
  const bounded = <T>(raw: unknown, parse: (entry: Record<string, unknown>) => T | null): T[] => {
    const out: T[] = [];
    for (const entry of list(raw)) {
      if (out.length >= BOARD_MAX_ITEMS) break;
      const parsed = parse(entry);
      if (parsed) out.push(parsed);
    }
    return out;
  };
  const freshId = (id: unknown, seen: Set<string>): id is string => typeof id === 'string' && id !== RESERVED_NAME && !seen.has(id);

  const cards = bounded(data.cards, (c): BoardCard | null => {
    if (!freshId(c.id, nodeIds) || typeof c.kind !== 'string' || !CARD_KINDS.has(c.kind) || !isBox(c)) return null;
    if (c.kind === 'note') {
      if (looksLikeItemCardId(c.id)) return null;
    } else if (typeof c.slug !== 'string' || c.id !== itemCardId(c.kind as ItemKind, c.slug)) {
      return null;
    }
    nodeIds.add(c.id);
    return {
      id: c.id,
      kind: c.kind as CardKind,
      x: c.x as number, y: c.y as number, w: c.w as number, h: c.h as number,
      ...(typeof c.slug === 'string' ? { slug: c.slug } : {}),
      ...(typeof c.text === 'string' ? { text: c.text } : {}),
      ...(typeof c.color === 'string' && HEX.test(c.color) ? { color: c.color } : {}),
    };
  });
  const cardIds = new Set(cards.map((c) => c.id));
  const sections = bounded(data.sections, (s): BoardSection | null => {
    if (!freshId(s.id, nodeIds) || looksLikeItemCardId(s.id) || typeof s.title !== 'string' || !isBox(s)) return null;
    nodeIds.add(s.id);
    return { id: s.id, title: s.title, x: s.x as number, y: s.y as number, w: s.w as number, h: s.h as number };
  });
  const connectionIds = new Set<string>();
  const connections = bounded(data.connections, (c): BoardConnection | null => {
    if (!freshId(c.id, connectionIds) || typeof c.from !== 'string' || typeof c.to !== 'string' || !cardIds.has(c.from) || !cardIds.has(c.to)) return null;
    connectionIds.add(c.id);
    const label = typeof c.label === 'string' ? connectionLabel(c.label) : '';
    return { id: c.id, from: c.from, to: c.to, ...(label ? { label } : {}), ...(finite(c.bend) ? { bend: clampBend(c.bend) } : {}) };
  });
  return { version: 1, cards, sections, connections };
}
