import { applyOps, computeRects, emptyModel } from '@strukt/core';
import { cachedRoute } from '@strukt/layout';
import { describe, expect, it } from 'vitest';
import { previewRoute } from './preview';

describe('previewRoute (the connection being dragged)', () => {
  const result = applyOps(emptyModel(), [{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }, { op: 'connect', from: 'A', to: 'B' }]);
  if (!result.ok) throw new Error(result.error.message);
  const { model } = result;
  const rects = computeRects(model, { nodes: { A: { x: 0, y: 300 }, B: { x: 0, y: 0 } }, edges: {} });

  it('over a target, is the very line the new edge is first drawn with', () => {
    expect(previewRoute(rects.A!, rects.B!)).toEqual(cachedRoute({}, model.edges[0]!, rects.A!, rects.B!, model));
  });

  it('draws nothing while the pointer is still over the source', () => {
    expect(previewRoute(rects.A!, [rects.A!.x + 5, rects.A!.y + 5])).toEqual([]);
  });

  it('goes straight out while the pointer is level with the source', () => {
    expect(previewRoute(rects.A!, [40, 120])).toEqual([[40, rects.A!.y], [40, 120]]);
    expect(previewRoute(rects.A!, [500, rects.A!.y + 10])).toEqual([[rects.A!.x + rects.A!.w, rects.A!.y + 10], [500, rects.A!.y + 10]]);
  });

  it('elsewhere, leaves the source border toward the pointer', () => {
    const points = previewRoute(rects.A!, [500, 100]);
    expect(points[0]![0]).toBe(rects.A!.x + rects.A!.w);
    expect(points.at(-1)).toEqual([500, 100]);
  });
});
