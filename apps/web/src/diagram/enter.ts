import type { ID } from '@strukt/core';

/** Stagger between nodes added by one commit; at most `MAX_STAGGERED` are delayed, the rest appear together. */
export const STAGGER_MS = 40;
export const MAX_STAGGERED = 20;

export interface EnterMarks {
  /** Added nodes in order → their fade-in delay in ms (0 past the cap). Empty for a single added node. */
  nodes: Record<ID, number>;
  /** Edges created by the commit: they draw in once. */
  edges: ReadonlySet<ID>;
}

export interface Snapshot {
  nodes: readonly ID[];
  edges: readonly ID[];
}

/**
 * What entered between two commits of the same diagram. Null when there is nothing to animate or when it is not a
 * commit but a different document (no id in common while the previous one was not empty).
 */
export function enterMarks(prev: Snapshot, next: Snapshot): EnterMarks | null {
  const before = new Set(prev.nodes);
  const shared = next.nodes.some((id) => before.has(id));
  if (prev.nodes.length > 0 && !shared) return null;
  const addedNodes = next.nodes.filter((id) => !before.has(id));
  const beforeEdges = new Set(prev.edges);
  const edges = new Set(next.edges.filter((id) => !beforeEdges.has(id)));
  const nodes: Record<ID, number> = Object.create(null) as Record<ID, number>;
  if (addedNodes.length > 1) addedNodes.forEach((id, index) => { nodes[id] = index < MAX_STAGGERED ? index * STAGGER_MS : 0; });
  if (addedNodes.length === 0 && edges.size === 0) return null;
  return { nodes, edges };
}
