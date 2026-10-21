import { applyOps } from './applyOps';
import { copyElements, pasteOps } from './clipboard';
import { computeRects, GROUP_PADDING, unionRect, visualBox } from './geometry';
import { own, uniqueName } from './ids';
import { emptyLayout, emptyModel } from './model';
import type { DiagramElement, DiagramModel, DiagramOp, LayoutState, NodeBox } from './model';
import { descendantsOf } from './tree';
import type { DiagramPart } from './chatEdit';
import { splitDiagram } from './splitDiagram';

export function canvasFrameOf(model: DiagramModel, id: string): string | undefined {
  const seen = new Set<string>();
  let current: string | undefined = id;
  let frame: string | undefined;
  while (current && !seen.has(current)) {
    seen.add(current);
    const el: DiagramElement | undefined = own(model.elements, current);
    if (el?.kind === 'group' && el.canvasFrame) frame = current;
    current = el?.parentId;
  }
  return frame;
}

export function canvasFrames(model: DiagramModel): string[] {
  return model.order.filter(id => model.elements[id]?.kind === 'group' && model.elements[id]?.canvasFrame && canvasFrameOf(model, id) === id);
}

/** A frame's local graph, with its wrapper temporarily unmarked to avoid recursive scene layout. */
export function canvasFrameModel(model: DiagramModel, layout: LayoutState, frame: string): DiagramModel {
  const clip = copyElements(model, layout, [frame]);
  return { ...model, order: clip.elements.map(el => el.id), elements: Object.fromEntries(clip.elements.map(el => [el.id, el.id === frame && el.kind === 'group' ? { ...el, canvasFrame: false } : el])), edges: clip.edges };
}

const boundsOf = (model: DiagramModel, layout: LayoutState) => {
  const rects = computeRects(model, layout);
  return unionRect(model.order.flatMap(id => rects[id] ? [visualBox(model.elements[id]!, rects[id]!)] : []));
};

/** Import a snapshot as an editable, independent frame. Existing elements and positions are untouched. */
export function addCanvasDiagram(model: DiagramModel, layout: LayoutState, source: DiagramModel, sourceLayout: LayoutState, title: string, origin?: { x: number; y: number }) {
  const cleanTitle = title.trim();
  if (!cleanTitle || cleanTitle.length > 120) throw new Error('Dê um nome de até 120 caracteres ao diagrama.');
  // Reserve source ids too: a frame called "API" must not take the id of the API it wraps.
  const frame = uniqueName(cleanTitle, id => !!own(model.elements, id) || !!own(source.elements, id));
  const frameOps: DiagramOp[] = [{ op: 'add_group', id: frame, label: cleanTitle, canvasFrame: true, icon: 'panels-top-left', color: 'gray' }, { op: 'update', id: frame, set: { styleMode: 'plain', colorMode: 'outline' } }];
  const added = applyOps(model, frameOps);
  if (!added.ok) throw new Error(added.error.message);
  const clip = copyElements(source, sourceLayout, source.order.filter(id => !source.elements[id]?.parentId));
  // Keep labels and each source's appearance when ids collide or its global theme differs.
  clip.elements = clip.elements.map(el => ({ ...el, label: el.label ?? el.id, colorMode: el.colorMode ?? source.style.colorMode, styleMode: el.styleMode ?? source.style.styleMode, typeface: el.typeface ?? source.style.typeface }));
  const bounds = boundsOf(source, sourceLayout);
  const existing = boundsOf(model, layout);
  const at = origin ?? { x: existing ? existing.x + existing.w + 160 : 0, y: existing?.y ?? 0 };
  const pasted = pasteOps(added.model, clip, { x: Math.round(at.x + GROUP_PADDING.left - (bounds?.x ?? 0)), y: Math.round(at.y + GROUP_PADDING.top - (bounds?.y ?? 0)) });
  const roots = clip.elements.flatMap((el, i) => el.parentId ? [] : [pasted.ids[i]!]);
  const ops: DiagramOp[] = [...frameOps, ...pasted.ops, ...roots.map((id): DiagramOp => ({ op: 'move_to_group', id, parentId: frame }))];
  const positions: Record<string, NodeBox> = { ...pasted.positions, [frame]: { x: at.x, y: at.y, w: 520, h: 320 } };
  // Missing explicit boxes are still materialized, so imports cannot collapse all nodes at the origin.
  const sourceRects = computeRects(source, sourceLayout);
  for (let i = 0; i < clip.elements.length; i++) {
    const old = clip.elements[i]!.id, id = pasted.ids[i]!, rect = sourceRects[old];
    if (!positions[id] && rect && (clip.elements[i]!.kind === 'node' || !descendantsOf(source, old).length)) positions[id] = { x: Math.round(rect.x + at.x + GROUP_PADDING.left - (bounds?.x ?? 0)), y: Math.round(rect.y + at.y + GROUP_PADDING.top - (bounds?.y ?? 0)), w: rect.w, h: rect.h };
  }
  return { frame, ops, positions, ids: pasted.ids };
}

/** The same partition can stay on one canvas; a single batch creates all frames and supports normal undo. */
export function splitCanvasDiagram(model: DiagramModel, layout: LayoutState, parts: DiagramPart[]) {
  const snapshots = splitDiagram(model, layout, parts);
  let next = { ...emptyModel(), style: model.style };
  let nextLayout = emptyLayout();
  const ops: DiagramOp[] = model.order.filter(id => !model.elements[id]?.parentId).map(id => ({ op: 'remove', id }));
  const positions: Record<string, NodeBox> = {};
  const frames: string[] = [];
  for (const part of snapshots) {
    const imported = addCanvasDiagram(next, nextLayout, part.model, part.layout, part.title);
    const result = applyOps(next, imported.ops);
    if (!result.ok) throw new Error(result.error.message);
    next = result.model;
    Object.assign(positions, imported.positions);
    nextLayout = { nodes: { ...nextLayout.nodes, ...imported.positions }, edges: {} };
    ops.push(...imported.ops); frames.push(imported.frame);
  }
  return { ops, positions, frames };
}
