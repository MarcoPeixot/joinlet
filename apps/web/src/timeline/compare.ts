import { uiText } from '../i18n';
import { compareModels, computeRects, diffModels, own, renamesIn } from '@strukt/core';
import type { DiagramModel, LayoutState } from '@strukt/core';
import { placeNew } from '@strukt/layout';
import type { EdgeRouter } from '@strukt/layout';
import type { DiagramSnapshot } from '@strukt/workspace';
import type { DiffPreview } from '../ai/overlay';
import { computeRoutes } from '../state/routing';
import { changeLines } from '../versions/restore';
import type { ChangeLine } from '../versions/restore';

export interface ChangeCounts {
  added: number;
  removed: number;
  changed: number;
}

/** What the canvas draws between two points of the time axis, and the same changes in words. */
export interface TimelineDiff {
  /** `base` is the earlier state, `next` the later one (the M3/M5 diff overlay draws it). */
  preview: DiffPreview;
  /** Where the earlier state had its elements: the overlay puts the ghosts of removed elements there. */
  oldLayout: LayoutState;
  lines: ChangeLine[];
  counts: ChangeCounts;
  /** Same meaning: only positions (or nothing) differ. */
  unchanged: boolean;
}

/** A box for every node: elements a saved state never had one for are placed, not piled at the origin. */
function withBoxes(model: DiagramModel, layout: LayoutState): LayoutState {
  const nodes = Object.fromEntries(Object.entries(layout.nodes).filter(([id]) => own(model.elements, id)));
  const missing = model.order.filter((id) => !own(nodes, id));
  return { nodes: missing.length ? { ...nodes, ...placeNew(model, { nodes, edges: {} }, missing, model.style.direction) } : nodes, edges: layout.edges };
}

/** The changes from an earlier state to a later one, ready for the diff overlay. Never touches the open diagram. */
export function diffStates(from: DiagramSnapshot, to: DiagramSnapshot, router: EdgeRouter): TimelineDiff {
  const oldLayout = withBoxes(from.model, from.layout);
  const placed = withBoxes(to.model, to.layout);
  const routed = Object.keys(placed.edges).length ? placed : { nodes: placed.nodes, edges: computeRoutes(to.model, computeRects(to.model, { nodes: placed.nodes, edges: {} }), router) };
  const ops = diffModels(from.model, to.model);
  const preview: DiffPreview = {
    base: from.model,
    next: to.model,
    layout: routed,
    changes: compareModels(from.model, to.model, renamesIn(from.model, ops)),
  };
  const lines = changeLines(preview);
  const counts: ChangeCounts = { added: 0, removed: 0, changed: 0 };
  for (const line of lines) counts[line.kind]++;
  return { preview, oldLayout, lines, counts, unchanged: lines.length === 0 };
}

const part = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "3 adicionados, 2 removidos e 4 alterados.": only what is not zero. */
export function summarizeLines({ added, removed, changed }: ChangeCounts): string {
  const parts = [added && part(added, uiText("adicionado"), uiText("adicionados")), removed && part(removed, uiText("removido"), uiText("removidos")), changed && part(changed, uiText("alterado"), uiText("alterados"))].filter((p): p is string => !!p);
  if (!parts.length) return uiText("Sem mudanças no diagrama.");
  return `${parts.length > 1 ? uiText("{0} e {1}", [parts.slice(0, -1).join(', '), parts[parts.length - 1]]) : parts[0]}.`;
}
