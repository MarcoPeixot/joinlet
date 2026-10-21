import { own, uniqueName } from './ids';
import type { DiagramElement, DiagramModel, DiagramOp, EdgeEl, ID, LayoutState, NodeBox, PropPatch } from './model';
import { descendantsOf } from './tree';

export interface ClipboardData {
  elements: DiagramElement[];
  edges: EdgeEl[];
  /** Explicit layout boxes only (computed sizes and derived group rects are not copied). */
  boxes: Record<ID, NodeBox>;
}

export function copyElements(model: DiagramModel, layout: LayoutState, ids: readonly ID[]): ClipboardData {
  const picked = new Set<ID>();
  for (const id of ids) {
    if (!own(model.elements, id)) continue;
    picked.add(id);
    for (const child of descendantsOf(model, id)) picked.add(child);
  }
  const elements = model.order
    .filter((id) => picked.has(id))
    .map((id) => {
      const el = structuredClone(model.elements[id]!);
      delete el.span;
      if (el.parentId && !picked.has(el.parentId)) delete el.parentId;
      return el;
    });
  const edges = model.edges
    .filter((e) => picked.has(e.from) && picked.has(e.to))
    .map((e) => {
      const copy = structuredClone(e);
      delete copy.span;
      return copy;
    });
  const boxes: Record<ID, NodeBox> = {};
  for (const el of elements) {
    const box = own(layout.nodes, el.id);
    if (box) boxes[el.id] = { ...box };
  }
  return { elements, edges, boxes };
}

function depthIn(clip: ClipboardData, id: ID): number {
  const byId = new Map(clip.elements.map((el) => [el.id, el]));
  let depth = 0;
  let cur = byId.get(id)?.parentId;
  while (cur && depth < 64) {
    depth++;
    cur = byId.get(cur)?.parentId;
  }
  return depth;
}

export function pasteOps(
  model: DiagramModel,
  clip: ClipboardData,
  offset: { x: number; y: number } = { x: 32, y: 32 },
): { ops: DiagramOp[]; positions: Record<ID, NodeBox>; ids: ID[] } {
  const taken = new Set(Object.keys(model.elements));
  const rename = new Map<ID, ID>();
  for (const el of clip.elements) {
    const id = uniqueName(el.id, (name) => taken.has(name));
    taken.add(id);
    rename.set(el.id, id);
  }
  const ops: DiagramOp[] = [];
  const positions: Record<ID, NodeBox> = {};
  for (const el of [...clip.elements].sort((a, b) => depthIn(clip, a.id) - depthIn(clip, b.id))) {
    const id = rename.get(el.id)!;
    const parentId = el.parentId ? rename.get(el.parentId) : undefined;
    ops.push(el.kind === 'group' ? { op: 'add_group', id, parentId } : { op: 'add_node', id, parentId });
    const { kind: _kind, id: _id, parentId: _parent, span: _span, ...props } = el;
    if (Object.keys(props).length) ops.push({ op: 'update', id, set: props as PropPatch });
    const box = own(clip.boxes, el.id);
    if (box) positions[id] = { ...box, x: box.x + offset.x, y: box.y + offset.y };
  }
  for (const edge of clip.edges) {
    ops.push({
      op: 'connect', from: rename.get(edge.from)!, to: rename.get(edge.to)!,
      connector: edge.connector, label: edge.label, color: edge.color,
      fromPort: edge.fromPort, toPort: edge.toPort, fromCardinality: edge.fromCardinality, toCardinality: edge.toCardinality,
    });
  }
  return { ops, positions, ids: [...rename.values()] };
}
