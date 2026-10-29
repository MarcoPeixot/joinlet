import { computeRects, descendantsOf, isAncestor, own } from '@strukt/core';
import type { DiagramModel, ID, LayoutState, Rect } from '@strukt/core';

export interface DropPreview {
  /** The group the dragged element is in if dropped now; null for the top level. */
  target: ID | null;
  /**
   * Rects, after the drop, of the groups it changes: the target and the groups around it grow to hold the element,
   * the ones it leaves shrink without it (one left empty keeps its place and size, see `emptiedGroups`).
   */
  frames: Record<ID, Rect>;
}

/** A group lets go of an element only once it is this far from its border: no flicker right at the edge. */
export const DROP_RELEASE = 6;

/** The rects touch or overlap (`by` px of slack). */
const touches = (a: Rect, b: Rect, by = 0) => a.x <= b.x + b.w + by && b.x <= a.x + a.w + by && a.y <= b.y + b.h + by && b.y <= a.y + a.h + by;
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

function chain(model: DiagramModel, from: ID | undefined): ID[] {
  const ids: ID[] = [];
  for (let id = from; id; id = own(model.elements, id)?.parentId) ids.push(id);
  return ids;
}

/**
 * Groups a drop leaves with nothing inside (`moves`: element → the group it joins, null for the top level). An empty
 * group is drawn from its own layout box, which a group never given one lacks: the drop pins its current rect.
 */
export function emptiedGroups(model: DiagramModel, moves: ReadonlyMap<ID, ID | null>): ID[] {
  const left = new Map<ID, Set<ID>>();
  for (const [id, target] of moves) {
    const stays = new Set(chain(model, target ?? undefined));
    const carried = [id, ...descendantsOf(model, id)];
    for (const group of chain(model, own(model.elements, id)?.parentId)) {
      if (stays.has(group)) continue;
      const out = left.get(group) ?? new Set<ID>();
      for (const c of carried) out.add(c);
      left.set(group, out);
    }
  }
  return [...left].filter(([group, out]) => descendantsOf(model, group).every((id) => out.has(id))).map(([group]) => group);
}

/**
 * The group a drop would put `dragged` in (null: the top level): the innermost group its box touches, so a group
 * takes in an element as soon as the element reaches its border. Decided from the rects without any preview, so a
 * group that grew to hold the element lets go once the element no longer touches where the group was. `current`
 * (the answer for the previous pointer move) keeps it until the element is DROP_RELEASE px away.
 */
export function dropTarget(model: DiagramModel, rects: Readonly<Record<ID, Rect>>, dragged: ID, current: ID | null): ID | null {
  const rect = own(rects, dragged);
  if (!rect) return current;
  const carried = new Set([dragged, ...descendantsOf(model, dragged)]);
  const touched = model.order.filter((id) => {
    const group = own(rects, id);
    return own(model.elements, id)?.kind === 'group' && !carried.has(id) && !!group && touches(rect, group);
  });
  const held = current === null ? undefined : own(rects, current);
  // Still within reach of the group it is in: it stays, unless it reaches a group inside that one.
  const pool = held && !carried.has(current!) && touches(rect, held, DROP_RELEASE) ? touched.filter((id) => isAncestor(model, current!, id)) : touched;
  if (!pool.length) return held && pool !== touched ? current : null;
  // The innermost group; among unrelated ones at the same depth, the one it overlaps most.
  const depth = (id: ID) => chain(model, id).length;
  return pool.reduce((best, id) => (depth(id) > depth(best) || (depth(id) === depth(best) && overlap(rect, rects[id]!) > overlap(rect, rects[best]!)) ? id : best));
}

/**
 * Every rect once `dragged` sits in `target` (null: the top level): the groups it leaves or joins sized for that,
 * a group it leaves empty kept where it was, every other group as `pinned` holds it.
 */
function rectsWith(model: DiagramModel, layout: LayoutState, pinned: Readonly<Record<ID, Rect>>, dragged: ID, target: ID | null, now: Readonly<Record<ID, Rect>>): Record<ID, Rect> {
  const el = model.elements[dragged]!;
  const changed = new Set([...chain(model, target ?? undefined), ...chain(model, el.parentId)]);
  const moved = { ...el };
  if (target) moved.parentId = target;
  else delete moved.parentId;
  const kept = Object.fromEntries(emptiedGroups(model, new Map([[dragged, target]])).flatMap((id) => {
    const rect = own(pinned, id) ?? own(now, id);
    return rect ? [[id, rect]] : [];
  }));
  const free = Object.fromEntries(Object.entries(pinned).filter(([id]) => !changed.has(id)));
  return computeRects({ ...model, elements: { ...model.elements, [dragged]: moved } }, layout, { ...free, ...kept });
}

/**
 * While one element is dragged: where the drop puts it (`dropTarget`, from `current`, the previous answer) and every
 * group the drop changes drawn at the size it will have. `frames` is empty when the element stays where it is.
 * While the element is still in its own group, that group is judged at the size it had when the drag started (the
 * element is what holds one of its borders); once it has left, at the size it shrank to, so coming back means
 * reaching the border on screen.
 */
export function dropPreview(model: DiagramModel, layout: LayoutState, pinned: Readonly<Record<ID, Rect>>, dragged: ID, current?: ID | null): DropPreview | null {
  const el = own(model.elements, dragged);
  if (!el) return null;
  const parent = el.parentId ?? null;
  const previous = current === undefined ? parent : current;
  const atStart = computeRects(model, layout, pinned);
  const left = parent !== null && previous !== parent && !(previous !== null && isAncestor(model, parent, previous));
  const judged = left ? rectsWith(model, layout, pinned, dragged, null, atStart) : atStart;
  const target = dropTarget(model, judged, dragged, previous);
  if (target === parent) return { target, frames: {} };
  const after = rectsWith(model, layout, pinned, dragged, target, atStart);
  const frames: Record<ID, Rect> = {};
  for (const id of new Set([...chain(model, target ?? undefined), ...chain(model, el.parentId)])) {
    const rect = own(after, id);
    if (rect) frames[id] = rect;
  }
  return { target, frames };
}
