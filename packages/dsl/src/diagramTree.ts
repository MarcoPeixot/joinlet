import { own } from '@strukt/core';
import type { DiagramElement, DiagramModel, EdgeEl } from '@strukt/core';

export interface TreeEntry { alias: string; element: DiagramElement; children: TreeEntry[] }

/** Elements in `order` as a forest (nesting by `parentId`), with synthetic `n<index>` aliases. */
export function buildTree(model: DiagramModel): { roots: TreeEntry[]; aliases: Map<string, string> } {
  const aliases = new Map<string, string>();
  const entries = new Map<string, TreeEntry>();
  for (const id of model.order) {
    const element = own(model.elements, id);
    if (!element || aliases.has(id)) continue;
    const entry = { alias: `n${aliases.size}`, element, children: [] };
    aliases.set(id, entry.alias);
    entries.set(id, entry);
  }
  const roots: TreeEntry[] = [];
  const parents = new Map<TreeEntry, TreeEntry>();
  for (const entry of entries.values()) {
    const parent = entry.element.parentId !== undefined ? entries.get(entry.element.parentId) : undefined;
    if (parent && parent.element.kind === 'group' && parent !== entry) {
      parent.children.push(entry);
      parents.set(entry, parent);
    } else roots.push(entry);
  }
  // A `parentId` cycle (untrusted files) has no root above it: break it at its first member so nothing is dropped.
  const reached = new Set<TreeEntry>();
  const reach = (entry: TreeEntry) => {
    const stack = [entry];
    while (stack.length) {
      const cur = stack.pop()!;
      if (reached.has(cur)) continue;
      reached.add(cur);
      stack.push(...cur.children);
    }
  };
  roots.forEach(reach);
  for (const entry of entries.values()) {
    if (reached.has(entry)) continue;
    const parent = parents.get(entry);
    if (parent) parent.children.splice(parent.children.indexOf(entry), 1);
    roots.push(entry);
    reach(entry);
  }
  return { roots, aliases };
}

/** Edges whose two endpoints exist, with their aliases. */
export function resolvedEdges(model: DiagramModel, aliases: Map<string, string>): { edge: EdgeEl; from: string; to: string }[] {
  const result: { edge: EdgeEl; from: string; to: string }[] = [];
  for (const edge of model.edges) {
    const from = aliases.get(edge.from);
    const to = aliases.get(edge.to);
    if (from !== undefined && to !== undefined) result.push({ edge, from, to });
  }
  return result;
}

/** The text shown for an element: its label, or the id when it has none. */
export const displayLabel = (element: DiagramElement): string => (element.label ? element.label : element.id);
