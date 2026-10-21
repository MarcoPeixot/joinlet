import { own } from './ids';
import type { DiagramElement, DiagramModel, ID } from './model';

export function isAncestor(model: DiagramModel, ancestor: ID, id: ID): boolean {
  const seen = new Set<ID>();
  let cur = own(model.elements, id)?.parentId;
  while (cur && !seen.has(cur)) {
    if (cur === ancestor) return true;
    seen.add(cur);
    cur = own(model.elements, cur)?.parentId;
  }
  return false;
}

/**
 * `parentId -> children` in `model.order` (top level under `undefined`), built in one pass.
 * A Map, not an object: `constructor`, `toString` etc. are valid ids.
 */
export function childrenByParent(model: DiagramModel): Map<ID | undefined, ID[]> {
  const map = new Map<ID | undefined, ID[]>();
  for (const id of model.order) {
    const el = own(model.elements, id);
    if (!el) continue;
    const list = map.get(el.parentId);
    if (list) list.push(id);
    else map.set(el.parentId, [id]);
  }
  return map;
}

/**
 * The parent each element can really have, for models that did not come out of `applyOps` (a collaborative doc
 * merged from concurrent edits, a hostile peer): a `parentId` that is empty, missing or not a group is dropped, and
 * every parent cycle loses the link of its member with the greatest id (code-unit order), so G1→G2 plus G2→G1 keeps
 * G1 inside G2. The result is a forest that depends only on the elements, never on the order they are visited in.
 * `undefined` = top level; every own element key gets an entry.
 */
export function validParents(model: DiagramModel): Map<ID, ID | undefined> {
  const parents = new Map<ID, ID | undefined>();
  for (const id of Object.keys(model.elements)) {
    const parentId = own(model.elements, id)?.parentId;
    const valid = typeof parentId === 'string' && own(model.elements, parentId)?.kind === 'group';
    parents.set(id, valid ? parentId : undefined);
  }
  // Each element has at most one parent, so a walk up the parents that meets an element of the same walk has found a
  // whole cycle; meeting an element of an earlier walk means that part was already settled.
  const walkOf = new Map<ID, number>();
  let walk = 0;
  for (const start of parents.keys()) {
    walk++;
    let cur: ID | undefined = start;
    while (cur !== undefined && !walkOf.has(cur)) {
      walkOf.set(cur, walk);
      cur = parents.get(cur);
    }
    if (cur === undefined || walkOf.get(cur) !== walk) continue;
    let greatest = cur;
    for (let link = parents.get(cur)!; link !== cur; link = parents.get(link)!) if (link > greatest) greatest = link;
    parents.set(greatest, undefined);
  }
  return parents;
}

/** Descendants of `id`, in `model.order`. */
export function descendantsOf(model: DiagramModel, id: ID): ID[] {
  const children = childrenByParent(model);
  const found = new Set<ID>();
  const stack = [...(children.get(id) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (found.has(cur)) continue;
    found.add(cur);
    for (const child of children.get(cur) ?? []) stack.push(child);
  }
  return found.size ? model.order.filter((other) => found.has(other)) : [];
}

const DEPTH_CAP = 64;

/**
 * `depthOf` for every element, computed once: a memoized walk up the parents that returns exactly what `depthOf`
 * returns, also for untrusted files (a parent cycle counts as the cap, a missing parent as one level, a chain
 * past the cap as the cap). Only elements get an entry.
 */
export function depthsOf(model: DiagramModel): Map<ID, number> {
  const depths = new Map<ID, number>();
  for (const id of model.order) {
    if (depths.has(id)) continue;
    const chain: ID[] = [];
    const onChain = new Set<ID>();
    let cur: ID | undefined = id;
    while (cur && !depths.has(cur) && !onChain.has(cur) && chain.length < DEPTH_CAP) {
      const el: DiagramElement | undefined = own(model.elements, cur);
      if (!el) break;
      chain.push(cur);
      onChain.add(cur);
      cur = el.parentId;
    }
    if (!chain.length) {
      depths.set(id, 0);
      continue;
    }
    const last = chain[chain.length - 1]!;
    const parent = own(model.elements, last)?.parentId;
    let lastDepth: number;
    if (!parent) lastDepth = 0;
    else if (depths.has(parent)) lastDepth = Math.min(DEPTH_CAP, depths.get(parent)! + 1);
    else if (onChain.has(parent)) {
      // A cycle never ends: every element on or below it is at the cap.
      for (const link of chain) depths.set(link, DEPTH_CAP);
      continue;
    }
    else if (!own(model.elements, parent)) lastDepth = 1; // the parent does not exist: still one level
    else {
      // The walk stopped at the cap with more chain above it: settle these one by one, exactly as `depthOf` does.
      for (const link of chain) depths.set(link, depthOf(model, link));
      continue;
    }
    for (let i = chain.length - 1; i >= 0; i--) depths.set(chain[i]!, Math.min(DEPTH_CAP, lastDepth + (chain.length - 1 - i)));
  }
  return depths;
}

export function depthOf(model: DiagramModel, id: ID): number {
  let depth = 0;
  let cur = own(model.elements, id)?.parentId;
  while (cur && depth < DEPTH_CAP) {
    depth++;
    cur = own(model.elements, cur)?.parentId;
  }
  return depth;
}

/** Drops ids whose ancestor is also in the list (moving/removing the ancestor covers them). */
export function topLevel(model: DiagramModel, ids: readonly ID[]): ID[] {
  return ids.filter((id) => own(model.elements, id) && !ids.some((other) => other !== id && isAncestor(model, other, id)));
}

export function sharedParent(model: DiagramModel, ids: readonly ID[]): ID | undefined {
  const parents = new Set(ids.map((id) => own(model.elements, id)?.parentId));
  return parents.size === 1 ? [...parents][0] : undefined;
}
