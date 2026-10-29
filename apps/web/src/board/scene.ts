import { applyOps, computeRects, emptyModel, own } from '@strukt/core';
import type { DiagramModel, DiagramOp, EdgeEl, ID, NodeBox } from '@strukt/core';
import type { Board, BoardCard, BoardConnection, BoardSection } from '@strukt/workspace';
import type { Snapshot } from '../state/diagramStore';

/**
 * The Overview drawn by the diagram canvas: `board.json` as a diagram model. Sections are groups (a card belongs to
 * the smallest section around its center, the rule `cardsInSection` uses), cards are nodes at their saved size,
 * connections are edges. What the model has no field for (a card's kind and item, a connection's id and bend)
 * stays on the board: `matchConnections` finds the connection each edge draws.
 */

/**
 * Edge id → the board connection it draws: the n-th edge between two ends is the n-th connection between them, in
 * order (edge ids are renumbered when a sibling goes, connection ids never are, so matching by id would drift).
 */
export function matchConnections(edges: readonly EdgeEl[], connections: readonly BoardConnection[]): Map<ID, BoardConnection> {
  const byEnds = new Map<string, BoardConnection[]>();
  for (const c of connections) {
    const key = `${c.from}\u0000${c.to}`;
    byEnds.set(key, [...(byEnds.get(key) ?? []), c]);
  }
  const out = new Map<ID, BoardConnection>();
  for (const edge of edges) {
    const queue = byEnds.get(`${edge.from}\u0000${edge.to}`);
    const next = queue?.shift();
    if (next) out.set(edge.id, next);
  }
  return out;
}

const area = (s: BoardSection) => s.w * s.h;

function sectionOf(board: Board, card: BoardCard): BoardSection | undefined {
  const cx = card.x + card.w / 2;
  const cy = card.y + card.h / 2;
  let best: BoardSection | undefined;
  for (const s of board.sections) {
    if (cx >= s.x && cx <= s.x + s.w && cy >= s.y && cy <= s.y + s.h && (!best || area(s) < area(best))) best = s;
  }
  return best;
}

/** `title`: what a card is called (an item's title, a note's text). */
export function boardToScene(board: Board, title: (card: BoardCard) => string): Snapshot {
  const ops: DiagramOp[] = [];
  const nodes: Record<ID, NodeBox> = {};
  for (const s of board.sections) {
    ops.push({ op: 'add_group', id: s.id, label: s.title });
    nodes[s.id] = { x: s.x, y: s.y, w: s.w, h: s.h };
  }
  for (const card of board.cards) {
    const parentId = sectionOf(board, card)?.id;
    ops.push({ op: 'add_node', id: card.id, label: title(card), ...(parentId ? { parentId } : {}), ...(card.kind === 'note' && card.color ? { color: card.color } : {}) });
    nodes[card.id] = { x: card.x, y: card.y, w: card.w, h: card.h };
  }
  const ids = new Set([...board.sections.map((s) => s.id), ...board.cards.map((c) => c.id)]);
  const drawn = board.connections.filter((c) => c.from !== c.to && ids.has(c.from) && ids.has(c.to));
  for (const c of drawn) ops.push({ op: 'connect', from: c.from, to: c.to, ...(c.label ? { label: c.label } : {}) });
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return { model: result.model, layout: { nodes, edges: {} } };
}

const rounded = (r: { x: number; y: number; w: number; h: number }) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });

/**
 * The board once the canvas edited the scene, which drew the cards and sections in `drawn` (the rest, hidden by a
 * folder filter, is kept as it is, with its connections). Sections take the size the canvas gives them (hugging
 * their cards); a node the board does not know is a note made on the canvas, an edge it does not know a new
 * connection. Order is the board's, new entries last.
 */
export function sceneToBoard(snapshot: Snapshot, base: Board, drawn: ReadonlySet<ID>, newId: () => string = () => crypto.randomUUID()): Board {
  const { model, layout } = snapshot;
  const rects = computeRects(model, layout);
  const known = new Map(base.cards.map((c) => [c.id, c] as const));
  const cards: BoardCard[] = [];
  for (const card of base.cards) {
    const el = own(model.elements, card.id);
    if (!el) {
      if (!drawn.has(card.id)) cards.push(card);
      continue;
    }
    const at = rounded(rects[card.id]!);
    const next: BoardCard = { ...card, ...at };
    if (card.kind === 'note') {
      next.text = el.label ?? '';
      if (el.color) next.color = el.color;
    }
    cards.push(next);
  }
  for (const id of model.order) {
    const el = model.elements[id]!;
    if (el.kind !== 'node' || known.has(id)) continue;
    cards.push({ id, kind: 'note', ...rounded(rects[id]!), text: el.label ?? '', ...(el.color ? { color: el.color } : {}) });
  }
  const sections: BoardSection[] = [];
  const kept = new Set<ID>();
  for (const s of base.sections) {
    const el = own(model.elements, s.id);
    if (el) kept.add(s.id);
    if (!el) {
      if (!drawn.has(s.id)) sections.push(s);
      continue;
    }
    sections.push({ ...s, title: el.label ?? s.title, ...rounded(rects[s.id]!) });
  }
  for (const id of model.order) {
    const el = model.elements[id]!;
    if (el.kind === 'group' && !kept.has(id)) sections.push({ id, title: el.label ?? '', ...rounded(rects[id]!) });
  }
  const matched = matchConnections(model.edges, base.connections);
  const drawnBy = new Map([...matched].map(([edgeId, c]) => [c, edgeId] as const));
  const edges = new Map(model.edges.map((edge) => [edge.id, edge] as const));
  const labelled = (c: BoardConnection, label: string | undefined): BoardConnection => {
    const next = { ...c };
    if (label) next.label = label;
    else delete next.label;
    return next;
  };
  const connections: BoardConnection[] = [];
  for (const c of base.connections) {
    const edgeId = drawnBy.get(c);
    if (edgeId) connections.push(labelled(c, edges.get(edgeId)!.label));
    else if (!drawn.has(c.from) || !drawn.has(c.to)) connections.push(c);
  }
  for (const edge of model.edges) if (!matched.has(edge.id)) connections.push(labelled({ id: newId(), from: edge.from, to: edge.to }, edge.label));
  // A connection whose card is gone goes with it, even one the scene did not draw.
  const ends = new Set<ID>([...cards.map((c) => c.id), ...sections.map((x) => x.id)]);
  return { ...base, cards, sections, connections: connections.filter((c) => ends.has(c.from) && ends.has(c.to)) };
}

/**
 * What deleting the canvas selection does on the Overview: notes, sections and connections go (a section's cards
 * stay, moved out first); diagram, doc and sketch cards are refused, they go with their item from the sidebar.
 */
export function removalOps(model: DiagramModel, selection: { nodes: readonly ID[]; edges: readonly ID[] }, board: Board): { ops: DiagramOp[]; refused: boolean } {
  const items = new Set(board.cards.filter((card) => card.kind !== 'note').map((card) => card.id));
  const nodes = selection.nodes.filter((id) => own(model.elements, id));
  const ops: DiagramOp[] = model.edges.filter((edge) => selection.edges.includes(edge.id)).map((edge) => ({ op: 'remove_edge', edgeId: edge.id }));
  for (const id of nodes) {
    if (items.has(id)) continue;
    for (const child of model.order) if (model.elements[child]?.parentId === id) ops.push({ op: 'move_to_group', id: child, parentId: null });
    ops.push({ op: 'remove', id });
  }
  return { ops, refused: nodes.some((id) => items.has(id)) };
}
