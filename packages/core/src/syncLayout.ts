import { own } from './ids';
import type { DiagramModel, DiagramOp, ID, LayoutState, NodeBox } from './model';

/** Layout after a successful batch: follows renames, drops removed ids, merges new positions. */
export function syncLayout(
  prev: LayoutState,
  model: DiagramModel,
  ops: readonly DiagramOp[],
  positions: Readonly<Record<ID, NodeBox>> = {},
): LayoutState {
  const nodes: Record<ID, NodeBox> = { ...prev.nodes };
  for (const op of ops) {
    if (op.op !== 'rename' || op.id === op.to) continue;
    const box = own(nodes, op.id);
    if (!box) continue;
    nodes[op.to] = box;
    delete nodes[op.id];
  }
  for (const id of Object.keys(nodes)) if (!own(model.elements, id)) delete nodes[id];
  for (const [id, box] of Object.entries(positions)) if (own(model.elements, id)) nodes[id] = { ...own(nodes, id), ...box };
  return { nodes, edges: {} };
}
