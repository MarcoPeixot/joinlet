import { uiText } from '../i18n';
import { applyOps, canvasFrameModel, canvasFrameOf, compareModels, computeRects, renamesIn, syncLayout } from '@strukt/core';
import type { DiagramModel, DiagramOp, ID, LayoutState, ModelChanges, NodeBox } from '@strukt/core';
import { autoLayout, placeBatch } from '@strukt/layout';
import type { EdgeRouter } from '@strukt/layout';
import { loadEraserRouter } from '../state/eraserRouter';
import { computeRoutes } from '../state/routing';

export type DraftSource = 'ai' | 'offline';

export interface Proposal {
  ops: DiagramOp[];
  summary: string;
  source: DraftSource;
  /** Claude model that answered (absent offline). */
  model?: string;
}

/** A proposal rendered as a preview; "Aplicar" commits exactly `ops` + `positions` as one undo step. */
export interface Draft extends Proposal {
  /** The model the ops were written for: applying is refused if the diagram changed since. */
  base: DiagramModel;
  next: DiagramModel;
  positions: Record<ID, NodeBox>;
  /** Preview geometry: the node boxes the store will have after applying, with routes of its own. */
  layout: LayoutState;
  changes: ModelChanges;
  autoLayout: boolean;
}

export type LayoutRunner = (model: DiagramModel) => Promise<Record<ID, NodeBox>>;

export interface DraftOptions {
  /** Routes the preview's edges (never through the store). */
  router?: EdgeRouter;
  runLayout?: LayoutRunner;
}

export async function createDraft(
  model: DiagramModel,
  layout: LayoutState,
  proposal: Proposal,
  { router, runLayout = (next) => autoLayout(next) }: DraftOptions = {},
): Promise<{ ok: true; draft: Draft } | { ok: false; error: string }> {
  let result: ReturnType<typeof applyOps>;
  try {
    result = applyOps(model, proposal.ops);
  } catch (err) {
    return { ok: false, error: uiText("Proposta inválida: {0}", [err instanceof Error ? err.message : String(err)]) };
  }
  if (!result.ok) return { ok: false, error: uiText("A proposta não pôde ser aplicada: {0}", [result.error.message]) };
  const next = result.model;
  const changes = compareModels(model, next, renamesIn(model, proposal.ops));
  // Preserve manual placement for edits, but reflow the full diagram when the AI adds a node or group.
  const placement = placeBatch(next, syncLayout(layout, next, proposal.ops), proposal.ops);
  const autoLayout = placement.autoLayout || proposal.ops.some((op) => op.op === 'add_node' || op.op === 'add_group' || op.op === 'insert_between');
  let positions = placement.positions;
  if (autoLayout) {
    try {
      const touched = [...changes.elements.added, ...changes.elements.changed, ...changes.elements.removed];
      const scopes = touched.map(id => canvasFrameOf(next, id) ?? canvasFrameOf(model, id));
      const scoped = scopes.length > 0 && scopes.every(Boolean) && !proposal.ops.some(op => op.op === 'set_style');
      if (scoped) {
        positions = {};
        const oldRects = computeRects(model, layout);
        for (const frame of new Set(scopes as string[])) {
          if (!next.elements[frame]) continue;
          const local = canvasFrameModel(next, layout, frame);
          const placed = await runLayout(local);
          const bounds = computeRects(local, { nodes: placed, edges: {} })[frame]!;
          const at = oldRects[frame] ?? bounds;
          for (const [id, box] of Object.entries(placed)) positions[id] = { ...box, x: Math.round(box.x + at.x - bounds.x), y: Math.round(box.y + at.y - bounds.y) };
        }
      } else positions = await runLayout(next);
    } catch {
      // keep the placeBatch positions
    }
  }
  const nodes = syncLayout(layout, next, proposal.ops, positions).nodes;
  const rects = computeRects(next, { nodes, edges: {} });
  const draft: Draft = {
    ...proposal,
    base: model,
    next,
    positions,
    layout: { nodes, edges: computeRoutes(next, rects, router ?? (await loadEraserRouter())) },
    changes,
    autoLayout,
  };
  return { ok: true, draft };
}
