import { RESERVED_NAME, edgeId, own } from './ids';
import { CARDINALITIES, validTableFields, LAYOUT_ROLES, PRESENTATIONS, PORTS, COLOR_MODES, CONNECTORS, DIRECTIONS, SHAPES, STYLE_MODES, TYPEFACES } from './model';
import type { DiagramElement, DiagramModel, DiagramOp, EdgeEl, GroupEl, ID, NodeEl } from './model';
import { reuseUnchanged } from './share';
import { suggest } from './suggest';
import { descendantsOf, isAncestor } from './tree';

export type ApplyResult =
  | {
      ok: true;
      model: DiagramModel;
      /** Pre-batch edge id → its id after the batch, for every edge that survived it. */
      edgeIds: Record<ID, ID>;
    }
  | { ok: false; error: { opIndex: number; message: string } };

class OpError extends Error {}

function fail(message: string): never {
  throw new OpError(message);
}

const UPDATABLE = new Set([
  'canvasFrame',
  'presentation', 'layoutRole', 'fields', 'label', 'icon', 'color', 'link', 'tech', 'description', 'colorMode', 'styleMode', 'typeface', 'shape',
]);
const ENUM_FIELDS: Record<string, readonly string[]> = {
  presentation: PRESENTATIONS, layoutRole: LAYOUT_ROLES,
  shape: SHAPES,
  colorMode: COLOR_MODES,
  styleMode: STYLE_MODES,
  typeface: TYPEFACES,
};

/** Applies a batch atomically: either every op succeeds or the input model is returned untouched. */
export function applyOps(model: DiagramModel, ops: readonly DiagramOp[]): ApplyResult {
  const draft = structuredClone(model);
  const origin = new Map(draft.edges.map((edge) => [edge, edge.id]));
  // Edge ids taken so far, kept across consecutive `connect`s (rebuilding it per op is O(E²) on big batches).
  const batch: { taken?: Set<ID> } = {};
  for (const [index, op] of ops.entries()) {
    try {
      if (op.op !== 'connect') batch.taken = undefined;
      applyOne(draft, op, batch);
    } catch (err) {
      if (err instanceof OpError) return { ok: false, error: { opIndex: index, message: err.message } };
      throw err;
    }
  }
  const committed = reuseUnchanged(model, normalizeEdgeIds(draft));
  const edgeIds: Record<ID, ID> = {};
  draft.edges.forEach((edge, i) => {
    const before = origin.get(edge);
    if (before !== undefined) edgeIds[before] = committed.edges[i]!.id;
  });
  return { ok: true, model: committed, edgeIds };
}

/**
 * Canonical edge ids: `from→to`, numbered `#n` by position among edges with the same ends.
 * Applied when a batch commits (and on load) so ids never depend on edit history.
 */
export function normalizeEdgeIds(model: DiagramModel): DiagramModel {
  const taken = new Set<ID>();
  let changed = false;
  const edges = model.edges.map((edge) => {
    const id = edgeId(edge.from, edge.to, taken);
    taken.add(id);
    if (id === edge.id) return edge;
    changed = true;
    return { ...edge, id };
  });
  return changed ? { ...model, edges } : model;
}

function get(d: DiagramModel, id: ID): DiagramElement {
  const el = own(d.elements, id);
  if (el) return el;
  const [hint] = suggest(id, Object.keys(d.elements));
  return fail(hint ? `Elemento "${id}" não existe. Você quis dizer "${hint}"?` : `Elemento "${id}" não existe.`);
}

function assertNew(d: DiagramModel, id: ID): void {
  if (!id.trim()) fail('O nome não pode ser vazio.');
  if (/[\r\n]/.test(id)) fail(`O nome "${id}" não pode ter quebra de linha.`);
  if (id === RESERVED_NAME) fail(`O nome "${id}" é reservado.`);
  if (own(d.elements, id)) fail(`Já existe um elemento chamado "${id}".`);
}

function assertGroup(d: DiagramModel, id: ID): GroupEl {
  const el = get(d, id);
  if (el.kind !== 'group') fail(`"${id}" não é um grupo.`);
  return el;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    fail(`Valor inválido para ${field}: "${String(value)}".`);
  }
  return value as T;
}

/** Drops unset fields; `''` counts as unset, as in `update` (the model never stores empty props). */
function compact<T extends object>(obj: T): T {
  for (const key of Object.keys(obj) as (keyof T)[]) if (obj[key] === undefined || obj[key] === '') delete obj[key];
  return obj;
}

function assertDescription(value: unknown): void {
  if (value !== undefined && typeof value !== 'string') fail('A descrição precisa ser texto.');
}

function edgeIds(d: DiagramModel, except?: ID): Set<ID> {
  const ids = new Set(d.edges.map((e) => e.id));
  if (except) ids.delete(except);
  return ids;
}

function applyOne(d: DiagramModel, op: DiagramOp, batch: { taken?: Set<ID> }): void {
  switch (op.op) {
    case 'add_node': {
      assertDescription(op.description);
      assertNew(d, op.id);
      if (op.parentId) assertGroup(d, op.parentId);
      if (op.presentation) oneOf(op.presentation, PRESENTATIONS, 'presentation');
      if (op.layoutRole) oneOf(op.layoutRole, LAYOUT_ROLES, 'layoutRole');
      if (op.shape) oneOf(op.shape, SHAPES, 'shape');
      if (op.fields !== undefined && !validTableFields(op.fields)) fail('Campos de tabela inválidos. Use name, type opcional e key PK/FK opcional.');
      d.elements[op.id] = compact<NodeEl>({
        kind: 'node', id: op.id, description: op.description, parentId: op.parentId, label: op.label,
        presentation: op.presentation, layoutRole: op.layoutRole, fields: op.fields ? structuredClone(op.fields) : undefined, shape: op.shape, icon: op.icon, color: op.color, tech: op.tech,
      });
      d.order.push(op.id);
      return;
    }
    case 'add_group': {
      if (op.canvasFrame !== undefined && typeof op.canvasFrame !== 'boolean') fail('canvasFrame precisa ser booleano.');
      assertDescription(op.description);
      assertNew(d, op.id);
      if (op.parentId) assertGroup(d, op.parentId);
      d.elements[op.id] = compact<GroupEl>({
        kind: 'group', id: op.id, canvasFrame: op.canvasFrame, description: op.description, parentId: op.parentId, label: op.label, icon: op.icon, color: op.color,
      });
      d.order.push(op.id);
      return;
    }
    case 'connect': {
      get(d, op.from);
      get(d, op.to);
      if (op.from === op.to) fail('Uma conexão precisa ligar dois elementos diferentes.');
      const connector = oneOf(op.connector ?? '>', CONNECTORS, 'connector');
      if (op.fromPort) oneOf(op.fromPort, PORTS, 'fromPort');
      if (op.toPort) oneOf(op.toPort, PORTS, 'toPort');
      if (op.fromCardinality) oneOf(op.fromCardinality, CARDINALITIES, 'fromCardinality');
      if (op.toCardinality) oneOf(op.toCardinality, CARDINALITIES, 'toCardinality');
      const taken = (batch.taken ??= edgeIds(d));
      const id = edgeId(op.from, op.to, taken);
      taken.add(id);
      d.edges.push(compact<EdgeEl>({
        id, from: op.from, to: op.to, connector, label: op.label, color: op.color, fromPort: op.fromPort, toPort: op.toPort,
        fromCardinality: op.fromCardinality, toCardinality: op.toCardinality,
      }));
      return;
    }
    case 'insert_between': {
      assertDescription(op.node.description);
      const index = d.edges.findIndex((e) => e.from === op.from && e.to === op.to);
      if (index < 0) fail(`Não há conexão de "${op.from}" para "${op.to}".`);
      const edge = d.edges[index];
      assertNew(d, op.node.id);
      const fromParent = d.elements[op.from]?.parentId;
      const toParent = d.elements[op.to]?.parentId;
      d.elements[op.node.id] = compact<NodeEl>({
        kind: 'node', id: op.node.id, parentId: fromParent === toParent ? fromParent : undefined,
        description: op.node.description, label: op.node.label, icon: op.node.icon, tech: op.node.tech,
      });
      d.order.push(op.node.id);
      const taken = edgeIds(d, edge.id);
      const first = compact<EdgeEl>({
        id: edgeId(op.from, op.node.id, taken), from: op.from, to: op.node.id,
        connector: edge.connector, label: edge.label, color: edge.color, fromPort: edge.fromPort, fromCardinality: edge.fromCardinality,
      });
      taken.add(first.id);
      const second = compact<EdgeEl>({
        id: edgeId(op.node.id, op.to, taken), from: op.node.id, to: op.to, connector: edge.connector, color: edge.color, toPort: edge.toPort, toCardinality: edge.toCardinality,
      });
      d.edges.splice(index, 1, first, second);
      return;
    }
    case 'update': {
      const el = get(d, op.id) as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(op.set)) {
        if (!UPDATABLE.has(key)) fail(`A propriedade "${key}" não pode ser alterada.`);
        if (key === 'canvasFrame' && el.kind !== 'group') fail('Apenas grupos podem ser áreas de diagrama.');
        if (key === 'shape' && el.kind === 'group') fail('Grupos não têm shape.');
        if (value === null || value === undefined || value === '') {
          delete el[key];
          continue;
        }
        const allowed = ENUM_FIELDS[key];
        if (key === 'fields') {
          if (el.kind !== 'node' || !validTableFields(value)) fail('Campos de tabela inválidos.');
        } else if (allowed) oneOf(value, allowed, key);
        else if (key === 'canvasFrame') { if (typeof value !== 'boolean') fail('canvasFrame precisa ser booleano.'); }
        else if (typeof value !== 'string') fail(`Valor inválido para ${key}.`);
        el[key] = key === 'fields' ? structuredClone(value) : value;
      }
      return;
    }
    case 'update_edge': {
      const edge = d.edges.find((e) => e.id === op.edgeId) ?? fail(`Conexão "${op.edgeId}" não existe.`);
      if (op.set.connector !== undefined) edge.connector = oneOf(op.set.connector, CONNECTORS, 'connector');
      for (const key of ['fromPort', 'toPort'] as const) if (key in op.set) {
        const value = op.set[key];
        if (value == null) delete edge[key]; else edge[key] = oneOf(value, PORTS, key);
      }
      for (const key of ['fromCardinality', 'toCardinality'] as const) if (key in op.set) {
        const value = op.set[key];
        if (value == null) delete edge[key]; else edge[key] = oneOf(value, CARDINALITIES, key);
      }
      for (const key of ['label', 'color'] as const) {
        if (!(key in op.set)) continue;
        const value = op.set[key];
        if (value === null || value === undefined || value === '') delete edge[key];
        else edge[key] = value;
      }
      return;
    }
    case 'rename': {
      const el = get(d, op.id);
      if (op.to === op.id) return;
      assertNew(d, op.to);
      delete d.elements[op.id];
      el.id = op.to;
      d.elements[op.to] = el;
      d.order = d.order.map((id) => (id === op.id ? op.to : id));
      for (const other of Object.values(d.elements)) if (other.parentId === op.id) other.parentId = op.to;
      // Only the renamed element's edges change id mid-batch; the rest keep theirs until commit.
      const touches = (e: EdgeEl) => e.from === op.id || e.to === op.id;
      const taken = new Set(d.edges.filter((e) => !touches(e)).map((e) => e.id));
      for (const edge of d.edges.filter(touches)) {
        if (edge.from === op.id) edge.from = op.to;
        if (edge.to === op.id) edge.to = op.to;
        edge.id = edgeId(edge.from, edge.to, taken);
        taken.add(edge.id);
      }
      return;
    }
    case 'move_to_group': {
      const el = get(d, op.id);
      if (op.parentId === null) {
        delete el.parentId;
        return;
      }
      assertGroup(d, op.parentId);
      if (op.parentId === op.id || isAncestor(d, op.id, op.parentId)) {
        fail(`Mover "${op.id}" para "${op.parentId}" criaria um ciclo.`);
      }
      el.parentId = op.parentId;
      return;
    }
    case 'remove': {
      get(d, op.id);
      const removed = new Set([op.id, ...descendantsOf(d, op.id)]);
      for (const id of removed) delete d.elements[id];
      d.order = d.order.filter((id) => !removed.has(id));
      d.edges = d.edges.filter((e) => !removed.has(e.from) && !removed.has(e.to));
      return;
    }
    case 'remove_edge': {
      const index = d.edges.findIndex((e) => e.id === op.edgeId);
      if (index < 0) fail(`Conexão "${op.edgeId}" não existe.`);
      d.edges.splice(index, 1);
      return;
    }
    case 'set_style': {
      const { direction, colorMode, styleMode, typeface } = op.set;
      if (direction !== undefined) d.style.direction = oneOf(direction, DIRECTIONS, 'direction');
      if (colorMode !== undefined) d.style.colorMode = oneOf(colorMode, COLOR_MODES, 'colorMode');
      if (styleMode !== undefined) d.style.styleMode = oneOf(styleMode, STYLE_MODES, 'styleMode');
      if (typeface !== undefined) d.style.typeface = oneOf(typeface, TYPEFACES, 'typeface');
      return;
    }
    case 'reorder': {
      if (op.order) {
        const ids = new Set(op.order);
        if (op.order.length !== d.order.length || ids.size !== op.order.length || d.order.some((id) => !ids.has(id))) {
          fail('A nova ordem precisa listar cada elemento exatamente uma vez.');
        }
        d.order = [...op.order];
      }
      if (op.edges) {
        const n = d.edges.length;
        const valid = op.edges.every((i) => Number.isInteger(i) && i >= 0 && i < n);
        if (op.edges.length !== n || new Set(op.edges).size !== n || !valid) {
          fail('A nova ordem das conexões precisa listar cada conexão exatamente uma vez.');
        }
        const edges = d.edges;
        d.edges = op.edges.map((i) => edges[i]!);
      }
      return;
    }
    default: {
      const unknown: never = op;
      fail(`Operação desconhecida: "${String((unknown as { op?: unknown }).op)}".`);
    }
  }
}
