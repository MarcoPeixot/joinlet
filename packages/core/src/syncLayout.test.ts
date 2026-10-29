import { describe, expect, it } from 'vitest';
import { applyOps } from './applyOps';
import { emptyModel } from './model';
import type { DiagramModel, DiagramOp, EdgeRoute } from './model';
import { carryRoutes } from './syncLayout';

function run(model: DiagramModel, ops: DiagramOp[]) {
  const r = applyOps(model, ops);
  if (!r.ok) throw new Error(r.error.message);
  return r;
}

const route = (key: string): EdgeRoute => ({ points: [[0, 0], [1, 1]], key });

describe('carryRoutes', () => {
  const base = run(emptyModel(), [
    { op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }, { op: 'add_node', id: 'C' },
    { op: 'connect', from: 'A', to: 'B' }, { op: 'connect', from: 'A', to: 'B' }, { op: 'connect', from: 'B', to: 'C', label: 'x' },
  ]).model;
  const routes = { 'A→B': route('first'), 'A→B#2': route('second'), 'B→C': route('third') };

  it('keeps every untouched route when a connection is added', () => {
    const next = run(base, [{ op: 'connect', from: 'C', to: 'A' }]);
    expect(carryRoutes(routes, base, next.model, next.edgeIds)).toEqual(routes);
  });

  it('follows renumbered ids when a connection is removed', () => {
    const next = run(base, [{ op: 'remove_edge', edgeId: 'A→B' }]);
    expect(carryRoutes(routes, base, next.model, next.edgeIds)).toEqual({ 'A→B': route('second'), 'B→C': route('third') });
  });

  it('follows renamed ends', () => {
    const next = run(base, [{ op: 'rename', id: 'C', to: 'D' }]);
    expect(carryRoutes(routes, base, next.model, next.edgeIds)['B→D']).toEqual(route('third'));
  });

  it('keeps the route of an edge whose type, color, label or ports changed (the router redraws it after)', () => {
    const next = run(base, [
      { op: 'update_edge', edgeId: 'B→C', set: { label: 'y', color: 'red', connector: '<>' } },
      { op: 'update_edge', edgeId: 'A→B#2', set: { fromPort: 'top' } },
    ]);
    expect(carryRoutes(routes, base, next.model, next.edgeIds)).toEqual(routes);
  });

  it('matches by id without a mapping (undo/redo)', () => {
    const undone = run(base, [{ op: 'remove_edge', edgeId: 'B→C' }]).model;
    expect(carryRoutes(routes, base, undone)).toEqual({ 'A→B': route('first'), 'A→B#2': route('second') });
  });
});
