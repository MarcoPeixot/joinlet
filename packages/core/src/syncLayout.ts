import { own } from './ids';
import type { DiagramModel, DiagramOp, ID, LayoutState, NodeBox } from './model';

/**
 * Router cache that outlives an edit: each edge keeps its route (under its new id when the batch renumbered it,
 * `edgeIds` from `applyOps`; by id when absent, as for undo/redo), even when its type, color, label or ports
 * changed: the router redraws it a moment later and the line glides there, instead of dropping to a plain line
 * first. Whether the route still fits its endpoints is checked where it is drawn: `cachedRoute` compares its key
 * with the current rects, so only the edges that actually moved fall back to plain lines.
 */
export function carryRoutes(
  routes: LayoutState['edges'],
  before: DiagramModel,
  after: DiagramModel,
  edgeIds?: Readonly<Record<ID, ID>>,
): LayoutState['edges'] {
  const previous = new Map(before.edges.map((edge) => [edge.id, edge]));
  const origin = edgeIds ? new Map(Object.entries(edgeIds).map(([old, now]) => [now, old])) : null;
  const kept: LayoutState['edges'] = {};
  for (const edge of after.edges) {
    const old = origin ? origin.get(edge.id) : edge.id;
    const route = old === undefined ? undefined : own(routes, old);
    if (route && old !== undefined && previous.has(old)) kept[edge.id] = route;
  }
  return kept;
}

/** Layout after a successful batch: follows renames, drops removed ids, merges new positions. */
export function syncLayout(
  prev: LayoutState,
  model: DiagramModel,
  ops: readonly DiagramOp[],
  positions: Readonly<Record<ID, NodeBox>> = {},
): LayoutState {
  const nodes: Record<ID, NodeBox> = { ...prev.nodes };
  for (const op of ops) {
    if (op.op !== 'rename' || op.id === op.to) continue;
    const box = own(nodes, op.id);
    if (!box) continue;
    nodes[op.to] = box;
    delete nodes[op.id];
  }
  for (const id of Object.keys(nodes)) if (!own(model.elements, id)) delete nodes[id];
  for (const [id, box] of Object.entries(positions)) if (own(model.elements, id)) nodes[id] = { ...own(nodes, id), ...box };
  return { nodes, edges: {} };
}
