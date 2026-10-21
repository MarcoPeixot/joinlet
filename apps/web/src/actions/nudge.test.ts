import { applyOps, emptyLayout, emptyModel } from '@strukt/core';
import type { DiagramModel, DiagramOp } from '@strukt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { diagramStore } from '../state/appStore';
import { nudgePositions, nudgeSelection } from './nudge';

function build(ops: DiagramOp[]): DiagramModel {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

describe('nudgePositions', () => {
  const model = build([
    { op: 'add_group', id: 'G' },
    { op: 'add_node', id: 'A', parentId: 'G' },
    { op: 'add_node', id: 'B', parentId: 'G' },
    { op: 'add_node', id: 'C', icon: 'redis' },
  ]);
  const layout = { nodes: { A: { x: 0, y: 0 }, B: { x: 200, y: 0 }, C: { x: 500, y: 0, w: 80, h: 80 } }, edges: {} };

  it('moves each selected node by the distance in the direction, positions only', () => {
    expect(nudgePositions(model, layout, ['C'], 'right', 1)).toEqual({ C: { x: 501, y: 0 } });
    expect(nudgePositions(model, layout, ['C'], 'up', 10)).toEqual({ C: { x: 500, y: -10 } });
  });

  it('carries a group contents and does not move a child twice when its group is selected too', () => {
    expect(nudgePositions(model, layout, ['G', 'A'], 'down', 10)).toEqual({ A: { x: 0, y: 10 }, B: { x: 200, y: 10 } });
  });

  it('returns nothing for an empty selection', () => {
    expect(nudgePositions(model, layout, [], 'left', 1)).toEqual({});
  });
});

describe('nudgeSelection', () => {
  beforeEach(() => {
    diagramStore.getState().load({ model: emptyModel(), layout: emptyLayout() });
  });

  it('moves the selected nodes as one undo step per call', () => {
    diagramStore.getState().apply([{ op: 'add_node', id: 'A' }], { A: { x: 10, y: 10 } });
    diagramStore.getState().select({ nodes: ['A'], edges: [] });
    const past = diagramStore.getState().past.length;

    expect(nudgeSelection('left', 10)).toBe(true);

    expect(diagramStore.getState().layout.nodes.A).toEqual({ x: 0, y: 10 });
    expect(diagramStore.getState().past).toHaveLength(past + 1);
    diagramStore.getState().undo();
    expect(diagramStore.getState().layout.nodes.A).toEqual({ x: 10, y: 10 });
  });

  it('does nothing without selected nodes', () => {
    const past = diagramStore.getState().past.length;
    expect(nudgeSelection('right', 1)).toBe(false);
    expect(diagramStore.getState().past).toHaveLength(past);
  });
});
