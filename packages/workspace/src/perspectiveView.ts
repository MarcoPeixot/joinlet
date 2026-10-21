import { childrenByParent, computeRects, depthsOf, descendantsOf, own } from '@strukt/core';
import type { DiagramElement, DiagramModel, EdgeEl, ID, LayoutState } from '@strukt/core';
import { LEVEL_KEY } from './levels';
import type { Perspective } from './perspectives';
import type { SharedModel } from './shared';

/** Where an element's tags come from: the shared entity it is linked to, if any. */
export function sharedTagsOf(shared: SharedModel | undefined, slug: string): (id: ID) => readonly string[] | undefined {
  const view = shared ? own(shared.views, slug) : undefined;
  return (id) => {
    const entityId = view && own(view, id);
    return entityId && shared ? own(shared.entities, entityId)?.tags : undefined;
  };
}

/** What a perspective makes of one diagram, as sets of element ids (nodes and groups). */
export interface PerspectiveView {
  perspective: Perspective;
  /** Drawn: lit and dimmed elements. */
  shown: Set<ID>;
  /** Not drawn at all. */
  hidden: Set<ID>;
  /** Drawn faded (`mode: 'dim'`, what the filters do not match). */
  dimmed: Set<ID>;
  /** Groups drawn as one compact box because none of their members is shown. */
  boxes: Set<ID>;
  /** Hidden by name (or inside a group hidden by name): a connection to one is never moved to a group. */
  gone: Set<ID>;
  /** Nodes only (groups are frames, not components). */
  counts: { shown: number; total: number };
}

const split = (tag: string): [string, string] | null => {
  const at = tag.indexOf(':');
  return at < 1 ? null : [tag.slice(0, at).toLowerCase(), tag.slice(at + 1).toLowerCase()];
};

/** Tags and levels as facets: values of one key are alternatives, every key has to be satisfied. */
function facetsOf(perspective: Perspective): Map<string, Set<string>> {
  const facets = new Map<string, Set<string>>();
  const add = (key: string, value: string) => facets.set(key, (facets.get(key) ?? new Set()).add(value));
  for (const tag of perspective.tags ?? []) {
    const parts = split(tag);
    if (parts) add(parts[0], parts[1]);
  }
  for (const level of perspective.levels ?? []) add(LEVEL_KEY, level);
  return facets;
}

export function resolvePerspective(model: DiagramModel, tagsOf: (id: ID) => readonly string[] | undefined, perspective: Perspective): PerspectiveView {
  const facets = facetsOf(perspective);
  const filtering = facets.size > 0;
  const dim = perspective.mode === 'dim';
  const matches = (id: ID): boolean => {
    if (!filtering) return true;
    const parts = (tagsOf(id) ?? []).map(split);
    return [...facets].every(([key, values]) => parts.some((part) => part?.[0] === key && values.has(part[1])));
  };
  const named = (ids: readonly ID[] | undefined) => new Set(ids ?? []);
  const include = named(perspective.include);
  const collapsedGroups = named(perspective.collapsed);

  const gone = new Set<ID>();
  for (const id of named(perspective.hide)) {
    const el = own(model.elements, id);
    if (!el) continue;
    gone.add(id);
    if (el.kind === 'group') for (const inner of descendantsOf(model, id)) gone.add(inner);
  }
  const blocked = new Set(gone);
  for (const id of collapsedGroups) if (own(model.elements, id)?.kind === 'group') for (const inner of descendantsOf(model, id)) blocked.add(inner);

  const hidden = new Set<ID>();
  const dimmed = new Set<ID>();
  const lit = new Set<ID>();
  const outOfScope = (id: ID) => (dim ? dimmed.add(id) : hidden.add(id));
  for (const id of model.order) {
    const el = own(model.elements, id);
    if (!el || el.kind !== 'node') continue;
    if (blocked.has(id)) hidden.add(id);
    else if (include.has(id) || matches(id)) lit.add(id);
    else outOfScope(id);
  }
  const children = childrenByParent(model);
  const depths = depthsOf(model);
  const groups = model.order.filter((id) => own(model.elements, id)?.kind === 'group').sort((a, b) => (depths.get(b) ?? 0) - (depths.get(a) ?? 0));
  for (const id of groups) {
    if (blocked.has(id)) hidden.add(id);
    else if (!filtering || include.has(id) || collapsedGroups.has(id) || matches(id) || (children.get(id) ?? []).some((child) => lit.has(child))) lit.add(id);
    else outOfScope(id);
  }

  const shown = new Set(model.order.filter((id) => own(model.elements, id) && !hidden.has(id)));
  const boxes = new Set(groups.filter((id) => shown.has(id) && (children.get(id) ?? []).length > 0 && !(children.get(id) ?? []).some((child) => shown.has(child))));
  let total = 0;
  let visible = 0;
  for (const id of model.order) {
    if (own(model.elements, id)?.kind !== 'node') continue;
    total += 1;
    if (shown.has(id)) visible += 1;
  }
  return { perspective, shown, hidden, dimmed, boxes, gone, counts: { shown: visible, total } };
}

const BOX = { w: 220, h: 96 };
const DEPTH_CAP = 64;

/**
 * The diagram as the perspective reads it: the same elements (by identity), without what is hidden; connections to
 * hidden things dropped, or, with `collapse`, moved to the nearest shown group and merged (one line per pair, labelled
 * "N conexões" when it stands for several). A group with no member shown becomes a compact box where the group was.
 * Pure, and the input is never touched: feed the result to anything that draws a diagram (canvas, SVG, site).
 */
export function projectPerspective(model: DiagramModel, layout: LayoutState, view: PerspectiveView): { model: DiagramModel; layout: LayoutState } {
  const lifting = view.perspective.collapse === true;
  const repOf = (id: ID): ID | null => {
    if (view.shown.has(id)) return id;
    if (!lifting || view.gone.has(id)) return null;
    let cur = own(model.elements, id)?.parentId;
    for (let hops = 0; cur && hops < DEPTH_CAP; hops += 1) {
      if (view.shown.has(cur)) return cur;
      if (view.gone.has(cur)) return null;
      cur = own(model.elements, cur)?.parentId;
    }
    return null;
  };
  const shownParent = (el: DiagramElement): ID | undefined => {
    let cur = el.parentId;
    for (let hops = 0; cur && hops < DEPTH_CAP; hops += 1) {
      if (view.shown.has(cur)) return cur;
      cur = own(model.elements, cur)?.parentId;
    }
    return undefined;
  };

  const order = model.order.filter((id) => view.shown.has(id));
  const elements: Record<ID, DiagramElement> = {};
  for (const id of order) {
    const el = own(model.elements, id)!;
    const parent = shownParent(el);
    if (parent === el.parentId) {
      elements[id] = el;
      continue;
    }
    const { parentId: _lost, ...rest } = el;
    elements[id] = (parent ? { ...rest, parentId: parent } : rest) as DiagramElement;
  }

  const direct = new Set<string>();
  const kept: (EdgeEl | { lifted: string })[] = [];
  const lifted = new Map<string, { first: EdgeEl; from: ID; to: ID; count: number }>();
  const pair = (from: ID, to: ID, connector: string) => JSON.stringify([from, to, connector]);
  for (const edge of model.edges) {
    const from = repOf(edge.from);
    const to = repOf(edge.to);
    if (!from || !to) continue;
    if (from === edge.from && to === edge.to) {
      direct.add(pair(from, to, edge.connector));
      kept.push(edge);
    } else if (from !== to) {
      const key = pair(from, to, edge.connector);
      const known = lifted.get(key);
      if (known) known.count += 1;
      else {
        lifted.set(key, { first: edge, from, to, count: 1 });
        kept.push({ lifted: key });
      }
    }
  }
  const edges: EdgeEl[] = kept.flatMap((item): EdgeEl[] => {
    if (!('lifted' in item)) return [item];
    if (direct.has(item.lifted)) return [];
    const { first, from, to, count } = lifted.get(item.lifted)!;
    const label = count > 1 ? `${count} conexões` : first.label;
    return [{ id: first.id, from, to, connector: first.connector, ...(label ? { label } : {}) }];
  });

  const projected: DiagramModel = { ...model, elements, order, edges };
  const boxes = [...view.boxes];
  if (!boxes.length) return { model: projected, layout };
  const rects = computeRects(model, layout);
  const nodes = { ...layout.nodes };
  for (const id of boxes) {
    const rect = rects[id];
    if (!rect) continue;
    const w = Math.min(rect.w, BOX.w);
    const h = Math.min(rect.h, BOX.h);
    nodes[id] = { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
  }
  return { model: projected, layout: { ...layout, nodes } };
}
