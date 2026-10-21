import { own } from './ids';
import { sameTableFields, STYLE_KEYS, UPDATABLE_PROP_KEYS } from './model';
import type { DiagramElement, DiagramModel, DiagramOp, EdgeEl, ID, UpdatableProps } from './model';

export interface ChangeSet {
  added: ID[];
  removed: ID[];
  changed: ID[];
}

export interface ModelChanges {
  /** `added`/`changed` hold ids in `next`; `removed` holds ids in `prev` (a removed group's descendants included). */
  elements: ChangeSet;
  /** Same convention with edge ids. Edges are matched by content, never by id. */
  edges: ChangeSet;
  /** prev id → next id of renamed elements (they are also in `elements.changed`). */
  renamed: Record<ID, ID>;
  /** The diagram style (direction, colorMode, styleMode, typeface) differs. */
  style: boolean;
}

/** Renames made by a batch, as original id → final id (chains followed; elements created in the batch ignored). */
export function renamesIn(prev: DiagramModel, ops: readonly DiagramOp[]): Record<ID, ID> {
  const current = new Map<ID, ID>(prev.order.map((id) => [id, id]));
  for (const op of ops) {
    if (op.op !== 'rename' || op.id === op.to) continue;
    for (const [original, now] of current) {
      if (now !== op.id) continue;
      current.set(original, op.to);
      break;
    }
  }
  const renamed: Record<ID, ID> = {};
  for (const [original, now] of current) if (original !== now) renamed[original] = now;
  return renamed;
}

function differs(a: DiagramElement, b: DiagramElement, toNext: (id: ID) => ID): boolean {
  if (a.kind !== b.kind) return true;
  if ((a.parentId === undefined ? undefined : toNext(a.parentId)) !== b.parentId) return true;
  const pa = a as UpdatableProps;
  const pb = b as UpdatableProps;
  return UPDATABLE_PROP_KEYS.some((key) => key === 'fields' ? !sameTableFields(pa.fields, pb.fields) : pa[key] !== pb[key]);
}

const ends = (from: ID, to: ID) => `${from}\u0000${to}`;
const content = (edge: EdgeEl, from: ID, to: ID) => [ends(from, to), edge.connector, edge.label ?? '', edge.color ?? '', edge.fromPort ?? '', edge.toPort ?? '', edge.fromCardinality ?? '', edge.toCardinality ?? ''].join('\u0000');

/**
 * Semantic classification of `prev` → `next` for the AI draft overlay and the version compare (M5).
 * Elements match by id (or through `renamed`); edges match by content like diffModels' planEdges:
 * equal edges are unchanged, leftovers with the same (renamed) ends are changed, the rest removed/added.
 */
export function compareModels(prev: DiagramModel, next: DiagramModel, renamed: Readonly<Record<ID, ID>> = {}): ModelChanges {
  const toNext = (id: ID) => own(renamed, id) ?? id;
  const matched = new Map<ID, ID>();
  const kept: Record<ID, ID> = {};
  const elements: ChangeSet = { added: [], removed: [], changed: [] };
  for (const id of prev.order) {
    const target = toNext(id);
    if (Object.hasOwn(next.elements, target) && !matched.has(target)) {
      matched.set(target, id);
      if (target !== id) kept[id] = target;
    } else {
      elements.removed.push(id);
    }
  }
  for (const id of next.order) {
    const old = matched.get(id);
    if (old === undefined) elements.added.push(id);
    else if (old !== id || differs(prev.elements[old]!, next.elements[id]!, toNext)) elements.changed.push(id);
  }

  const edges: ChangeSet = { added: [], removed: [], changed: [] };
  const pool = new Map<string, number[]>();
  let previousMessage = 0;
  prev.edges.forEach((edge, i) => {
    const sequence = prev.elements[edge.from]?.presentation === 'participant' && prev.elements[edge.to]?.presentation === 'participant';
    const key = `${sequence ? `message:${++previousMessage}\u0000` : ''}${content(edge, toNext(edge.from), toNext(edge.to))}`;
    pool.set(key, [...(pool.get(key) ?? []), i]);
  });
  const used = new Set<number>();
  const leftovers: EdgeEl[] = [];
  let nextMessage = 0;
  for (const edge of next.edges) {
    const sequence = next.elements[edge.from]?.presentation === 'participant' && next.elements[edge.to]?.presentation === 'participant';
    const key = `${sequence ? `message:${++nextMessage}\u0000` : ''}${content(edge, edge.from, edge.to)}`;
    const i = pool.get(key)?.shift();
    if (i === undefined) leftovers.push(edge);
    else used.add(i);
  }
  for (const edge of leftovers) {
    const i = prev.edges.findIndex((old, j) => !used.has(j) && ends(toNext(old.from), toNext(old.to)) === ends(edge.from, edge.to));
    if (i < 0) {
      edges.added.push(edge.id);
      continue;
    }
    used.add(i);
    edges.changed.push(edge.id);
  }
  prev.edges.forEach((edge, i) => {
    if (!used.has(i)) edges.removed.push(edge.id);
  });

  return { elements, edges, renamed: kept, style: STYLE_KEYS.some((key) => prev.style[key] !== next.style[key]) };
}
