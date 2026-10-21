import { EMPTY_GROUP_SIZE, GROUP_PADDING, contains, defaultSize, depthOf, findFreeSpot, isAncestor, nextPosition, own, unionRect, visualBox } from '@strukt/core';
import type { DiagramModel, DiagramOp, Direction, ID, LayoutState, NodeBox, Rect } from '@strukt/core';

const OPPOSITE: Record<Direction, Direction> = { right: 'left', left: 'right', down: 'up', up: 'down' };
const GAP = 80;

/** Rects of elements that already have a position; ids in `skip` count as unplaced. Groups wrap placed children. */
export function positionedRects(model: DiagramModel, layout: LayoutState, skip: ReadonlySet<ID> = new Set()): Record<ID, Rect> {
  const rects: Record<ID, Rect> = {};
  for (const id of model.order) {
    const el = model.elements[id];
    const box = own(layout.nodes, id);
    if (el?.kind !== 'node' || !box || skip.has(id)) continue;
    const size = defaultSize(el);
    rects[id] = { x: box.x, y: box.y, w: box.w ?? size.w, h: box.h ?? size.h };
  }
  const groups = model.order
    .filter((id) => model.elements[id]?.kind === 'group')
    .sort((a, b) => depthOf(model, b) - depthOf(model, a));
  for (const id of groups) {
    const children = model.order.filter((child) => model.elements[child]?.parentId === id && own(rects, child));
    const bounds = unionRect(children.map((child) => visualBox(model.elements[child]!, rects[child]!)));
    const box = own(layout.nodes, id);
    if (bounds) {
      rects[id] = {
        x: bounds.x - GROUP_PADDING.left,
        y: bounds.y - GROUP_PADDING.top,
        w: bounds.w + GROUP_PADDING.left + GROUP_PADDING.right,
        h: bounds.h + GROUP_PADDING.top + GROUP_PADDING.bottom,
      };
    } else if (box && !skip.has(id)) {
      rects[id] = { x: box.x, y: box.y, w: box.w ?? EMPTY_GROUP_SIZE.w, h: box.h ?? EMPTY_GROUP_SIZE.h };
    }
  }
  return rects;
}

const round = (p: { x: number; y: number }) => ({ x: Math.round(p.x), y: Math.round(p.y) });

/**
 * Where a new element goes without moving anything else (spec §7): next to a connected neighbor in
 * the diagram direction, else after its positioned siblings, else inside its (empty) parent, else to
 * the right of everything. `findFreeSpot` slides it off anything it would overlap.
 */
export function placeNear(model: DiagramModel, rects: Readonly<Record<ID, Rect>>, id: ID, direction: Direction): { x: number; y: number } {
  const el = own(model.elements, id);
  if (!el) return { x: 0, y: 0 };
  const size = defaultSize(el);
  const occupied = Object.entries(rects)
    .filter(([other]) => other !== id && !isAncestor(model, other, id))
    .map(([other, r]) => (model.elements[other] ? visualBox(model.elements[other], r) : r));
  const beside = (anchor: Rect, dir: Direction) => round(findFreeSpot(nextPosition(anchor, dir, size, GAP), size, dir, occupied));

  const neighbors = model.edges.flatMap((edge) => {
    if (edge.to === id && edge.from !== id && own(rects, edge.from)) return [{ other: edge.from, dir: direction }];
    if (edge.from === id && edge.to !== id && own(rects, edge.to)) return [{ other: edge.to, dir: OPPOSITE[direction] }];
    return [];
  });
  const sameParent = neighbors.find((n) => model.elements[n.other]?.parentId === el.parentId);
  if (sameParent) return beside(rects[sameParent.other]!, sameParent.dir);

  if (el.parentId) {
    const siblings = model.order.filter((other) => other !== id && model.elements[other]?.parentId === el.parentId && own(rects, other));
    const last = siblings[siblings.length - 1];
    if (last) return beside(rects[last]!, direction);
  }
  if (neighbors[0]) return beside(rects[neighbors[0].other]!, neighbors[0].dir);
  const parent = el.parentId ? own(rects, el.parentId) : undefined;
  if (parent) return round({ x: parent.x + GROUP_PADDING.left, y: parent.y + GROUP_PADDING.top });
  const all = unionRect(Object.values(rects));
  return all ? round({ x: all.x + all.w + GAP, y: all.y }) : { x: 0, y: 0 };
}

/**
 * Positions for `ids`, placed one by one so later ones avoid earlier ones; a box they already have does not
 * count until they are placed again. Groups with children are derived and skipped.
 */
export function placeNew(model: DiagramModel, layout: LayoutState, ids: readonly ID[], direction: Direction): Record<ID, NodeBox> {
  const pending = new Set(
    ids.filter((id) => {
      const el = own(model.elements, id);
      return el && (el.kind === 'node' || !model.order.some((other) => model.elements[other]?.parentId === id));
    }),
  );
  const placed: Record<ID, NodeBox> = {};
  for (const id of model.order) {
    if (!pending.has(id)) continue;
    const rects = positionedRects(model, { ...layout, nodes: { ...layout.nodes, ...placed } }, pending);
    pending.delete(id);
    placed[id] = placeNear(model, rects, id, direction);
  }
  return placed;
}

export interface BatchPlacement {
  /** For the elements the batch created, and for survivors it moved into a group they lie outside of. */
  positions: Record<ID, NodeBox>;
  /** No element kept from before the batch has a position: lay the whole diagram out (ELK) instead. */
  autoLayout: boolean;
}

/**
 * Where the elements of a batch go (text edits; AI drafts in M3). `layout` is already synced to `model`
 * (`syncLayout`). Elements created by `add_*`/`insert_between` — followed through renames in the same batch —
 * are placed with `placeNew`. A survivor moved into a group keeps its box if the group's rect (from its other
 * members) contains it; otherwise it is re-placed among its new siblings instead of stretching the group.
 */
export function placeBatch(model: DiagramModel, layout: LayoutState, ops: readonly DiagramOp[], direction: Direction = model.style.direction): BatchPlacement {
  const born = new Set<ID>();
  const moved = new Set<ID>();
  for (const op of ops) {
    if (op.op === 'add_node' || op.op === 'add_group') born.add(op.id);
    else if (op.op === 'insert_between') born.add(op.node.id);
    else if (op.op === 'move_to_group') {
      if (op.parentId === null) moved.delete(op.id);
      else moved.add(op.id);
    } else if (op.op === 'rename') {
      for (const ids of [born, moved]) if (ids.delete(op.id)) ids.add(op.to);
    }
  }
  const created = model.order.filter((id) => born.has(id));
  const rects = positionedRects(model, layout, new Set([...born, ...moved]));
  const strays = model.order.filter((id) => {
    const el = model.elements[id]!;
    const box = own(layout.nodes, id);
    const parent = el.parentId ? own(rects, el.parentId) : undefined;
    if (!moved.has(id) || born.has(id) || !box || !parent) return false;
    const size = defaultSize(el);
    const r = visualBox(el, { x: box.x, y: box.y, w: box.w ?? size.w, h: box.h ?? size.h });
    return !contains(parent, { x: r.x, y: r.y }) || !contains(parent, { x: r.x + r.w, y: r.y + r.h });
  });
  return {
    positions: placeNew(model, layout, [...created, ...strays], direction),
    autoLayout: model.order.length > 0 && !model.order.some((id) => !born.has(id) && own(layout.nodes, id)),
  };
}
