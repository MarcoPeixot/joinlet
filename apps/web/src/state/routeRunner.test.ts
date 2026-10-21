import { emptyModel } from '@strukt/core';
import type { DiagramModel, Rect } from '@strukt/core';
import type { EdgeRouter } from '@strukt/layout';
import { describe, expect, it, vi } from 'vitest';
import { loadEraserRouter } from './eraserRouter';
import { createRouteRunner, ORTHOGONAL_THRESHOLD } from './routeRunner';

function chain(edges: number): { model: DiagramModel; rects: Record<string, Rect> } {
  const model = emptyModel();
  const rects: Record<string, Rect> = {};
  for (let i = 0; i <= edges; i++) {
    const id = `n${i}`;
    model.elements[id] = { id, kind: 'node' } as never;
    model.order.push(id);
    rects[id] = { x: i * 200, y: 0, w: 100, h: 60 };
    if (i) model.edges.push({ id: `n${i - 1}→${id}`, from: `n${i - 1}`, to: id } as never);
  }
  return { model, rects };
}

describe('createRouteRunner (no Worker in this environment: synchronous fallback)', () => {
  it('routes with the given router and resolves asynchronously', async () => {
    const route = vi.fn<EdgeRouter['route']>((model) => Object.fromEntries(model.edges.map((e) => [e.id, [[9, 9], [8, 8]] as [number, number][]])));
    const { model, rects } = chain(3);
    const edges = await createRouteRunner({ route })(model, rects);
    expect(route).toHaveBeenCalledTimes(1);
    expect(edges['n0→n1']?.points).toEqual([[9, 9], [8, 8]]);
  });

  it('switches to the orthogonal router above the edge threshold', async () => {
    const route = vi.fn<EdgeRouter['route']>(() => ({}));
    const runner = createRouteRunner({ route });
    const small = chain(ORTHOGONAL_THRESHOLD);
    await runner(small.model, small.rects);
    expect(route).toHaveBeenCalledTimes(1);
    const big = chain(ORTHOGONAL_THRESHOLD + 1);
    const edges = await runner(big.model, big.rects);
    expect(route).toHaveBeenCalledTimes(1);
    expect(Object.keys(edges)).toHaveLength(ORTHOGONAL_THRESHOLD + 1);
  });

  it('loads the eraser router on demand when none is given (the initial bundle does not carry it)', async () => {
    const eraser = await loadEraserRouter();
    expect(await loadEraserRouter()).toBe(eraser);
    const route = vi.spyOn(eraser, 'route').mockReturnValue({});
    const { model, rects } = chain(2);
    const edges = await createRouteRunner()(model, rects);
    expect(route).toHaveBeenCalledTimes(1);
    expect(edges).toEqual({});
    route.mockRestore();
  });
});
