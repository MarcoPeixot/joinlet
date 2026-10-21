import { applyOps, computeRects, intersects, semanticView, unionRect, visualBox } from '@strukt/core';
import type { DiagramOp } from '@strukt/core';
import { expect, it } from 'vitest';
import { autoLayout, runElk } from './elk';
import { compositionOps } from './composition';
import { nestedCompositionLayout } from './nestedComposition';
import { streamingFixture } from './nestedComposition.fixture';

it.each(['icon', 'card'] as const)('composes all levels inside one outer boundary with %s nodes', async presentation => {
  const model = streamingFixture(presentation), before = semanticView(model);
  const nodes = await autoLayout(model), rects = computeRects(model, { nodes, edges: {} });
  expect(semanticView(model)).toEqual(before);
  expect(Object.keys(nodes)).toHaveLength(10);
  expect(await autoLayout(model)).toEqual(nodes);
  for (const id of model.order) {
    const el = model.elements[id]!;
    const parent = el.parentId && rects[el.parentId];
    if (parent) {
      const box = visualBox(el, rects[id]!);
      expect(box.x).toBeGreaterThanOrEqual(parent.x + 28);
      expect(box.y).toBeGreaterThanOrEqual(parent.y + 44);
      expect(box.x + box.w).toBeLessThanOrEqual(parent.x + parent.w - 28);
      expect(box.y + box.h).toBeLessThanOrEqual(parent.y + parent.h - 28);
    }
    for (const other of model.order) if (other !== id && model.elements[other]!.parentId === el.parentId) expect(intersects(visualBox(el, rects[id]!), visualBox(model.elements[other]!, rects[other]!)), `${id}/${other}`).toBe(false);
  }
  expect(rects.Viewers!.x + rects.Viewers!.w).toBeLessThan(rects.CloudFront!.x);
  expect(rects.CloudFront!.x + rects.CloudFront!.w).toBeLessThan(rects.Gateway!.x);
  expect(rects.Gateway!.x + rects.Gateway!.w).toBeLessThan(rects.Playback!.x);
  expect(Math.abs(rects.Viewers!.y + rects.Viewers!.h / 2 - rects.CloudFront!.y - rects.CloudFront!.h / 2)).toBeLessThan(2);
  const bounds = unionRect(model.order.map(id => visualBox(model.elements[id]!, rects[id]!)))!;
  expect(bounds.w).toBeLessThan(presentation === 'icon' ? 2400 : 3400);
  expect(bounds.h).toBeLessThan(1500);
});

it('keeps icon presentation when explicitly composing architecture', () => {
  const model = streamingFixture();
  const result = applyOps(model, compositionOps(model));
  expect(result.ok).toBe(true); if (!result.ok) return;
  expect(result.model.edges).toEqual(model.edges);
  for (const id of model.order) if (model.elements[id]!.kind === 'node') expect(result.model.elements[id]!.presentation).toBe('icon');
});

it('preserves saved dimensions, empty boundaries, group endpoints, cycles and arbitrary IDs', async () => {
  const model = streamingFixture('card');
  const result = applyOps(model, [
    { op: 'rename', id: 'Cloud', to: 'constructor' }, { op: 'rename', id: 'Subnet', to: 'toString' },
    { op: 'add_group', id: 'Empty', parentId: 'Region' },
    { op: 'connect', from: 'Cache', to: 'Playback' },
    { op: 'connect', from: 'Gateway', to: 'VPC' },
  ] as DiagramOp[]);
  if (!result.ok) throw Error(result.error.message);
  const sizes = { Playback: { w: 360, h: 180 }, Empty: { w: 400, h: 240 } };
  const nodes = await autoLayout(result.model, sizes, 'left', { x: 80, y: 90 });
  expect(nodes.Playback).toMatchObject(sizes.Playback);
  expect(nodes.Empty).toMatchObject(sizes.Empty);
  expect(nodes.Viewers!.x).toBeGreaterThan(nodes.CloudFront!.x);
  expect(Math.min(...Object.values(nodes).map(box => box.x))).toBeGreaterThanOrEqual(80);
  expect(Math.min(...Object.values(nodes).map(box => box.y))).toBeGreaterThanOrEqual(90);
  expect(result.model.elements['toString']!.parentId).toBe('VPC');
});

it('supports vertical directions and falls back for tables or explicit shapes', async () => {
  const model = streamingFixture();
  for (const direction of ['down', 'up'] as const) {
    const nodes = await autoLayout(model, {}, direction);
    expect(direction === 'down' ? nodes.Gateway!.y < nodes.Playback!.y : nodes.Gateway!.y > nodes.Playback!.y).toBe(true);
  }
  const result = applyOps(model, [{ op: 'update', id: 'Playback', set: { presentation: 'table', fields: [{ name: 'id', key: 'PK' }] } }]);
  if (!result.ok) throw Error(result.error.message);
  expect(await nestedCompositionLayout(result.model, {}, 'right', { x: 0, y: 0 }, runElk)).toBeUndefined();
});

it('routes the composed streaming graph without crossing unrelated component bodies', async () => {
  const { eraserRouter } = await import('./eraserRouter');
  const model = streamingFixture(), nodes = await autoLayout(model);
  const rects = computeRects(model, { nodes, edges: {} });
  const routes = eraserRouter.route(model, rects);
  for (const edge of model.edges) {
    const route = routes[edge.id]!;
    expect(route.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1]!, b = route[i]!;
      for (const id of model.order.filter(id => model.elements[id]!.kind === 'node' && id !== edge.from && id !== edge.to)) {
        const r = rects[id]!;
        const crosses = Math.min(a[0], b[0]) < r.x + r.w - 1 && Math.max(a[0], b[0]) > r.x + 1 && Math.min(a[1], b[1]) < r.y + r.h - 1 && Math.max(a[1], b[1]) > r.y + 1;
        expect(crosses, `${edge.id} through ${id}`).toBe(false);
      }
    }
  }
});
