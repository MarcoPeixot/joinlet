import { applyOps } from './applyOps';
import { own } from './ids';
import { sameTableFields, STYLE_KEYS, UPDATABLE_PROP_KEYS } from './model';
import type { DiagramElement, DiagramModel, DiagramOp, DiagramStyle, EdgeEl, ID, PropPatch, UpdatableProps } from './model';
import { depthOf, topLevel } from './tree';

export interface SemanticView {
  style: DiagramStyle;
  ids: ID[];
  elements: Record<ID, Omit<DiagramElement, 'span'>>;
  edges: string[];
}

const edgeKey = (e: EdgeEl) => [e.from, e.to, e.connector, e.label ?? '', e.color ?? '', e.fromPort ?? '', e.toPort ?? '', e.fromCardinality ?? '', e.toCardinality ?? ''].join('\u0000');

/** Meaning without ids/spans/order noise; sequence message order is part of the meaning. */
export function semanticView(model: DiagramModel): SemanticView {
  const elements: SemanticView['elements'] = {};
  for (const id of Object.keys(model.elements).sort()) {
    const { span: _span, ...rest } = model.elements[id]!;
    elements[id] = rest;
  }
  let message = 0;
  const edges = model.edges.map(edge => {
    const sequence = model.elements[edge.from]?.presentation === 'participant' && model.elements[edge.to]?.presentation === 'participant';
    return `${sequence ? `message:${++message}\u0000` : ''}${edgeKey(edge)}`;
  }).sort();
  return { style: { ...model.style }, ids: [...model.order].sort(), elements, edges };
}

function propPatch(from: DiagramElement, to: DiagramElement): PropPatch {
  const a = from as UpdatableProps;
  const b = to as UpdatableProps;
  const set: Record<string, unknown> = {};
  for (const key of UPDATABLE_PROP_KEYS) if (key === 'fields' ? !sameTableFields(a.fields, b.fields) : a[key] !== b[key]) set[key] = b[key] ?? null;
  return set as PropPatch;
}

function byDepth(model: DiagramModel, ids: ID[]): ID[] {
  return [...ids].sort((x, y) => depthOf(model, x) - depthOf(model, y));
}

/** One removed + one added element of the same kind under the same (renamed) parent = a rename. */
function detectRenames(prev: DiagramModel, next: DiagramModel): Map<ID, ID> {
  const removed = prev.order.filter((id) => !own(next.elements, id));
  const added = next.order.filter((id) => !own(prev.elements, id));
  const renamed = new Map<ID, ID>();
  const maxDepth = Math.max(0, ...removed.map((id) => depthOf(prev, id)));
  for (let depth = 0; depth <= maxDepth; depth++) {
    const buckets = new Map<string, { gone: ID[]; born: ID[] }>();
    const bucket = (el: DiagramElement, parent: ID | undefined) => {
      const key = `${el.kind}\u0000${parent ?? ''}`;
      const entry = buckets.get(key) ?? { gone: [], born: [] };
      buckets.set(key, entry);
      return entry;
    };
    for (const id of removed) {
      const el = prev.elements[id]!;
      if (depthOf(prev, id) === depth) bucket(el, el.parentId && (renamed.get(el.parentId) ?? el.parentId)).gone.push(id);
    }
    for (const id of added) {
      const el = next.elements[id]!;
      if (depthOf(next, id) === depth) bucket(el, el.parentId).born.push(id);
    }
    for (const { gone, born } of buckets.values()) if (gone.length === 1 && born.length === 1) renamed.set(gone[0]!, born[0]!);
  }
  return renamed;
}

interface EdgePlan {
  /** Reference the ids of `prev`, so they must run first in the batch. */
  byId: DiagramOp[];
  connects: DiagramOp[];
  /** Target position → index in the edge list the batch leaves before its final `reorder`. */
  permutation: number[];
}

/**
 * Matches surviving edges (endpoints already renamed) against the target list: equal edges stay,
 * leftovers with the same ends become `update_edge`, the rest are removed or connected.
 */
function planEdges(current: readonly EdgeEl[], target: readonly EdgeEl[]): EdgePlan {
  const pool = new Map<string, number[]>();
  current.forEach((edge, i) => pool.set(edgeKey(edge), [...(pool.get(edgeKey(edge)) ?? []), i]));
  const realizes: (number | undefined)[] = current.map(() => undefined);
  const missing: number[] = [];
  target.forEach((edge, t) => {
    const i = pool.get(edgeKey(edge))?.shift();
    if (i === undefined) missing.push(t);
    else realizes[i] = t;
  });
  const byId: DiagramOp[] = [];
  const connects: DiagramOp[] = [];
  const appended: number[] = [];
  for (const t of missing) {
    const edge = target[t]!;
    const i = current.findIndex((old, j) => realizes[j] === undefined && old.from === edge.from && old.to === edge.to);
    if (i < 0) {
      connects.push({
        op: 'connect', from: edge.from, to: edge.to, connector: edge.connector,
        ...(edge.fromCardinality ? { fromCardinality: edge.fromCardinality } : {}), ...(edge.toCardinality ? { toCardinality: edge.toCardinality } : {}), ...(edge.fromPort ? { fromPort: edge.fromPort } : {}), ...(edge.toPort ? { toPort: edge.toPort } : {}), ...(edge.label ? { label: edge.label } : {}), ...(edge.color ? { color: edge.color } : {}),
      });
      appended.push(t);
      continue;
    }
    realizes[i] = t;
    const old = current[i]!;
    const set: Extract<DiagramOp, { op: 'update_edge' }>['set'] = {};
    if (old.fromCardinality !== edge.fromCardinality) set.fromCardinality = edge.fromCardinality ?? null;
    if (old.toCardinality !== edge.toCardinality) set.toCardinality = edge.toCardinality ?? null;
    if (old.fromPort !== edge.fromPort) set.fromPort = edge.fromPort ?? null;
    if (old.toPort !== edge.toPort) set.toPort = edge.toPort ?? null;
    if (old.connector !== edge.connector) set.connector = edge.connector;
    if (old.label !== edge.label) set.label = edge.label ?? null;
    if (old.color !== edge.color) set.color = edge.color ?? null;
    byId.push({ op: 'update_edge', edgeId: old.id, set });
  }
  current.forEach((edge, i) => {
    if (realizes[i] === undefined) byId.push({ op: 'remove_edge', edgeId: edge.id });
  });
  const slots = [...realizes.filter((t): t is number => t !== undefined), ...appended];
  return { byId, connects, permutation: target.map((_, t) => slots.indexOf(t)) };
}

/**
 * Ops that turn `prev` into `next` (both valid models) in one batch, preserving `order` and edge order.
 * Edge ids are only referenced before anything else runs (they are `prev`'s, normalized), so the result
 * does not depend on how ids evolve inside the batch.
 */
export function diffModels(prev: DiagramModel, next: DiagramModel): DiagramOp[] {
  const ops: DiagramOp[] = [];
  let work = prev;
  const run = (batch: DiagramOp[]) => {
    if (!batch.length) return;
    const result = applyOps(work, batch);
    if (!result.ok) throw new Error(`diffModels: ${result.error.message}`);
    work = result.model;
    ops.push(...batch);
  };

  const renamed = detectRenames(prev, next);
  const alias = (id: ID) => renamed.get(id) ?? id;
  const kept = (id: ID) => own(next.elements, alias(id))?.kind === own(prev.elements, id)?.kind;
  const current = prev.edges
    .filter((edge) => kept(edge.from) && kept(edge.to))
    .map((edge) => ({ ...edge, from: alias(edge.from), to: alias(edge.to) }));
  const edges = planEdges(current, next.edges);

  run(edges.byId);
  run([...renamed].map(([id, to]): DiagramOp => ({ op: 'rename', id, to })));

  const survivors = next.order.filter((id) => own(work.elements, id)?.kind === next.elements[id]!.kind);
  const reparented = survivors.filter((id) => work.elements[id]!.parentId !== next.elements[id]!.parentId);
  // Detach first: it never creates a cycle and rescues survivors from removed groups.
  run(reparented.filter((id) => work.elements[id]!.parentId).map((id): DiagramOp => ({ op: 'move_to_group', id, parentId: null })));

  const doomed = work.order.filter((id) => own(next.elements, id)?.kind !== work.elements[id]!.kind);
  run(topLevel(work, doomed).map((id): DiagramOp => ({ op: 'remove', id })));

  const additions: DiagramOp[] = [];
  for (const id of byDepth(next, next.order.filter((id) => !own(work.elements, id)))) {
    const el = next.elements[id]!;
    const parent = el.parentId ? { parentId: el.parentId } : {};
    additions.push(el.kind === 'group' ? { op: 'add_group', id, ...parent } : { op: 'add_node', id, ...parent });
    const set = propPatch({ kind: el.kind, id } as DiagramElement, el);
    if (Object.keys(set).length) additions.push({ op: 'update', id, set });
  }
  run(additions);

  run(
    byDepth(next, reparented.filter((id) => next.elements[id]!.parentId)).map(
      (id): DiagramOp => ({ op: 'move_to_group', id, parentId: next.elements[id]!.parentId! }),
    ),
  );

  run(
    survivors.flatMap((id): DiagramOp[] => {
      const set = propPatch(work.elements[id]!, next.elements[id]!);
      return Object.keys(set).length ? [{ op: 'update', id, set }] : [];
    }),
  );

  const style: Partial<DiagramStyle> = {};
  for (const key of STYLE_KEYS) if (work.style[key] !== next.style[key]) Object.assign(style, { [key]: next.style[key] });
  run(Object.keys(style).length ? [{ op: 'set_style', set: style }] : []);

  run(edges.connects);

  const reorder: Extract<DiagramOp, { op: 'reorder' }> = { op: 'reorder' };
  if (work.order.some((id, i) => id !== next.order[i])) reorder.order = [...next.order];
  if (edges.permutation.some((j, i) => j !== i)) reorder.edges = edges.permutation;
  run(reorder.order || reorder.edges ? [reorder] : []);
  return ops;
}
