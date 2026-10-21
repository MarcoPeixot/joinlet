import { computeRects } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { exampleSnapshot } from './example';

describe('example diagram', () => {
  it('builds a valid, fully positioned architecture', () => {
    const { model, layout } = exampleSnapshot();
    expect(model.order.length).toBeGreaterThanOrEqual(10);
    expect(model.edges.length).toBeGreaterThanOrEqual(8);
    for (const id of model.order) {
      if (model.elements[id]?.kind === 'node') expect(layout.nodes[id], id).toBeDefined();
    }
    const rects = computeRects(model, layout);
    expect(rects.Frontend!.x + rects.Frontend!.w).toBeLessThan(rects['API Gateway']!.x);
  });
});
