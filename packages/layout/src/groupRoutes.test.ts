import { applyOps, computeRects, emptyModel, groupTitleBox } from '@strukt/core';
import type { DiagramModel, DiagramOp, GroupEl, Rect } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { createEraserRouter } from './eraserRouter';
import { groupCompositionRoutes } from './groupRoutes';
import type { Point } from './route';

function scene(prefix = '') {
  const id = (value: string) => prefix + value;
  const ops: DiagramOp[] = [
    { op: 'add_group', id: id('left'), label: 'Entrada' },
    { op: 'add_group', id: id('right'), label: 'Serviços' },
    { op: 'add_node', id: id('A'), parentId: id('left'), presentation: 'card' },
    { op: 'add_node', id: id('C'), parentId: id('left'), presentation: 'card' },
    { op: 'add_node', id: id('B'), parentId: id('right'), presentation: 'card' },
    { op: 'connect', from: id('A'), to: id('B') },
  ];
  const applied = applyOps(emptyModel(), ops);
  if (!applied.ok) throw new Error(applied.error.message);
  const model = applied.model;
  const rects = computeRects(model, { nodes: { [id('A')]: { x: 28, y: 44, w: 272, h: 88 }, [id('C')]: { x: 28, y: 150, w: 272, h: 88 }, [id('B')]: { x: 428, y: 44, w: 272, h: 88 } }, edges: {} });
  return { model, rects, edge: model.edges[0]!, id };
}

function intersects(a: Point, b: Point, r: Rect) {
  return Math.min(a[0], b[0]) < r.x + r.w && Math.max(a[0], b[0]) > r.x && Math.min(a[1], b[1]) < r.y + r.h && Math.max(a[1], b[1]) > r.y;
}

function clear(model: DiagramModel, rects: Record<string, Rect>, points: Point[]) {
  return model.order.every((id) => {
    const rect = model.elements[id]!.kind === 'group' ? groupTitleBox(model.elements[id] as GroupEl, rects[id]!) : rects[id]!;
    return points.slice(1).every((point, index) => !intersects(points[index]!, point, rect));
  });
}

const detour: Point[] = [[300, 88], [350, 88], [350, 72], [428, 72]];

describe('compact group routes', () => {
  it('shortens an unobstructed same-level connection to a straight route', () => {
    const { model, rects, edge } = scene();
    const points = groupCompositionRoutes(model, rects, { [edge.id]: detour })[edge.id]!;
    expect(points).toEqual([[300, 88], [428, 88]]);
    expect(clear(model, rects, points)).toBe(true);
  });

  it('preserves already straight generic routes', () => {
    const { model, rects, edge } = scene();
    expect(groupCompositionRoutes(model, rects, { [edge.id]: [[300, 88], [428, 88]] })).toEqual({});
  });

  it('separates coincident arrivals using a free slot on the same card', () => {
    const { model, rects, edge } = scene();
    const added = applyOps(model, [{ op: 'connect', from: 'C', to: 'B' }]);
    if (!added.ok) throw new Error(added.error.message);
    const second = added.model.edges[1]!;
    const routes = groupCompositionRoutes(added.model, rects, {
      [edge.id]: [[300, 88], [428, 88]],
      [second.id]: [[300, 194], [350, 194], [350, 88], [428, 88]],
    });
    expect(routes[edge.id]).toHaveLength(2);
    expect(routes[edge.id]![0]![1]).not.toBe(88);
    for (const points of Object.values(routes)) expect(clear(added.model, rects, points)).toBe(true);
  });

  it('repairs a fallback that ignored explicitly chosen top ports', () => {
    const { model, rects, edge } = scene();
    edge.fromPort = edge.toPort = 'top';
    const points = groupCompositionRoutes(model, rects, { [edge.id]: [[300, 88], [428, 88]] })[edge.id]!;
    expect(points[0]![1]).toBe(44);
    expect(points[1]![1]).toBeLessThan(44);
    expect(points.at(-1)![1]).toBe(44);
    expect(points.at(-2)![1]).toBeLessThan(44);
    expect(clear(model, rects, points)).toBe(true);
  });

  it('attaches group endpoints beside the header instead of crossing their children', () => {
    const { model, rects } = scene();
    const added = applyOps(model, [{ op: 'connect', from: 'C', to: 'right' }]);
    if (!added.ok) throw new Error(added.error.message);
    const edge = added.model.edges[1]!;
    const points = groupCompositionRoutes(added.model, rects)[edge.id]!;
    expect(points.at(-1)).toEqual([rects.right!.x, rects.right!.y + 36]);
    expect(clear(added.model, rects, points)).toBe(true);
  });

  it('leaves a route to the generic router if shortcuts would enter a card', () => {
    const { model, rects, edge } = scene();
    const added = applyOps(model, [{ op: 'add_node', id: 'Wall', presentation: 'card' }]);
    if (!added.ok) throw new Error(added.error.message);
    rects.Wall = { x: 320, y: -80, w: 80, h: 400 };
    expect(groupCompositionRoutes(added.model, rects)[edge.id]).toBeUndefined();
  });

  it('does not depend on component or domain names', () => {
    const one = scene(), two = scene('Renamed ');
    const a = groupCompositionRoutes(one.model, one.rects, { [one.edge.id]: detour })[one.edge.id];
    const b = groupCompositionRoutes(two.model, two.rects, { [two.edge.id]: detour })[two.edge.id];
    expect(a).toEqual(b);
  });

  it.each(['table', 'participant'] as const)('leaves %s scenes unchanged', (presentation) => {
    const { model, rects } = scene();
    model.elements.C!.presentation = presentation;
    expect(groupCompositionRoutes(model, rects)).toEqual({});
  });

  it('leaves shaped and manually staggered scenes unchanged', () => {
    const { model, rects } = scene();
    if (model.elements.C?.kind === 'node') model.elements.C.shape = 'diamond';
    expect(groupCompositionRoutes(model, rects)).toEqual({});
    if (model.elements.C?.kind === 'node') delete model.elements.C.shape;
    rects.C!.x += 20;
    expect(groupCompositionRoutes(model, rects)).toEqual({});
  });

  it('uses safe compact shortcuts when the corridor batch reports fallback', () => {
    const { model, rects, edge } = scene();
    const router = createEraserRouter(() => [{ connectionId: edge.id, status: 'fallback' }]);
    const points = router.route(model, rects)[edge.id]!;
    expect(points).toHaveLength(2);
    expect(clear(model, rects, points)).toBe(true);
  });
});
