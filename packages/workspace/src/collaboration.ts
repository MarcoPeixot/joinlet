import * as Y from 'yjs';
import { emptyLayout, emptyModel, own } from '@strukt/core';
import { COLLAB_MAX_EDGES, COLLAB_MAX_ELEMENTS, COLLAB_MAX_FIELD, CollaborationRefusal, sanitizeCollaborativeDiagram } from './collaborationSanitize';
import type { CollaborativeRepair } from './collaborationSanitize';
import type { DiagramSnapshot } from './diagram';

/** Origin of the host's repair transactions: clients receive them as any remote update and never write repairs. */
export const COLLAB_REPAIR = Symbol('strukt collaboration repair');
/** Origin of what the host merges into a room from the files (an agent's or a checkout's write): sent to every peer. */
export const COLLAB_EXTERNAL = Symbol('strukt collaboration external write');

type FieldMap = Y.Map<unknown>;

const fields = (doc: Y.Doc, name: string) => doc.getMap<FieldMap>(name);

function changeFields(target: FieldMap, before: object, after: object): void {
  const old = before as Record<string, unknown>;
  const next = after as Record<string, unknown>;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(old[key]) === JSON.stringify(next[key])) continue;
    if (Object.hasOwn(after, key)) target.set(key, next[key]);
    else target.delete(key);
  }
}

function changeRecords<T extends object>(
  target: Y.Map<FieldMap>,
  before: Record<string, T>,
  after: Record<string, T>,
): void {
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const old = own(before, id);
    const next = own(after, id);
    if (old && !next) {
      target.delete(id);
      continue;
    }
    if (!next) continue;
    const record: unknown = target.get(id);
    if (record instanceof Y.Map) {
      changeFields(record, old ?? {}, next);
      continue;
    }
    // Missing, or something a hostile peer wrote that is not a record (the read skipped it): a fresh record with every field.
    const fresh = new Y.Map<unknown>();
    target.set(id, fresh);
    changeFields(fresh, {}, next);
  }
}

function indexById<T extends { id: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

function changeOrder(target: Y.Map<number>, before: string[], after: string[]): void {
  const previous = new Map(before.map((id, index) => [id, index]));
  const next = new Set(after);
  for (const id of before) if (!next.has(id)) target.delete(id);
  for (const [index, id] of after.entries()) if (previous.get(id) !== index) target.set(id, index);
}

/** By order value, then id. A value that is not a finite number sorts last: the comparison stays consistent on every peer. */
function orderedIds(order: Y.Map<unknown>, ids: Iterable<string>): string[] {
  const index = new Map<string, number>();
  for (const id of ids) {
    const value = order.get(id);
    index.set(id, typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER);
  }
  return [...index.keys()].sort((a, b) => index.get(a)! - index.get(b)! || (a < b ? -1 : a > b ? 1 : 0));
}

/** Plain fields of each record; a value that is not a map (a hostile peer can write anything) becomes `null`. */
function records(source: Y.Map<unknown>): Record<string, unknown> {
  return Object.fromEntries([...source.entries()].map(([id, value]) => [id, value instanceof Y.Map ? Object.fromEntries(value.entries()) : null]));
}

/** The server seeds an empty room once; subsequent clients exchange Yjs updates. */
export function seedCollaborativeDiagram(doc: Y.Doc, snapshot: DiagramSnapshot): void {
  const meta = doc.getMap<boolean>('meta');
  if (meta.get('initialized')) return;
  applyCollaborativeDiagramDelta(doc, { model: emptyModel(), layout: emptyLayout() }, snapshot);
  meta.set('initialized', true);
}

/** Publish only fields changed by this edit. A stale snapshot cannot delete an unrelated peer edit. */
export function applyCollaborativeDiagramDelta(doc: Y.Doc, before: DiagramSnapshot, after: DiagramSnapshot, origin?: unknown): void {
  doc.transact(() => {
    changeFields(doc.getMap('style'), before.model.style, after.model.style);
    changeRecords(fields(doc, 'elements'), before.model.elements, after.model.elements);
    changeRecords(fields(doc, 'edges'), indexById(before.model.edges), indexById(after.model.edges));
    changeRecords(fields(doc, 'positions'), before.layout.nodes, after.layout.nodes);
    changeOrder(doc.getMap<number>('element-order'), before.model.order, after.model.order);
    changeOrder(doc.getMap<number>('edge-order'), before.model.edges.map((edge) => edge.id), after.model.edges.map((edge) => edge.id));
  }, origin);
}

/** The doc as a diagram, repaired by `sanitizeCollaborativeDiagram` (the same result on every peer), plus what was repaired. */
export function inspectCollaborativeDiagram(doc: Y.Doc): { snapshot: DiagramSnapshot; repairs: CollaborativeRepair[] } | null {
  if (!doc.getMap<boolean>('meta').get('initialized')) return null;
  const elements = records(doc.getMap('elements'));
  const edges = records(doc.getMap('edges'));
  const mismatched: CollaborativeRepair[] = [];
  const edgeList = orderedIds(doc.getMap('edge-order'), Object.keys(edges)).map((id) => {
    const edge = edges[id] as Record<string, unknown> | null;
    if (!edge || edge.id === id) return edge;
    mismatched.push({ kind: 'id', id });
    return { ...edge, id };
  });
  const read = sanitizeCollaborativeDiagram({
    model: {
      style: Object.fromEntries(doc.getMap('style').entries()),
      elements,
      order: orderedIds(doc.getMap('element-order'), Object.keys(elements)),
      edges: edgeList,
      diagnostics: [],
    },
    layout: { nodes: records(doc.getMap('positions')), edges: {} },
  } as unknown as DiagramSnapshot);
  return { snapshot: read.snapshot, repairs: [...mismatched.slice(0, 10), ...read.repairs] };
}

/** What every peer shows and the server writes: always a valid diagram, whatever concurrent or hostile edits merged into the doc. */
export function readCollaborativeDiagram(doc: Y.Doc): DiagramSnapshot | null {
  return inspectCollaborativeDiagram(doc)?.snapshot ?? null;
}

/**
 * What a local edit will read as once the host has repaired it, or null when it needs no repair: the editor's own
 * model through the read repairs (in practice a move nested past `COLLAB_MAX_DEPTH`). The host's doc equals its view
 * after every repair, so this is exactly where the room converges; a client shows it at once and writes nothing.
 */
export function repairedLocalDiagram(snapshot: DiagramSnapshot): DiagramSnapshot | null {
  const read = sanitizeCollaborativeDiagram(snapshot);
  return read.repairs.length ? read.snapshot : null;
}

/**
 * The host's side of the read repairs: writes into the doc, in one transaction with `origin`, exactly what makes the
 * raw doc equal to its repaired view (`inspectCollaborativeDiagram`). Every peer already shows that view, so nothing
 * changes on screen; what goes is the hidden state a later edit would bring back (a stale parent link after a cycle,
 * an edge to a removed element, a parent a peer removed), plus hostile or wrong-typed values:
 * - records, fields, boxes and edges the view dropped are deleted; `id`, a missing/unknown `kind` and an unknown
 *   connector are set to what the view shows; a style value the view ignores is deleted;
 * - order entries become the positions the view shows (0…n-1; entries without element go): local edits write view
 *   positions (`changeOrder`), so arbitrary merged values (ties, 1e300, NaN, none) would misplace the next insert.
 * Deterministic (the writes depend only on the doc state) and idempotent: a clean doc gets no transaction at all
 * (`update: null`). Deletes remove only the items this doc holds, so a concurrent peer write to the same key survives.
 * Call it outside of any other transaction; `update` is that transaction's update.
 */
export function repairCollaborativeDiagram(
  doc: Y.Doc,
  origin: unknown = COLLAB_REPAIR,
  /** The doc's `inspectCollaborativeDiagram` as it is now, when the caller already has it. */
  read = inspectCollaborativeDiagram(doc),
): { update: Uint8Array | null; repairs: CollaborativeRepair[] } {
  if (!read) return { update: null, repairs: [] };
  const { model, layout } = read.snapshot;
  const edges: Record<string, object> = Object.fromEntries(model.edges.map((edge) => [edge.id, edge]));
  const repairs = [...read.repairs];
  let orderNotes = repairs.filter((repair) => repair.kind === 'order').length;
  const writes: Array<() => void> = [];

  const records = (name: string, view: Record<string, object>) => {
    const target = doc.getMap<unknown>(name);
    for (const [key, value] of target.entries()) {
      const wanted = own(view, key) as Record<string, unknown> | undefined;
      if (!wanted || !(value instanceof Y.Map)) {
        writes.push(() => target.delete(key));
        continue;
      }
      for (const field of value.keys()) if (!Object.hasOwn(wanted, field)) writes.push(() => value.delete(field));
      for (const [field, next] of Object.entries(wanted)) if (value.get(field) !== next) writes.push(() => value.set(field, next));
    }
  };
  const order = (name: string, ids: readonly string[]) => {
    const target = doc.getMap<unknown>(name);
    const index = new Map(ids.map((id, position) => [id, position]));
    const note = (id: string) => { if (orderNotes++ < 10) repairs.push({ kind: 'order', id }); };
    for (const key of target.keys()) if (!index.has(key)) {
      writes.push(() => target.delete(key));
      note(key);
    }
    for (const [id, position] of index) if (target.get(id) !== position) {
      writes.push(() => target.set(id, position));
      note(id);
    }
  };
  // The read notes every record, field, box, edge and style it changes; only order values go unnoted. So a read
  // without repairs (the usual case) leaves just the order maps to compare.
  if (read.repairs.length) {
    records('elements', model.elements);
    records('edges', edges);
    records('positions', layout.nodes);
    const style = doc.getMap<unknown>('style');
    for (const [key, value] of style.entries()) if (own(model.style as unknown as Record<string, unknown>, key) !== value) writes.push(() => style.delete(key));
  }
  order('element-order', model.order);
  order('edge-order', model.edges.map((edge) => edge.id));
  if (!writes.length) return { update: null, repairs: [] };

  let update: Uint8Array | null = null;
  const capture = (next: Uint8Array, from: unknown) => { if (from === origin) update = next; };
  doc.on('update', capture);
  try { doc.transact(() => { for (const write of writes) write(); }, origin); }
  finally { doc.off('update', capture); }
  return { update, repairs };
}

const BOUNDS = [
  ['elements', COLLAB_MAX_ELEMENTS, 'elementos'],
  ['positions', COLLAB_MAX_ELEMENTS, 'posições'],
  ['element-order', COLLAB_MAX_ELEMENTS, 'elementos'],
  ['edges', COLLAB_MAX_EDGES, 'conexões'],
  ['edge-order', COLLAB_MAX_EDGES, 'conexões'],
  ['style', 100, 'estilos'],
] as const;

const longText = (value: unknown) => typeof value === 'string' && value.length > COLLAB_MAX_FIELD;

/**
 * Throws (pt-BR) when the raw doc, not its repaired view, is past what the host keeps: more entries in a map than
 * `COLLAB_MAX_ELEMENTS`/`COLLAB_MAX_EDGES`, or a key or string field longer than `COLLAB_MAX_FIELD`. An update that
 * would get there is refused whole; nothing is ever cut.
 */
export function checkCollaborativeDiagramBounds(doc: Y.Doc): void {
  for (const [name, max, what] of BOUNDS) {
    let count = 0;
    for (const [key, value] of doc.getMap<unknown>(name).entries()) {
      if (++count > max) throw new CollaborationRefusal(`Edição recusada: o diagrama passaria do limite de ${max} ${what} na colaboração.`);
      let long = key.length > COLLAB_MAX_FIELD || longText(value);
      if (!long && value instanceof Y.Map) for (const [field, inner] of value.entries()) if (field.length > COLLAB_MAX_FIELD || longText(inner)) long = true;
      if (long) throw new CollaborationRefusal(`Edição recusada: um texto do diagrama passa de ${COLLAB_MAX_FIELD} caracteres.`);
    }
  }
}

export function seedCollaborativeText(doc: Y.Doc, markdown: string): void {
  const meta = doc.getMap<boolean>('meta');
  if (meta.get('initialized')) return;
  doc.transact(() => {
    doc.getText('content').insert(0, markdown);
    meta.set('initialized', true);
  });
}
