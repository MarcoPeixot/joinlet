import { computeRects, nodeVariant, own } from '@strukt/core';
import type { ID, LayoutState } from '@strukt/core';
import { cachedLabel, cachedRoute } from '@strukt/layout';
import { EDGE_Z, NODE_Z, toFlow } from '../diagram/toFlow';
import type { DiffMark, ElementNode, FlowProjection, StruktEdge } from '../diagram/toFlow';
import type { Theme } from '../ui/theme';
import type { Draft } from './draft';

/** Prefix of ghost ids (removed elements/edges drawn in the preview); DSL names only contain ":" when quoted. */
export const GHOST = 'ghost:';

/** What the diff overlay draws: an AI draft (M3) or a version compare (M5). */
export type DiffPreview = Pick<Draft, 'base' | 'next' | 'layout' | 'changes'>;

const mark = <T extends ElementNode | StruktEdge>(item: T, diff: DiffMark | undefined): T =>
  diff ? { ...item, className: `sk-diff-${diff}`, data: { ...item.data, diff } } : item;

/**
 * What the canvas shows while a draft is pending: the draft diagram with added (green) and changed (amber)
 * marks, plus red dashed ghosts of removed elements and edges where they are now. Reused by M5's compare.
 */
export function draftProjection(draft: DiffPreview, current: LayoutState, theme: Theme): FlowProjection {
  const { base, changes } = draft;
  const projection = toFlow(draft.next, draft.layout, { nodes: [], edges: [] }, theme);
  const kind = (added: ID[], changed: ID[]) => {
    const a = new Set(added);
    const c = new Set(changed);
    return (id: ID): DiffMark | undefined => (a.has(id) ? 'added' : c.has(id) ? 'changed' : undefined);
  };
  const elementMark = kind(changes.elements.added, changes.elements.changed);
  const edgeMark = kind(changes.edges.added, changes.edges.changed);
  const nodes = projection.nodes.map((node) => mark(node, elementMark(node.id)));
  const edges = projection.edges.map((edge) => mark(edge, edgeMark(edge.id)));

  const oldRects = computeRects(base, current);
  const removed = new Set(changes.elements.removed);
  for (const id of changes.elements.removed) {
    const el = base.elements[id];
    const r = oldRects[id];
    if (!el || !r) continue;
    nodes.push({
      id: `${GHOST}${id}`,
      type: el.kind === 'group' ? 'sgroup' : nodeVariant(el),
      position: { x: r.x, y: r.y },
      width: r.w,
      height: r.h,
      zIndex: el.kind === 'group' ? 0 : NODE_Z,
      selectable: false,
      draggable: false,
      connectable: false,
      className: 'sk-diff-removed',
      data: {
        el,
        colorMode: el.colorMode ?? base.style.colorMode,
        styleMode: el.styleMode ?? base.style.styleMode,
        typeface: el.typeface ?? base.style.typeface,
        theme,
        diff: 'removed',
      },
    });
  }
  // A ghost edge hangs on the ghost of a removed endpoint, or on the (possibly renamed) element that stays.
  const endpoint = (id: ID) => (removed.has(id) ? `${GHOST}${id}` : own(changes.renamed, id) ?? id);
  for (const id of changes.edges.removed) {
    const edge = base.edges.find((e) => e.id === id);
    const a = edge && oldRects[edge.from];
    const b = edge && oldRects[edge.to];
    if (!edge || !a || !b) continue;
    const points = cachedRoute(current.edges, edge, a, b, base);
    edges.push({
      id: `${GHOST}${edge.id}`,
      source: endpoint(edge.from),
      target: endpoint(edge.to),
      type: 'strukt',
      zIndex: EDGE_Z,
      selectable: false,
      className: 'sk-diff-removed',
      data: {
        edge,
        points,
        ...(edge.label ? { labelAt: cachedLabel(current.edges, edge, a, b, points) } : {}),
        theme,
        typeface: base.style.typeface,
        diff: 'removed',
      },
    });
  }
  return { nodes, edges, rects: projection.rects };
}
