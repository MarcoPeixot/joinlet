import { applyOps, syncLayout } from '@strukt/core';
import type { DiagramModel, DiagramOp, ID, LayoutState, NodeBox } from '@strukt/core';
import { placeBatch } from '@strukt/layout';

export interface PlannedSnapshot {
  model: DiagramModel;
  layout: LayoutState;
  /** `placeBatch` positions for the elements the batch created (or moved). */
  positions: Record<ID, NodeBox>;
  /** No element kept from before the batch has a position: the caller should lay the whole diagram out (ELK). */
  autoLayout: boolean;
}

/**
 * Applies a batch to a snapshot the same way the app does (spec M5.5): `applyOps`, then `placeBatch` for
 * the created elements. The caller persists `layout` and, when `autoLayout` is true, runs ELK first.
 */
export function planSnapshot(
  model: DiagramModel,
  layout: LayoutState,
  ops: readonly DiagramOp[],
): { ok: true; planned: PlannedSnapshot } | { ok: false; error: string } {
  let result: ReturnType<typeof applyOps>;
  try {
    result = applyOps(model, ops);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!result.ok) return { ok: false, error: result.error.message };
  const next = result.model;
  const { positions, autoLayout } = placeBatch(next, syncLayout(layout, next, ops), ops);
  return { ok: true, planned: { model: next, layout: syncLayout(layout, next, ops, positions), positions, autoLayout } };
}
