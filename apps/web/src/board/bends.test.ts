import { applyOps, computeRects, emptyModel } from '@strukt/core';
import { routeKey } from '@strukt/layout';
import { describe, expect, it } from 'vitest';
import { withBends } from './bends';
import { connectionRoute } from './connectionPath';

describe('withBends', () => {
  const r = applyOps(emptyModel(), [
    { op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }, { op: 'add_node', id: 'C' },
    { op: 'connect', from: 'A', to: 'B', label: 'usa' }, { op: 'connect', from: 'A', to: 'C' },
  ]);
  if (!r.ok) throw new Error(r.error.message);
  const model = r.model;
  const rects = computeRects(model, { nodes: { A: { x: 0, y: 0, w: 200, h: 100 }, B: { x: 500, y: 300, w: 200, h: 100 }, C: { x: 500, y: -300, w: 200, h: 100 } }, edges: {} });
  const routed = { 'A→B': { points: [[200, 50], [500, 350]] as [number, number][], key: 'router' }, 'A→C': { points: [[200, 50], [500, -250]] as [number, number][], key: 'router' } };

  it('draws a bent connection as the manual elbow, its label on the middle run; the others keep their route', () => {
    const out = withBends(routed, model, rects, (id) => (id === 'A→B' ? 0.2 : undefined));
    const elbow = connectionRoute(rects.A!, rects.B!, 0.2);
    expect(out['A→B']!.key).toBe(routeKey(rects.A!, rects.B!));
    expect(out['A→B']!.label).toEqual(elbow.handle);
    expect(out['A→B']!.points.length).toBeGreaterThanOrEqual(3);
    expect(out['A→C']).toBe(routed['A→C']);
  });
});
