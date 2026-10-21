import { applyOps, emptyLayout, emptyModel } from '@strukt/core';
import type { DiagramModel, DiagramOp } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { planSnapshot } from './plan';

function model(ops: DiagramOp[]): DiagramModel {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

const base = model([{ op: 'add_node', id: 'API' }, { op: 'add_node', id: 'DB', shape: 'cylinder' }, { op: 'connect', from: 'API', to: 'DB' }]);
const placed = { nodes: { API: { x: 0, y: 0 }, DB: { x: 300, y: 0 } }, edges: {} };

describe('planSnapshot', () => {
  it('applies the batch and places a new node next to its connected neighbor', () => {
    const result = planSnapshot(base, placed, [
      { op: 'add_node', id: 'Cache' },
      { op: 'connect', from: 'DB', to: 'Cache' },
    ]);
    if (!result.ok) throw new Error(result.error);
    expect(result.planned.model.order).toEqual(['API', 'DB', 'Cache']);
    expect(result.planned.positions.Cache).toEqual({ x: 500, y: 12 });
    expect(result.planned.layout.nodes.Cache).toEqual({ x: 500, y: 12 });
    expect(result.planned.autoLayout).toBe(false);
  });

  it('flags autoLayout when nothing kept has a position', () => {
    const result = planSnapshot(emptyModel(), emptyLayout(), [{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }, { op: 'connect', from: 'A', to: 'B' }]);
    if (!result.ok) throw new Error(result.error);
    expect(result.planned.autoLayout).toBe(true);
  });

  it('returns the applyOps error and plans nothing', () => {
    expect(planSnapshot(base, placed, [{ op: 'remove', id: 'Nada' }])).toEqual({ ok: false, error: 'Elemento "Nada" não existe.' });
  });
});
