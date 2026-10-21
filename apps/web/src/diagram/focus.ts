import { descendantsOf, own } from '@strukt/core';
import type { DiagramModel, EdgeEl, ID } from '@strukt/core';

/** Opacity of what is out of focus (nodes; groups and edges derive from it in diagram.css via `--sk-dim`). */
export const DIM_OPACITY = 0.55;

/** How an edge relates to what is focused: requests leaving it or arriving at it. */
export type FocusDir = 'out' | 'in';
export type ReachDirection = 'upstream' | 'downstream';

/**
 * What the canvas keeps lit when something is focused (clicked node, a reach chain, a hovered passport row);
 * everything else dims. Pure: DiagramCanvas turns it into classes on the React Flow nodes and edges.
 */
export interface Focus {
  origin: ID;
  /** Elements drawn at full strength. */
  nodes: Set<ID>;
  /** Groups around those elements: dimmed less, so the context stays readable. */
  groups: Set<ID>;
  /** Edges that pulse, and which way they relate to the origin. */
  edges: Map<ID, FocusDir>;
  /** Edges at full strength that do not pulse (a focused group's inner wiring). */
  calm: Set<ID>;
}

export interface Connection {
  edge: EdgeEl;
  /** The element on the other end. */
  neighbor: ID;
  /** For a group: the member the edge touches (null when it is the origin itself). */
  via: ID | null;
}

/** The origin plus, for a group, everything inside it. */
function members(model: DiagramModel, origin: ID): Set<ID> {
  const el = own(model.elements, origin);
  return new Set(el?.kind === 'group' ? [origin, ...descendantsOf(model, origin)] : [origin]);
}

function groupsAround(model: DiagramModel, ids: Iterable<ID>): Set<ID> {
  const groups = new Set<ID>();
  for (const id of ids) {
    let parent = own(model.elements, id)?.parentId;
    while (parent && !groups.has(parent)) {
      groups.add(parent);
      parent = own(model.elements, parent)?.parentId;
    }
  }
  return groups;
}

function focusOf(model: DiagramModel, origin: ID, nodes: Set<ID>, edges: Map<ID, FocusDir>, calm = new Set<ID>()): Focus {
  return { origin, nodes, groups: groupsAround(model, nodes), edges, calm };
}

/** A click: the element, its direct neighbours, and the edges between them (a group: the ones crossing its border). */
export function neighborhood(model: DiagramModel, origin: ID): Focus {
  const inside = members(model, origin);
  const nodes = new Set(inside);
  const edges = new Map<ID, FocusDir>();
  const calm = new Set<ID>();
  for (const edge of model.edges) {
    const from = inside.has(edge.from);
    const to = inside.has(edge.to);
    if (from && to) {
      if (edge.from === edge.to || inside.size === 1) edges.set(edge.id, 'out');
      else calm.add(edge.id);
    } else if (from || to) {
      edges.set(edge.id, from ? 'out' : 'in');
      nodes.add(from ? edge.to : edge.from);
    }
  }
  return focusOf(model, origin, nodes, edges, calm);
}

/** Outgoing and incoming edges of the element (a group: those crossing its border), in diagram order. */
export function connections(model: DiagramModel, origin: ID): { outgoing: Connection[]; incoming: Connection[] } {
  const inside = members(model, origin);
  const outgoing: Connection[] = [];
  const incoming: Connection[] = [];
  const via = (id: ID) => (id === origin ? null : id);
  for (const edge of model.edges) {
    const from = inside.has(edge.from);
    const to = inside.has(edge.to);
    if (from && (!to || edge.from === edge.to)) outgoing.push({ edge, neighbor: edge.to, via: via(edge.from) });
    else if (to && !from) incoming.push({ edge, neighbor: edge.from, via: via(edge.to) });
  }
  return { outgoing, incoming };
}

/**
 * Every element reachable by following the drawn arrows forward (downstream) or backward (upstream): a
 * breadth-first walk that stops at cycles. `count` leaves the origin out; `edges` are all edges whose two
 * ends were reached. Only what the diagram says, no runtime claims.
 */
export function reach(model: DiagramModel, origin: ID, direction: ReachDirection) {
  const depth = new Map<ID, number>([[origin, 0]]);
  const queue: ID[] = [origin];
  let hops = 0;
  while (queue.length) {
    const id = queue.shift()!;
    const d = depth.get(id)!;
    for (const edge of model.edges) {
      const [here, there] = direction === 'downstream' ? [edge.from, edge.to] : [edge.to, edge.from];
      if (here !== id || depth.has(there)) continue;
      depth.set(there, d + 1);
      hops = Math.max(hops, d + 1);
      queue.push(there);
    }
  }
  const nodes = new Set(depth.keys());
  const edges = new Set(model.edges.filter((e) => nodes.has(e.from) && nodes.has(e.to)).map((e) => e.id));
  return { nodes, edges, count: nodes.size - 1, hops };
}

/** A reach chain as a focus: downstream edges read as outgoing, upstream as incoming. */
export function reachFocus(model: DiagramModel, origin: ID, direction: ReachDirection): Focus {
  const chain = reach(model, origin, direction);
  const dir: FocusDir = direction === 'downstream' ? 'out' : 'in';
  return focusOf(model, origin, chain.nodes, new Map([...chain.edges].map((id) => [id, dir])));
}

/** Hovering a passport row: only that edge pulses, only its two ends (and the origin's members) stay lit. */
export function withPreview(model: DiagramModel, focus: Focus, edgeId: ID): Focus {
  const dir = focus.edges.get(edgeId);
  const edge = model.edges.find((e) => e.id === edgeId);
  if (!dir || !edge) return focus;
  const nodes = new Set([...members(model, focus.origin), edge.from, edge.to]);
  return focusOf(model, focus.origin, nodes, new Map([[edgeId, dir]]));
}

/** The groups around an element, outermost first ("Serviços › Pedidos" without the element itself). */
export function breadcrumb(model: DiagramModel, id: ID): string[] {
  const path: string[] = [];
  let parent = own(model.elements, id)?.parentId;
  while (parent) {
    const group = own(model.elements, parent);
    if (!group) break;
    path.unshift(group.label ?? group.id);
    parent = group.parentId;
  }
  return path;
}
