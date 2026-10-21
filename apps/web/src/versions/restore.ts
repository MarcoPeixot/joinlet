import { uiText } from '../i18n';
import { applyOps, compareModels, computeRects, diffModels, own, renamesIn, syncLayout } from '@strukt/core';
import type { DiagramModel, DiagramOp, EdgeEl, ID, NodeBox } from '@strukt/core';
import { placeNew } from '@strukt/layout';
import type { EdgeRouter } from '@strukt/layout';
import type { DiagramSnapshot } from '@strukt/workspace';
import type { DiffPreview } from '../ai/overlay';
import type { DiffMark } from '../diagram/toFlow';
import { computeRoutes } from '../state/routing';

/** "Restaurar esta versão": exactly what one `apply` commits, and the preview the canvas shows before it. */
export interface RestorePlan {
  /** `diffModels(current, version)`: one batch, one undo step. */
  ops: DiagramOp[];
  /** The version's boxes (merged over the current layout) plus places for elements it had no box for. */
  positions: Record<ID, NodeBox>;
  /** The diagram as restoring leaves it, compared with the current one (drawn by the M3 diff overlay). */
  preview: DiffPreview;
  /** Restoring would change nothing: same meaning and every box already where the version has it. */
  unchanged: boolean;
}

const sameBox = (a: NodeBox | undefined, b: NodeBox) =>
  !!a && a.x === b.x && a.y === b.y && (b.w === undefined || a.w === b.w) && (b.h === undefined || a.h === b.h);

export function planRestore(current: DiagramSnapshot, target: DiagramSnapshot, router: EdgeRouter): RestorePlan {
  const ops = diffModels(current.model, target.model);
  const result = applyOps(current.model, ops);
  if (!result.ok) throw new Error(result.error.message);
  const next = result.model;
  const wanted = Object.fromEntries(Object.entries(target.layout.nodes).filter(([id]) => own(next.elements, id)));
  const synced = syncLayout(current.layout, next, ops, wanted);
  const missing = next.order.filter((id) => !own(synced.nodes, id));
  const positions = { ...wanted, ...placeNew(next, synced, missing, next.style.direction) };
  const nodes = syncLayout(current.layout, next, ops, positions).nodes;
  const preview: DiffPreview = {
    base: current.model,
    next,
    layout: { nodes, edges: computeRoutes(next, computeRects(next, { nodes, edges: {} }), router) },
    changes: compareModels(current.model, next, renamesIn(current.model, ops)),
  };
  const unchanged = !ops.length && Object.entries(positions).every(([id, box]) => sameBox(own(current.layout.nodes, id), box));
  return { ops, positions, preview, unchanged };
}

export interface ChangeLine {
  kind: DiffMark;
  text: string;
}

/** The overlay in words, for the "Versões" panel: what restoring adds, removes and changes. */
export function changeLines({ base, next, changes }: DiffPreview): ChangeLine[] {
  const element = (model: DiagramModel, id: ID) => (own(model.elements, id)?.kind === 'group' ? uiText("{0} (grupo)", [id]) : id);
  const edge = (model: DiagramModel, id: ID) => {
    const found: EdgeEl | undefined = model.edges.find((e) => e.id === id);
    return found ? `${found.from} → ${found.to}${found.label ? `: ${found.label}` : ''}` : id;
  };
  const before = new Map(Object.entries(changes.renamed).map(([from, to]) => [to, from]));
  const line = (kind: DiffMark) => (text: string): ChangeLine => ({ kind, text });
  return [
    ...changes.elements.added.map((id) => line('added')(element(next, id))),
    ...changes.edges.added.map((id) => line('added')(edge(next, id))),
    ...changes.elements.removed.map((id) => line('removed')(element(base, id))),
    ...changes.edges.removed.map((id) => line('removed')(edge(base, id))),
    ...changes.elements.changed.map((id) => line('changed')(before.has(id) ? uiText("{0} (antes: {1})", [element(next, id), before.get(id)]) : element(next, id))),
    ...changes.edges.changed.map((id) => line('changed')(edge(next, id))),
    ...(changes.style ? [line('changed')(uiText("Estilo do diagrama"))] : []),
  ];
}
