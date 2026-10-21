import { DEFAULT_STYLE, STYLE_KEYS, UPDATABLE_PROP_KEYS, applyOps, childrenByParent, depthsOf, diffModels, emptyModel, isAncestor, own, sameTableFields } from '@strukt/core';
import type { DiagramElement, DiagramModel, DiagramOp, DiagramStyle, EdgeEl, ID, PropPatch, UpdatableProps } from '@strukt/core';
import type { SourceMode } from './sources';

export type MergeNoteKind =
  /** The source dropped the element but people had edited it: kept, and no longer managed by the sync. */
  | 'kept-edited'
  /** The source still has the element but people deleted it: not recreated. */
  | 'kept-deleted'
  /** Source and people both changed a property: people win. */
  | 'conflict'
  /** The source and the diagram disagree on node vs group: left alone. */
  | 'kind-conflict'
  /** An operation that no longer fits the diagram (e.g. would create a cycle) was skipped. */
  | 'skipped';

export interface MergeNote {
  kind: MergeNoteKind;
  id: ID;
  message: string;
}

export interface MergeResult {
  /** Apply to `current` with `applyOps` (or `planSnapshot`, which also places new nodes). */
  ops: DiagramOp[];
  notes: MergeNote[];
}

const MAX_REPAIRS = 200;

const propsOf = (el: DiagramElement): UpdatableProps => el as UpdatableProps;
const sameProp = (key: keyof UpdatableProps, a: UpdatableProps, b: UpdatableProps): boolean =>
  key === 'fields' ? sameTableFields(a.fields, b.fields) : a[key] === b[key];

/** Same identity as `diffModels` uses for connections: ends, connector, label and the visual extras. */
const edgeKey = (e: EdgeEl): string => [e.from, e.to, e.connector, e.label ?? '', e.color ?? '', e.fromPort ?? '', e.toPort ?? '', e.fromCardinality ?? '', e.toCardinality ?? ''].join('\u0000');

/** Everything `add_node`/`add_group` cannot carry goes in a follow-up `update` (the same split `diffModels` uses). */
function addOps(el: DiagramElement, parentId: ID | undefined): DiagramOp[] {
  const parent = parentId ? { parentId } : {};
  const ops: DiagramOp[] = [el.kind === 'group' ? { op: 'add_group', id: el.id, ...parent } : { op: 'add_node', id: el.id, ...parent }];
  const set: Record<string, unknown> = {};
  for (const key of UPDATABLE_PROP_KEYS) if (propsOf(el)[key] !== undefined) set[key] = propsOf(el)[key];
  if (Object.keys(set).length) ops.push({ op: 'update', id: el.id, set: set as PropPatch });
  return ops;
}

function connectOp(edge: EdgeEl): DiagramOp {
  return {
    op: 'connect', from: edge.from, to: edge.to, connector: edge.connector,
    ...(edge.fromCardinality ? { fromCardinality: edge.fromCardinality } : {}), ...(edge.toCardinality ? { toCardinality: edge.toCardinality } : {}),
    ...(edge.fromPort ? { fromPort: edge.fromPort } : {}), ...(edge.toPort ? { toPort: edge.toPort } : {}),
    ...(edge.label ? { label: edge.label } : {}), ...(edge.color ? { color: edge.color } : {}),
  };
}

function orderedByDepth(model: DiagramModel, wanted: readonly ID[]): ID[] {
  const depths = depthsOf(model);
  return wanted.map((id, index) => ({ id, index, depth: depths.get(id) ?? 0 })).sort((a, b) => a.depth - b.depth || a.index - b.index).map((entry) => entry.id);
}

/**
 * Several models as one: the first definition of an element wins, later ones only add what is missing (elements,
 * connections, a non-default style). Used to combine the sources of one diagram.
 */
export function unionModels(models: readonly DiagramModel[]): DiagramModel {
  let acc = emptyModel();
  const style: Partial<DiagramStyle> = {};
  for (const model of models) {
    for (const key of STYLE_KEYS) if (style[key] === undefined && model.style[key] !== DEFAULT_STYLE[key]) Object.assign(style, { [key]: model.style[key] });
    const ops: DiagramOp[] = [];
    const known = new Set<ID>(acc.order);
    for (const id of orderedByDepth(model, model.order.filter((x) => own(model.elements, x)))) {
      if (known.has(id)) continue;
      const el = own(model.elements, id)!;
      known.add(id);
      ops.push(...addOps(el, el.parentId && known.has(el.parentId) ? el.parentId : undefined));
    }
    const keys = new Set(acc.edges.map(edgeKey));
    for (const edge of model.edges) {
      const key = edgeKey(edge);
      if (keys.has(key) || !known.has(edge.from) || !known.has(edge.to)) continue;
      keys.add(key);
      ops.push(connectOp(edge));
    }
    const next = applyOps(acc, ops);
    if (!next.ok) throw new Error(`unionModels: ${next.error.message}`);
    acc = next.model;
  }
  const next = Object.keys(style).length ? applyOps(acc, [{ op: 'set_style', set: style }]) : null;
  if (next && !next.ok) throw new Error(`unionModels: ${next.error.message}`);
  return next?.ok ? next.model : acc;
}

/** Drops each op the model refuses (with a note) so one stale reference never blocks the whole sync. */
function repaired(current: DiagramModel, ops: DiagramOp[], notes: MergeNote[]): DiagramOp[] {
  let pending = ops;
  for (let attempt = 0; attempt < MAX_REPAIRS; attempt += 1) {
    const result = applyOps(current, pending);
    if (result.ok) return pending;
    const bad = pending[result.error.opIndex];
    const id = bad && 'id' in bad ? bad.id : bad && 'from' in bad ? `${bad.from}→${bad.to}` : '';
    notes.push({ kind: 'skipped', id, message: `Operação ignorada: ${result.error.message}` });
    pending = pending.filter((_, index) => index !== result.error.opIndex);
  }
  throw new Error('Sincronização inconsistente: operações demais foram recusadas.');
}

/**
 * Plans how `source` (what the importers just read) lands in `current` (the diagram people have been editing).
 * `base` is what the previous sync imported (`undefined` on the first run): it tells "the source changed this" from
 * "people changed this". Ids come from the source, so ids, order and positions of existing elements are never touched.
 *
 * - merge: a three-way merge. People win on every property they changed; what people added or deleted stays that way.
 * - replace: the diagram becomes the source (people's elements and connections go away), except that annotations the
 *   source is silent about (description, link, colors...) are kept.
 */
export function mergeIntoDiagram(current: DiagramModel, source: DiagramModel, base: DiagramModel | undefined, mode: SourceMode): MergeResult {
  return mode === 'replace' ? replaceDiagram(current, source, base) : mergeDiagram(current, source, base);
}

function replaceDiagram(current: DiagramModel, source: DiagramModel, base: DiagramModel | undefined): MergeResult {
  const elements = structuredClone(source.elements);
  for (const id of source.order) {
    const s = own(source.elements, id);
    const d = own(current.elements, id);
    if (!s || !d || s.kind !== d.kind) continue;
    const b = base && own(base.elements, id);
    for (const key of UPDATABLE_PROP_KEYS) {
      if (propsOf(s)[key] !== undefined || propsOf(d)[key] === undefined) continue;
      if (b && sameProp(key, propsOf(b), propsOf(d))) continue;
      (own(elements, id) as unknown as Record<string, unknown>)[key] = propsOf(d)[key];
    }
  }
  const style = { ...source.style };
  const baseStyle = base?.style ?? DEFAULT_STYLE;
  for (const key of STYLE_KEYS) if (source.style[key] === baseStyle[key]) Object.assign(style, { [key]: current.style[key] });
  const target: DiagramModel = { ...source, elements, style, diagnostics: [] };
  const notes: MergeNote[] = [];
  return { ops: repaired(current, diffModels(current, target), notes), notes };
}

function mergeDiagram(current: DiagramModel, source: DiagramModel, base: DiagramModel | undefined): MergeResult {
  const notes: MergeNote[] = [];
  const baseEl = (id: ID) => (base ? own(base.elements, id) : undefined);
  const baseEdges = new Set((base?.edges ?? []).map(edgeKey));
  const sourceEdges = new Set(source.edges.map(edgeKey));
  const currentEdges = new Set(current.edges.map(edgeKey));

  // Connections the source dropped (and nobody else created): they reference the ids of `current`, so they run first.
  const dropEdges: DiagramOp[] = current.edges
    .filter((edge) => baseEdges.has(edgeKey(edge)) && !sourceEdges.has(edgeKey(edge)))
    .map((edge): DiagramOp => ({ op: 'remove_edge', edgeId: edge.id }));

  // Elements the source dropped: removed only when they still look like what the sync created.
  const doomed = new Set<ID>();
  for (const id of base?.order ?? []) {
    if (own(source.elements, id)) continue;
    const b = baseEl(id);
    const d = own(current.elements, id);
    if (!b || !d) continue;
    const untouched = d.kind === b.kind && d.parentId === b.parentId && UPDATABLE_PROP_KEYS.every((key) => sameProp(key, propsOf(d), propsOf(b)));
    if (untouched) doomed.add(id);
    else notes.push({ kind: 'kept-edited', id, message: `"${id}" saiu da fonte, mas foi editado à mão: mantido (agora é só seu).` });
  }
  const children = childrenByParent(current);
  const rescue: DiagramOp[] = [];
  for (const id of doomed) {
    let target = own(current.elements, id)?.parentId;
    for (let hops = 0; target && doomed.has(target) && hops < 64; hops += 1) target = own(current.elements, target)?.parentId;
    for (const child of children.get(id) ?? []) if (!doomed.has(child)) rescue.push({ op: 'move_to_group', id: child, parentId: target ?? null });
  }
  // `remove` takes the whole subtree: only the topmost doomed elements need one (what people put inside was rescued above).
  const insideDoomed = (id: ID): boolean => {
    const seen = new Set<ID>();
    for (let parent = own(current.elements, id)?.parentId; parent && !seen.has(parent); parent = own(current.elements, parent)?.parentId) {
      if (doomed.has(parent)) return true;
      seen.add(parent);
    }
    return false;
  };
  const removals = [...doomed].filter((id) => !insideDoomed(id)).map((id): DiagramOp => ({ op: 'remove', id }));

  // Elements only the source has.
  const exists = (id: ID) => (own(current.elements, id) !== undefined && !doomed.has(id)) || added.has(id);
  const added = new Set<ID>();
  const additions: DiagramOp[] = [];
  const missing = source.order.filter((id) => own(source.elements, id) && !own(current.elements, id));
  for (const id of orderedByDepth(source, missing)) {
    if (baseEl(id)) {
      notes.push({ kind: 'kept-deleted', id, message: `"${id}" continua na fonte, mas foi removido à mão: não foi recriado.` });
      continue;
    }
    const el = own(source.elements, id)!;
    const parent = el.parentId && exists(el.parentId) ? el.parentId : undefined;
    additions.push(...addOps(el, parent));
    added.add(id);
  }

  // Elements both sides have: properties and parent, three-way.
  const moves: DiagramOp[] = [];
  const updates: DiagramOp[] = [];
  for (const id of source.order) {
    const s = own(source.elements, id);
    const d = own(current.elements, id);
    if (!s || !d) continue;
    if (s.kind !== d.kind) {
      notes.push({ kind: 'kind-conflict', id, message: `"${id}" é ${s.kind === 'group' ? 'um grupo' : 'um nó'} na fonte e ${d.kind === 'group' ? 'um grupo' : 'um nó'} no diagrama: mantido como está.` });
      continue;
    }
    const b = baseEl(id);
    const set: Record<string, unknown> = {};
    const conflicts: string[] = [];
    for (const key of UPDATABLE_PROP_KEYS) {
      if (sameProp(key, propsOf(s), propsOf(d))) continue;
      if (!b) {
        // First time the sync sees this element: it only fills what people left empty.
        if (propsOf(d)[key] === undefined) set[key] = propsOf(s)[key];
      } else if (sameProp(key, propsOf(s), propsOf(b))) continue;
      else if (sameProp(key, propsOf(d), propsOf(b))) set[key] = propsOf(s)[key] ?? null;
      else conflicts.push(key);
    }
    if (Object.keys(set).length) updates.push({ op: 'update', id, set: set as PropPatch });
    if (conflicts.length) notes.push({ kind: 'conflict', id, message: `"${id}": a fonte e uma edição manual mudaram ${conflicts.join(', ')}; vale a edição manual.` });
    if (b && s.parentId !== b.parentId && d.parentId === b.parentId) {
      if (s.parentId && !exists(s.parentId)) notes.push({ kind: 'skipped', id, message: `"${id}" mudou de grupo na fonte, mas o grupo "${s.parentId}" não existe aqui: mantido onde está.` });
      else if (s.parentId && isAncestor(current, id, s.parentId)) notes.push({ kind: 'skipped', id, message: `"${id}" mudou de grupo na fonte, mas isso criaria um ciclo com a organização atual: mantido onde está.` });
      else moves.push({ op: 'move_to_group', id, parentId: s.parentId ?? null });
    }
  }

  const styleBase = base?.style ?? DEFAULT_STYLE;
  const style: Partial<DiagramStyle> = {};
  for (const key of STYLE_KEYS) if (source.style[key] !== styleBase[key] && current.style[key] === styleBase[key] && current.style[key] !== source.style[key]) Object.assign(style, { [key]: source.style[key] });

  // Connections only the source has (people's deletions stay deleted).
  const connects: DiagramOp[] = [];
  for (const edge of source.edges) {
    const key = edgeKey(edge);
    if (currentEdges.has(key) || (base && baseEdges.has(key))) continue;
    if (exists(edge.from) && exists(edge.to)) connects.push(connectOp(edge));
  }

  const ops = [...dropEdges, ...rescue, ...removals, ...additions, ...moves, ...updates, ...(Object.keys(style).length ? [{ op: 'set_style', set: style } as DiagramOp] : []), ...connects];
  return { ops: repaired(current, ops, notes), notes };
}
