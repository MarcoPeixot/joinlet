import { uiText } from '../i18n';
import { canvasFrameOf, computeRects, contains, EMPTY_GROUP_SIZE, ICON_NODE_SIZE, SHAPE_SIZES, defaultSize, descendantsOf, sharedParent, topLevel, uniqueName } from '@strukt/core';
import type { ComponentPreset, DiagramOp, DiagramStyle, ID, PropPatch, Shape } from '@strukt/core';
import { diagramStore } from '../state/appStore';
import { uiStore } from '../ui/uiStore';
import { collaborationSession } from '../workspace/boot';

type Point = { x: number; y: number };

const taken = (name: string) => name in diagramStore.getState().model.elements;

export function newElementIdentity(base: string): { id: string; label?: string } {
  const name = uniqueName(base, taken);
  return collaborationSession() ? { id: `${name} ${crypto.randomUUID().slice(0, 8)}`, label: name } : { id: name };
}

function focus(id: ID): void {
  diagramStore.getState().select({ nodes: [id], edges: [] });
  uiStore.setState({ editingId: id });
}

function framePlacement(point: Point): { parentId?: string; point: Point } {
  const { model, layout, selection } = diagramStore.getState();
  const rects = computeRects(model, layout);
  const selected = selection.nodes.length === 1 ? canvasFrameOf(model, selection.nodes[0]!) : undefined;
  const parentId = selected ?? model.order.find(id => model.elements[id]?.kind === 'group' && model.elements[id]?.canvasFrame && rects[id] && contains(rects[id]!, point));
  const bounds = parentId ? rects[parentId] : undefined;
  return { parentId, point: bounds && !contains(bounds, point) ? { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 } : point };
}

export function addNodeAt(point: Point, kind: 'shape' | 'icon'): void {
  const placed = framePlacement(point); point = placed.point;
  const { id, label } = newElementIdentity(kind === 'icon' ? uiText("Serviço") : uiText("Nó"));
  const size = kind === 'icon' ? ICON_NODE_SIZE : SHAPE_SIZES.rectangle;
  const op: DiagramOp = kind === 'icon' ? { op: 'add_node', id, label, parentId: placed.parentId, icon: 'server' } : { op: 'add_node', id, label, parentId: placed.parentId };
  const position = { x: Math.round(point.x - size.w / 2), y: Math.round(point.y - size.h / 2) };
  if (diagramStore.getState().apply([op], { [id]: position })) focus(id);
}

export function addComponentAt(point: Point, preset: ComponentPreset): void {
  const placed = framePlacement(point); point = placed.point;
  const { id, label } = newElementIdentity(preset.label);
  const op: DiagramOp = preset.kind === 'group'
    ? { op: 'add_group', id, label, parentId: placed.parentId, icon: preset.icon, color: preset.color }
    : { op: 'add_node', id, label, parentId: placed.parentId, shape: preset.shape, icon: preset.icon, color: preset.color, tech: preset.tech, presentation: preset.presentation, layoutRole: preset.layoutRole, fields: preset.fields ? structuredClone(preset.fields) : undefined };
  const size = defaultSize({ ...op, kind: preset.kind === 'group' ? 'group' : 'node' });
  const w = preset.width ?? size.w, h = preset.height ?? size.h;
  const position = { x: Math.round(point.x - w / 2), y: Math.round(point.y - h / 2), ...(preset.width ? { w } : {}), ...(preset.height ? { h } : {}) };
  const ops: DiagramOp[] = [op];
  if (preset.description) ops.push({ op: 'update', id, set: { description: preset.description } });
  if (preset.kind === 'group' && preset.tech) ops.push({ op: 'update', id, set: { tech: preset.tech } });
  if (diagramStore.getState().apply(ops, { [id]: position })) focus(id);
}

/** Wraps the selection in a new group, or drops an empty group at `point` when nothing is selected. */
export function groupSelectionOrCreate(point: Point): void {
  const state = diagramStore.getState();
  const members = topLevel(state.model, state.selection.nodes);
  const { id, label } = newElementIdentity(uiText("Grupo"));
  const ops: DiagramOp[] = [
    { op: 'add_group', id, label, parentId: members.length ? sharedParent(state.model, members) : undefined },
    ...members.map((member): DiagramOp => ({ op: 'move_to_group', id: member, parentId: id })),
  ];
  const positions = members.length
    ? {}
    : { [id]: { x: Math.round(point.x - EMPTY_GROUP_SIZE.w / 2), y: Math.round(point.y - EMPTY_GROUP_SIZE.h / 2) } };
  if (state.apply(ops, positions)) focus(id);
}

export function deleteSelection(): void {
  const state = diagramStore.getState();
  const roots = topLevel(state.model, state.selection.nodes);
  const removed = new Set(roots.flatMap((id) => [id, ...descendantsOf(state.model, id)]));
  const edgeOps = state.selection.edges.flatMap((edgeId): DiagramOp[] => {
    const edge = state.model.edges.find((e) => e.id === edgeId);
    return edge && !removed.has(edge.from) && !removed.has(edge.to) ? [{ op: 'remove_edge', edgeId }] : [];
  });
  const ops: DiagramOp[] = [...roots.map((id): DiagramOp => ({ op: 'remove', id })), ...edgeOps];
  if (ops.length) state.apply(ops);
}

export function removeAll(): void {
  const state = diagramStore.getState();
  const roots = state.model.order.filter((id) => !state.model.elements[id]?.parentId);
  if (roots.length) state.apply(roots.map((id): DiagramOp => ({ op: 'remove', id })));
}

/** Shape selection exits the card presentation and recomputes its footprint in one undo step. */
export function changeShape(id: ID, shape: Shape | null): void {
  const state = diagramStore.getState();
  const element = state.model.elements[id];
  if (!element || element.kind !== 'node') return;
  const rect = computeRects(state.model, state.layout)[id];
  const size = defaultSize({...element, shape: shape ?? undefined, presentation: shape ? undefined : 'icon'});
  state.apply([{op:'update', id, set:{shape, presentation:shape ? null : 'icon'}}], rect ? {[id]: {x:rect.x+(rect.w-size.w)/2,y:rect.y+(rect.h-size.h)/2,w:size.w,h:size.h}} : {});
}

export function updateElement(id: ID, set: PropPatch): void {
  updateElements([id], set);
}

/** Same patch for several elements as one batch (one undo step). */
export function updateElements(ids: readonly ID[], set: PropPatch): void {
  if (ids.length) diagramStore.getState().apply(ids.map((id): DiagramOp => ({ op: 'update', id, set })));
}

/** In a shared room the id is the merge key (a rename would fork concurrent edits of the node): the label changes. */
export function renameElement(id: ID, to: string): boolean {
  const target = to.trim();
  if (!target || target === id) return false;
  if (collaborationSession()) return diagramStore.getState().apply([{ op: 'update', id, set: { label: target } }]);
  return diagramStore.getState().apply([{ op: 'rename', id, to: target }]);
}

export function updateEdge(edgeId: ID, set: Extract<DiagramOp, { op: 'update_edge' }>['set']): void {
  diagramStore.getState().apply([{ op: 'update_edge', edgeId, set }]);
}

export function setDiagramStyle(set: Partial<DiagramStyle>): void {
  diagramStore.getState().apply([{ op: 'set_style', set }]);
}

export function selectAll(): void {
  const { model, select } = diagramStore.getState();
  select({ nodes: [...model.order], edges: model.edges.map((e) => e.id) });
}
