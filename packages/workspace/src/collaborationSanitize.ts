import { CARDINALITIES, validTableFields, LAYOUT_ROLES, PRESENTATIONS, PORTS, COLOR_MODES, CONNECTORS, DEFAULT_STYLE, DIRECTIONS, RESERVED_NAME, SHAPES, STYLE_MODES, TYPEFACES, own, validParents } from '@strukt/core';
import type { Connector, DiagramElement, DiagramModel, DiagramStyle, EdgeEl, ID, NodeBox } from '@strukt/core';
import type { DiagramSnapshot } from './diagram';

/** A room the host will not open or keep in step (its message, pt-BR, is safe to show a guest and to log). */
export class CollaborationRefusal extends Error {}

export const COLLAB_MAX_ELEMENTS = 20_000;
export const COLLAB_MAX_EDGES = 50_000;
export const COLLAB_MAX_COORDINATE = 10_000_000;
/** Group ancestors an element may have: the printed file nests two JSON levels per group, and the parser stops at 64. */
export const COLLAB_MAX_DEPTH = 31;
/** Longest string (value or key) the host accepts in a diagram doc; about one packet. Text is never cut, only refused. */
export const COLLAB_MAX_FIELD = 1_000_000;
const REPAIRS_PER_KIND = 10;

export type CollaborativeRepairKind = 'record' | 'reserved' | 'id' | 'field' | 'parent' | 'cycle' | 'depth' | 'edge' | 'position' | 'order' | 'limit';

/** One thing the reader fixed, with the element/edge it was found on: for server logs, never shown in the UI. */
export interface CollaborativeRepair {
  kind: CollaborativeRepairKind;
  id: string;
}

type Fields = Record<string, unknown>;
type Note = (kind: CollaborativeRepairKind, id: string) => void;

const TEXT_PROPS = ['label', 'icon', 'color', 'tech', 'description', 'link'] as const;
const ENUM_PROPS = { colorMode: COLOR_MODES, styleMode: STYLE_MODES, typeface: TYPEFACES } as const;
const ELEMENT_ENUMS = { ...ENUM_PROPS, presentation: PRESENTATIONS, layoutRole: LAYOUT_ROLES };
const ENUM_ENTRIES = Object.entries(ELEMENT_ENUMS);
const STYLE_ENTRIES = Object.entries({ direction: DIRECTIONS, ...ENUM_PROPS });
const ELEMENT_KEYS = new Set(['kind', 'id', 'canvasFrame', 'parentId', 'shape', 'fields', ...TEXT_PROPS, ...Object.keys(ELEMENT_ENUMS)]);
const STYLE_KEYS = new Set(STYLE_ENTRIES.map(([key]) => key));
const EDGE_KEYS = new Set(['id', 'from', 'to', 'connector', 'label', 'color', 'fromPort', 'toPort', 'fromCardinality', 'toCardinality']);
const BOX_KEYS = new Set(['x', 'y', 'w', 'h']);

const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === 'string' && (values as readonly string[]).includes(value);
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const coordinate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= COLLAB_MAX_COORDINATE;
const size = (value: unknown): value is number => coordinate(value) && value >= 0;

/** Whether every key of `raw` is one of `allowed` (a loop: no key array per record). */
function onlyKeys(raw: Fields, allowed: ReadonlySet<string>): boolean {
  for (const key in raw) if (!allowed.has(key)) return false;
  return true;
}

/** The string props of an element or edge: kept whole when they are text (never cut), dropped otherwise. */
function copyText(raw: Fields, keys: readonly string[], out: Fields): boolean {
  let repaired = false;
  for (const key of keys) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value === 'string') out[key] = value;
    else repaired = true;
  }
  return repaired;
}

function element(id: ID, raw: Fields, note: Note): DiagramElement {
  const kind = raw.kind === 'group' ? 'group' : 'node';
  if (raw.id !== id) note('id', id);
  const out: Fields = { kind, id };
  let repaired = raw.kind !== kind || !onlyKeys(raw, ELEMENT_KEYS);
  if (raw.parentId !== undefined) {
    if (typeof raw.parentId === 'string' && raw.parentId) out.parentId = raw.parentId;
    else repaired = true;
  }
  if (raw.canvasFrame !== undefined) {
    if (kind === 'group' && typeof raw.canvasFrame === 'boolean') out.canvasFrame = raw.canvasFrame;
    else repaired = true;
  }
  if (raw.shape !== undefined) {
    if (kind === 'node' && oneOf(SHAPES, raw.shape)) out.shape = raw.shape;
    else repaired = true;
  }
  if (raw.fields !== undefined) {
    if (kind === 'node' && validTableFields(raw.fields)) out.fields = structuredClone(raw.fields);
    else repaired = true;
  }
  if (copyText(raw, TEXT_PROPS, out)) repaired = true;
  for (const [key, values] of ENUM_ENTRIES) {
    if (raw[key] === undefined) continue;
    if (oneOf(values, raw[key])) out[key] = raw[key];
    else repaired = true;
  }
  if (repaired) note('field', id);
  return out as unknown as DiagramElement;
}

function edge(raw: Fields, elements: Record<ID, DiagramElement>, note: Note): EdgeEl | null {
  const { id, from, to } = raw;
  if (typeof id !== 'string' || !id || id === RESERVED_NAME) {
    note(id === RESERVED_NAME ? 'reserved' : 'id', String(id));
    return null;
  }
  if (typeof from !== 'string' || typeof to !== 'string' || !own(elements, from) || !own(elements, to)) {
    note('edge', id);
    return null;
  }
  const connector: Connector = oneOf(CONNECTORS, raw.connector) ? raw.connector : '>';
  const out: Fields = { id, from, to, connector };
  let repaired = copyText(raw, ['label', 'color'], out);
  for (const key of ['fromPort', 'toPort']) if (raw[key] !== undefined) { if (oneOf(PORTS, raw[key])) out[key] = raw[key]; else repaired = true; }
  for (const key of ['fromCardinality', 'toCardinality']) if (raw[key] !== undefined) { if (oneOf(CARDINALITIES, raw[key])) out[key] = raw[key]; else repaired = true; }
  if (repaired || connector !== raw.connector || !onlyKeys(raw, EDGE_KEYS)) note('field', id);
  return out as unknown as EdgeEl;
}

function style(raw: unknown, note: Note): DiagramStyle {
  const fields = isFields(raw) ? raw : {};
  const out: Fields = { ...DEFAULT_STYLE };
  let repaired = !onlyKeys(fields, STYLE_KEYS);
  for (const [key, values] of STYLE_ENTRIES) {
    if (fields[key] === undefined) continue;
    if (oneOf(values, fields[key])) out[key] = fields[key];
    else repaired = true;
  }
  if (repaired) note('field', 'style');
  return out as unknown as DiagramStyle;
}

function box(raw: unknown, id: ID, note: Note): NodeBox | null {
  if (!isFields(raw) || !coordinate(raw.x) || !coordinate(raw.y)) {
    note('position', id);
    return null;
  }
  const out: NodeBox = { x: raw.x, y: raw.y };
  let repaired = !onlyKeys(raw, BOX_KEYS);
  for (const key of ['w', 'h'] as const) {
    if (raw[key] === undefined) continue;
    if (size(raw[key])) out[key] = raw[key];
    else repaired = true;
  }
  if (repaired) note('position', id);
  return out;
}

/**
 * Walks the (acyclic) tree from the top: an element that would get more than `COLLAB_MAX_DEPTH` group ancestors goes
 * to the top level with its subtree, which is then measured from there. The depth depends only on the tree, so every
 * peer detaches the same elements.
 */
function limitDepth(elements: Record<ID, DiagramElement>, order: ID[], note: Note): void {
  const children = new Map<ID, ID[]>();
  const stack: Array<[ID, number]> = [];
  for (const id of order) {
    const parentId = elements[id]!.parentId;
    if (parentId === undefined) stack.push([id, 0]);
    else if (children.has(parentId)) children.get(parentId)!.push(id);
    else children.set(parentId, [id]);
  }
  while (stack.length) {
    const [id, depth] = stack.pop()!;
    for (const child of children.get(id) ?? []) {
      if (depth < COLLAB_MAX_DEPTH) {
        stack.push([child, depth + 1]);
        continue;
      }
      note('depth', child);
      delete elements[child]!.parentId;
      stack.push([child, 0]);
    }
  }
}

/**
 * A collaborative doc can hold what no single `applyOps` batch produces: concurrent valid edits merge into a parent
 * cycle, a parent or endpoint a peer removed, and a hostile peer can write anything. Every read of the doc goes
 * through here, so each peer and the server derive the same valid diagram from the same doc state (the host then
 * writes the same repairs into the doc, see `repairCollaborativeDiagram`):
 * - the map key is the id (`__proto__` and empty keys are dropped); a record that is not an object is dropped; kind
 *   is `node` unless it is `group`; props of the wrong type are dropped; text is never cut (the host refuses updates
 *   past `COLLAB_MAX_FIELD` instead);
 * - `order` keeps the first listing of each element and appends the unlisted ones by id; past
 *   `COLLAB_MAX_ELEMENTS` (in that order) elements are dropped, a last resort for rooms bloated before the host
 *   bounded updates;
 * - a parent that is missing or not a group is dropped and every parent cycle loses the link of its greatest id
 *   (`validParents`): the element stays, at the top level; so does an element deeper than `COLLAB_MAX_DEPTH`;
 * - edges need a string id and both endpoints (the first of a repeated id wins), at most `COLLAB_MAX_EDGES`;
 * - positions need finite x/y within ±`COLLAB_MAX_COORDINATE` (else the element is placed again), w/h within
 *   [0, `COLLAB_MAX_COORDINATE`], and an element.
 * Every rule looks only at the data, never at the order keys were inserted in, and a valid diagram comes back equal,
 * so the result is idempotent. Never throws; `repairs` lists what was fixed (at most 10 per kind).
 */
export function sanitizeCollaborativeDiagram(input: DiagramSnapshot): { snapshot: DiagramSnapshot; repairs: CollaborativeRepair[] } {
  const repairs: CollaborativeRepair[] = [];
  const counts = new Map<CollaborativeRepairKind, number>();
  const note: Note = (kind, id) => {
    const count = counts.get(kind) ?? 0;
    counts.set(kind, count + 1);
    if (count < REPAIRS_PER_KIND) repairs.push({ kind, id });
  };
  const source = isFields(input) ? (input as unknown as Fields) : {};
  const rawModel = isFields(source.model) ? source.model : {};
  const rawLayout = isFields(source.layout) ? source.layout : {};
  const rawElements = isFields(rawModel.elements) ? rawModel.elements : {};

  const candidates = new Map<ID, DiagramElement>();
  for (const id of Object.keys(rawElements)) {
    if (id === RESERVED_NAME) note('reserved', id);
    else if (!id) note('id', id);
    else if (!isFields(rawElements[id])) note('record', id);
    else candidates.set(id, element(id, rawElements[id], note));
  }

  const listed = new Set<ID>();
  if (!Array.isArray(rawModel.order) && candidates.size) note('order', '');
  for (const id of Array.isArray(rawModel.order) ? rawModel.order : []) {
    if (typeof id === 'string' && candidates.has(id) && !listed.has(id)) listed.add(id);
    else if (typeof id !== 'string' || listed.has(id) || !Object.hasOwn(rawElements, id)) note('order', String(id));
  }
  const unlisted = [...candidates.keys()].filter((id) => !listed.has(id)).sort(byId);
  for (const id of unlisted) note('order', id);
  const all = [...listed, ...unlisted];
  const order = all.slice(0, COLLAB_MAX_ELEMENTS);
  if (all.length > order.length) note('limit', all[order.length]!);

  const elements: Record<ID, DiagramElement> = {};
  for (const id of order) elements[id] = candidates.get(id)!;
  const model: DiagramModel = { style: style(rawModel.style, note), elements, order, edges: [], diagnostics: [] };
  const parents = validParents(model);
  for (const id of order) {
    const el = elements[id]!;
    if (el.parentId === undefined || parents.get(id) === el.parentId) continue;
    note(own(elements, el.parentId)?.kind === 'group' ? 'cycle' : 'parent', id);
    delete el.parentId;
  }
  limitDepth(elements, order, note);

  const edges = model.edges;
  const edgeIds = new Set<ID>();
  for (const raw of Array.isArray(rawModel.edges) ? rawModel.edges : []) {
    if (!isFields(raw)) {
      note('record', '');
      continue;
    }
    const kept = edge(raw, elements, note);
    if (!kept) continue;
    if (edgeIds.has(kept.id)) {
      note('id', kept.id);
      continue;
    }
    if (edges.length === COLLAB_MAX_EDGES) {
      note('limit', kept.id);
      break;
    }
    edgeIds.add(kept.id);
    edges.push(kept);
  }

  const rawNodes = isFields(rawLayout.nodes) ? rawLayout.nodes : {};
  const nodes: Record<ID, NodeBox> = {};
  for (const id of order) {
    if (!Object.hasOwn(rawNodes, id)) continue;
    const kept = box(rawNodes[id], id, note);
    if (kept) nodes[id] = kept;
  }
  for (const id of Object.keys(rawNodes)) {
    if (id === RESERVED_NAME) note('reserved', id);
    else if (!own(elements, id)) note('position', id);
  }

  return { snapshot: { model, layout: { nodes, edges: {} } }, repairs };
}
