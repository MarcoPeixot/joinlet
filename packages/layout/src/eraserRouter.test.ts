import { ICON_LABEL, applyOps, computeRects, emptyModel, groupTitleBox, visualBox } from '@strukt/core';
import type { DiagramModel, DiagramOp, Rect } from '@strukt/core';
import { describe, expect, it, vi } from 'vitest';
import { createEraserRouter, eraserRouter } from './eraserRouter';
import { routeOrthogonal } from './route';
import type { Point } from './route';

function build(ops: DiagramOp[]): DiagramModel {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

/** True when an axis-aligned segment enters the rect's interior. */
function crosses([ax, ay]: Point, [bx, by]: Point, r: Rect): boolean {
  const [x1, x2] = [Math.min(ax, bx), Math.max(ax, bx)];
  const [y1, y2] = [Math.min(ay, by), Math.max(ay, by)];
  return x1 < r.x + r.w && x2 > r.x && y1 < r.y + r.h && y2 > r.y;
}

const pair = build([
  { op: 'add_node', id: 'A' },
  { op: 'add_node', id: 'B' },
  { op: 'connect', from: 'A', to: 'B' },
]);

describe('eraserRouter', () => {
  it('keeps a connection clear of a container title', () => {
    const m = build([{ op: 'add_group', id: 'Dados', label: 'Dados e transporte' }, { op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }, { op: 'connect', from: 'A', to: 'B' }]);
    const rects = { Dados: { x: 160, y: 20, w: 320, h: 200 }, A: { x: 0, y: 10, w: 56, h: 56 }, B: { x: 600, y: 10, w: 56, h: 56 } };
    const title = groupTitleBox(m.elements.Dados as never, rects.Dados);
    const route = eraserRouter.route(m, rects)['A→B']!;
    expect(route.slice(1).some((point, index) => crosses(route[index]!, point, title))).toBe(false);
  });
  it('draws a straight line between aligned nodes', () => {
    const rects = { A: { x: 0, y: 0, w: 100, h: 50 }, B: { x: 300, y: 0, w: 100, h: 50 } };
    expect(eraserRouter.route(pair, rects)).toEqual({ 'A→B': [[100, 25], [300, 25]] });
  });

  it('routes around a node in the way', () => {
    const m = build([
      { op: 'add_node', id: 'A' },
      { op: 'add_node', id: 'Wall' },
      { op: 'add_node', id: 'B' },
      { op: 'connect', from: 'A', to: 'B' },
    ]);
    const rects = { A: { x: 0, y: 0, w: 100, h: 50 }, Wall: { x: 200, y: -40, w: 60, h: 130 }, B: { x: 400, y: 0, w: 100, h: 50 } };
    const points = eraserRouter.route(m, rects)['A→B']!;
    expect(points[0]![0]).toBe(100);
    expect(points[points.length - 1]![0]).toBe(400);
    for (let i = 1; i < points.length; i++) expect(crosses(points[i - 1]!, points[i]!, rects.Wall)).toBe(false);
  });

  it('routes edges to groups and nested nodes', () => {
    const m = build([
      { op: 'add_node', id: 'Client' },
      { op: 'add_group', id: 'VPC' },
      { op: 'add_node', id: 'API', parentId: 'VPC' },
      { op: 'add_node', id: 'DB', parentId: 'VPC', shape: 'cylinder' },
      { op: 'connect', from: 'Client', to: 'API' },
      { op: 'connect', from: 'API', to: 'DB' },
      { op: 'connect', from: 'DB', to: 'Client', connector: '<>' },
      { op: 'connect', from: 'Client', to: 'VPC', connector: '--' },
    ]);
    const rects = computeRects(m, { nodes: { Client: { x: 0, y: 100 }, API: { x: 300, y: 100 }, DB: { x: 560, y: 90 } }, edges: {} });
    const routes = eraserRouter.route(m, rects);
    expect(Object.keys(routes)).toEqual(['Client→API', 'API→DB', 'DB→Client', 'Client→VPC']);
    for (const points of Object.values(routes)) expect(points.length).toBeGreaterThanOrEqual(2);
  });

  describe('icon nodes (the name is drawn under the icon)', () => {
    it('routes around the icon and its label, not only the icon', () => {
      const m = build([
        { op: 'add_node', id: 'A' },
        { op: 'add_node', id: 'Mid', icon: 'redis' },
        { op: 'add_node', id: 'B' },
        { op: 'connect', from: 'A', to: 'B' },
      ]);
      // The straight line A → B (y = 132) misses the icon (y 60..116) but runs through its label (y 116..152).
      const rects = computeRects(m, { nodes: { A: { x: 0, y: 100 }, Mid: { x: 300, y: 60 }, B: { x: 600, y: 100 } }, edges: {} });
      const label = visualBox(m.elements.Mid!, rects.Mid!);
      const points = eraserRouter.route(m, rects)['A→B']!;
      for (let i = 1; i < points.length; i++) expect(crosses(points[i - 1]!, points[i]!, label)).toBe(false);
    });

    it('attaches side connections to the icon itself and ends a connection from below under the label', () => {
      const m = build([
        { op: 'add_node', id: 'Left' },
        { op: 'add_node', id: 'Icon', icon: 'redis' },
        { op: 'add_node', id: 'Below' },
        { op: 'connect', from: 'Left', to: 'Icon' },
        { op: 'connect', from: 'Below', to: 'Icon' },
      ]);
      const rects = computeRects(m, { nodes: { Left: { x: 0, y: 4 }, Icon: { x: 400, y: 0 }, Below: { x: 348, y: 300 } }, edges: {} });
      const routes = eraserRouter.route(m, rects);
      expect(routes['Left→Icon']!.at(-1)![0]).toBe(400);
      expect(routes['Below→Icon']!.at(-1)![1]).toBe(56 + ICON_LABEL.height);
    });
  });

  it('skips edges whose endpoints are not positioned', () => {
    expect(eraserRouter.route(pair, { A: { x: 0, y: 0, w: 100, h: 50 } })).toEqual({});
  });

  it('falls back to routeOrthogonal per edge on "fallback" or when the router throws', () => {
    const rects = { A: { x: 0, y: 0, w: 100, h: 50 }, B: { x: 300, y: 200, w: 100, h: 50 } };
    const expected = { 'A→B': routeOrthogonal(rects.A, rects.B).points };
    const fallback = createEraserRouter(() => [{ connectionId: 'A→B', status: 'fallback' }]);
    expect(fallback.route(pair, rects)).toEqual(expected);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const crashing = createEraserRouter(() => {
      throw new Error('boom');
    });
    expect(crashing.route(pair, rects)).toEqual(expected);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe('Falha ao rotear com @eraserlabs/layout; usando roteamento ortogonal.');
    warn.mockRestore();
  });

  it('warns once and falls back for every edge in the batch when the router throws', () => {
    const m = build([
      { op: 'add_node', id: 'A' },
      { op: 'add_node', id: 'B' },
      { op: 'add_node', id: 'C' },
      { op: 'connect', from: 'A', to: 'B' },
      { op: 'connect', from: 'B', to: 'C' },
    ]);
    const rects = { A: { x: 0, y: 0, w: 100, h: 50 }, B: { x: 300, y: 0, w: 100, h: 50 }, C: { x: 600, y: 0, w: 100, h: 50 } };
    const expected = {
      'A→B': routeOrthogonal(rects.A, rects.B).points,
      'B→C': routeOrthogonal(rects.B, rects.C).points,
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const crashing = createEraserRouter(() => {
      throw new Error('boom');
    });
    expect(crashing.route(m, rects)).toEqual(expected);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe('Falha ao rotear com @eraserlabs/layout; usando roteamento ortogonal.');
    warn.mockRestore();
  });
});
