import { computeRects, depthsOf, nodeVariant, own } from '@strukt/core';
import type { ColorMode, DiagramElement, DiagramModel, EdgeEl, ID, LayoutState, Rect, StyleMode, Typeface } from '@strukt/core';
import { cachedLabel, cachedRoute, routeKey, sequenceMessages } from '@strukt/layout';
import type { Point } from '@strukt/layout';
import type { Edge, Node } from '@xyflow/react';
import { edgeAriaLabel, nodeAriaLabel } from './aria';
import type { Selection } from '../state/diagramStore';
import type { Focus, FocusDir } from './focus';
import type { Theme } from '../ui/theme';

/** How an element or edge differs in an AI draft preview (see ai/overlay.ts). */
export type DiffMark = 'added' | 'removed' | 'changed';

export interface ElementData extends Record<string, unknown> {
  el: DiagramElement;
  colorMode: ColorMode;
  styleMode: StyleMode;
  typeface: Typeface;
  theme: Theme;
  diff?: DiffMark;
  evidenceCount?: number;
}

export interface EdgeData extends Record<string, unknown> {
  sequenceOrder?: number;
  edge: EdgeEl;
  points: Point[];
  /** Center of the label (labelled edges): placed with the routes, halfway along until then. */
  labelAt?: Point;
  /** Identifies the endpoint rects (`routeKey`): a new route with the same ends glides in, a moved end snaps. */
  ends?: string;
  theme: Theme;
  typeface: Typeface;
  diff?: DiffMark;
  /** Part of the focus: pulses, colored by how it relates to the focused element. */
  focus?: FocusDir;
  /** Outside the focus: faded (its label too, which React Flow renders apart from the line). */
  dimmed?: boolean;
  /** Created by the last commit: draws in once (canvas/enterMarks). */
  draw?: boolean;
}

export type ElementNode = Node<ElementData, 'shape' | 'icon' | 'card' | 'table' | 'participant' | 'sgroup' | 'boardCard'>;
export type StruktEdge = Edge<EdgeData, 'strukt'>;

export interface FlowProjection {
  nodes: ElementNode[];
  edges: StruktEdge[];
  rects: Record<ID, Rect>;
}

/** The focused element glows; its neighbours and the groups around them stay lit; the rest fades. */
function focusClass(focus: Focus, id: ID, group: boolean): string {
  if (id === focus.origin) return 'sk-focus-origin';
  if (focus.nodes.has(id) || (group && focus.groups.has(id))) return '';
  return 'sk-dim';
}

/** Lines sit above groups and below nodes. */
export const EDGE_Z = 500;
export const NODE_Z = 1000;

interface Cached<T> {
  ref: unknown;
  key: string;
  value: T;
}

// Reused between calls so memoized node/edge components skip renders. An entry is only valid while the element
// (by identity) and every other input in its key are equal; ids that vanish are dropped at the end of each call.
// Maps (not objects): ids such as `constructor` are valid names.
let nodeCache = new Map<ID, Cached<ElementNode>>();
let edgeCache = new Map<ID, Cached<StruktEdge>>();

export function toFlow(
  model: DiagramModel,
  layout: LayoutState,
  selection: Selection,
  theme: Theme,
  frozen?: Readonly<Record<ID, Rect>>,
  focus?: Focus | null,
  evidence?: Readonly<Record<ID, readonly unknown[]>>,
  /** The canvas's own node type for an element (the Overview's cards), else the diagram's. */
  typeOf?: (el: DiagramElement) => ElementNode['type'] | undefined,
): FlowProjection {
  const rects = computeRects(model, layout, frozen);
  const selectedNodes = new Set(selection.nodes);
  const selectedEdges = new Set(selection.edges);
  const rank = (id: ID) => (model.elements[id]?.kind === 'group' ? 0 : 1);
  const depths = depthsOf(model);
  const depth = (id: ID) => depths.get(id) ?? 0;
  // Connections per element (a self-loop counts once) and elements per group, for the accessible names.
  const degrees = new Map<ID, number>();
  for (const edge of model.edges) {
    degrees.set(edge.from, (degrees.get(edge.from) ?? 0) + 1);
    if (edge.to !== edge.from) degrees.set(edge.to, (degrees.get(edge.to) ?? 0) + 1);
  }
  const children = new Map<ID, number>();
  for (const el of Object.values(model.elements)) if (el.parentId) children.set(el.parentId, (children.get(el.parentId) ?? 0) + 1);
  const ids = [...model.order].sort((a, b) => rank(a) - rank(b) || depth(a) - depth(b));

  const nodes: ElementNode[] = [];
  const nextNodes = new Map<ID, Cached<ElementNode>>();
  for (const id of ids) {
    const el = model.elements[id];
    const r = rects[id];
    if (!el || !r) continue;
    const parent = el.parentId ? rects[el.parentId] : undefined;
    const className = focus ? focusClass(focus, id, el.kind === 'group') : null;
    const evidenceCount = (evidence ? own(evidence, id)?.length : 0) ?? 0;
    const zIndex = el.kind === 'group' ? depth(id) : NODE_Z;
    const colorMode = el.colorMode ?? model.style.colorMode;
    const styleMode = el.styleMode ?? model.style.styleMode;
    const typeface = el.typeface ?? model.style.typeface;
    const selected = selectedNodes.has(id);
    const ariaLabel = nodeAriaLabel(el, degrees.get(id) ?? 0, children.get(id) ?? 0);
    const key = JSON.stringify([r.x, r.y, r.w, r.h, parent?.x ?? 0, parent?.y ?? 0, zIndex, selected, className, colorMode, styleMode, typeface, theme, evidenceCount, ariaLabel]);
    const hit = nodeCache.get(id);
    if (hit && hit.ref === el && hit.key === key) {
      nextNodes.set(id, hit);
      nodes.push(hit.value);
      continue;
    }
    const node: ElementNode = {
      id,
      type: typeOf?.(el) ?? (el.kind === 'group' ? 'sgroup' : nodeVariant(el)),
      position: { x: r.x - (parent?.x ?? 0), y: r.y - (parent?.y ?? 0) },
      ...(el.parentId ? { parentId: el.parentId } : {}),
      width: r.w,
      height: r.h,
      zIndex,
      selected,
      ariaLabel,
      ...(className !== null ? { className } : {}),
      data: {
        el,
        colorMode,
        styleMode,
        typeface,
        theme,
        ...(evidenceCount ? { evidenceCount } : {}),
      },
    };
    nextNodes.set(id, { ref: el, key, value: node });
    nodes.push(node);
  }
  nodeCache = nextNodes;

  const edges: StruktEdge[] = [];
  const sequence = sequenceMessages(model, rects);
  const nextEdges = new Map<ID, Cached<StruktEdge>>();
  for (const edge of model.edges) {
    const a = rects[edge.from];
    const b = rects[edge.to];
    if (!a || !b) continue;
    const points = sequence[edge.id]?.points ?? cachedRoute(layout.edges, edge, a, b, model);
    const dir = focus?.edges.get(edge.id);
    const dimmed = !!focus && !dir && !focus.calm.has(edge.id);
    const labelAt = sequence[edge.id]?.label ?? (edge.label ? cachedLabel(layout.edges, edge, a, b, points) : undefined);
    const selected = selectedEdges.has(edge.id);
    const ariaLabel = edgeAriaLabel(model.elements[edge.from]?.label ?? edge.from, model.elements[edge.to]?.label ?? edge.to, edge.label);
    const ends = routeKey(a, b);
    const key = JSON.stringify([ariaLabel, points, labelAt ?? null, ends, sequence[edge.id]?.order ?? null, selected, dir ?? null, dimmed, theme, model.style.typeface]);
    const hit = edgeCache.get(edge.id);
    if (hit && hit.ref === edge && hit.key === key) {
      nextEdges.set(edge.id, hit);
      edges.push(hit.value);
      continue;
    }
    const built: StruktEdge = {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: 'strukt',
      zIndex: EDGE_Z,
      selected,
      ariaLabel,
      // No keyboard action lives on an edge (keys are ours, see disableKeyboardA11y): a Tab stop would only be noise.
      focusable: false,
      ...(dir ? { className: 'sk-focus-edge' } : dimmed ? { className: 'sk-dim' } : {}),
      data: {
        edge,
        points,
        ...(sequence[edge.id] ? { sequenceOrder: sequence[edge.id]!.order } : {}),
        ...(labelAt ? { labelAt } : {}),
        ends,
        theme,
        typeface: model.style.typeface,
        ...(dir ? { focus: dir } : {}),
        ...(dimmed ? { dimmed } : {}),
      },
    };
    nextEdges.set(edge.id, { ref: edge, key, value: built });
    edges.push(built);
  }
  edgeCache = nextEdges;
  return { nodes, edges, rects };
}
