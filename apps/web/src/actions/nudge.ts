import { computeRects, topLevel, translateSubtree } from '@strukt/core';
import type { DiagramModel, Direction, ID, LayoutState, NodeBox } from '@strukt/core';
import { diagramStore } from '../state/appStore';

const UNIT: Record<Direction, { x: number; y: number }> = {
  right: { x: 1, y: 0 },
  left: { x: -1, y: 0 },
  down: { x: 0, y: 1 },
  up: { x: 0, y: -1 },
};

/** New positions after moving `ids` by `distance` px towards `dir`; groups carry their contents. */
export function nudgePositions(
  model: DiagramModel,
  layout: LayoutState,
  ids: readonly ID[],
  dir: Direction,
  distance: number,
): Record<ID, NodeBox> {
  const rects = computeRects(model, layout);
  const { x, y } = UNIT[dir];
  const positions: Record<ID, NodeBox> = {};
  for (const id of topLevel(model, ids)) Object.assign(positions, translateSubtree(model, rects, id, x * distance, y * distance));
  return positions;
}

/** Arrow-key nudge of the selected nodes: one undo step per keypress. */
export function nudgeSelection(dir: Direction, distance: number): boolean {
  const state = diagramStore.getState();
  const positions = nudgePositions(state.model, state.layout, state.selection.nodes, dir, distance);
  return Object.keys(positions).length > 0 && state.apply([], positions);
}
