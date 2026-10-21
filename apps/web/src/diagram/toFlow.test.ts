import { applyOps, emptyModel } from '@strukt/core';
import type { DiagramOp } from '@strukt/core';
import { routeKey } from '@strukt/layout';
import { describe, expect, it } from 'vitest';
import { EDGE_Z, NODE_Z, toFlow } from './toFlow';

function model(ops: DiagramOp[]) {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

describe('toFlow', () => {
  it('projects tables and participants and ignores stale route cache for sequence messages', () => {
    const m = model([{ op: 'add_node', id: 'Client', presentation: 'participant' }, { op: 'add_node', id: 'API', presentation: 'participant' }, { op: 'add_node', id: 'Users', presentation: 'table', fields: [{ name: 'id', key: 'PK' }] }, { op: 'connect', from: 'Client', to: 'API', label: 'Request' }, { op: 'connect', from: 'API', to: 'Client', label: 'Reply', connector: '-->' }]);
    const layout = { nodes: { Client: { x: 0, y: 0 }, API: { x: 350, y: 0 }, Users: { x: 700, y: 0 } }, edges: {} };
    const first = toFlow(m, layout, { nodes: [], edges: [] }, 'light');
    expect(first.nodes.find(node => node.id === 'Users')!.type).toBe('table');
    expect(first.nodes.find(node => node.id === 'API')!.type).toBe('participant');
    const moved = toFlow(m, { ...layout, nodes: { ...layout.nodes, API: { x: 400, y: 80 } } }, { nodes: [], edges: [] }, 'light');
    for (const edge of moved.edges) {
      expect(edge.data!.points[0]![1]).toBe(edge.data!.points[1]![1]);
      expect(edge.data!.labelAt![1]).toBeLessThan(edge.data!.points[0]![1]);
    }
    const reordered = applyOps(m, [{ op: 'reorder', edges: [1, 0] }]);
    if (!reordered.ok) throw new Error(reordered.error.message);
    expect(toFlow(reordered.model, layout, { nodes: [], edges: [] }, 'light').edges[0]!.data!.sequenceOrder).toBe(1);
  });
  const m = model([
    { op: 'add_node', id: 'Client', icon: 'user' },
    { op: 'add_group', id: 'VPC', color: 'blue' },
    { op: 'add_node', id: 'API', parentId: 'VPC' },
    { op: 'connect', from: 'Client', to: 'API', label: 'HTTPS' },
  ]);
  const layout = { nodes: { Client: { x: 0, y: 0 }, API: { x: 300, y: 100 } }, edges: {} };

  it('orders parents before children with parent-relative positions', () => {
    const { nodes, rects } = toFlow(m, layout, { nodes: ['API'], edges: [] }, 'light');
    expect(nodes.map((n) => n.id)).toEqual(['VPC', 'Client', 'API']);
    const api = nodes.find((n) => n.id === 'API')!;
    expect(api).toMatchObject({ type: 'shape', parentId: 'VPC', selected: true, zIndex: NODE_Z });
    expect(api.position).toEqual({ x: 300 - rects.VPC!.x, y: 100 - rects.VPC!.y });
    expect(nodes.find((n) => n.id === 'Client')).toMatchObject({ type: 'icon', width: 56, height: 56 });
    expect(nodes.find((n) => n.id === 'VPC')).toMatchObject({ type: 'sgroup', zIndex: 0 });
  });

  it('gives every node an accessible name with its connection count', () => {
    const { nodes } = toFlow(m, layout, { nodes: [], edges: [] }, 'light');
    expect(nodes.find((n) => n.id === 'API')?.ariaLabel).toBe('Caixa API, 1 conexão');
    expect(nodes.find((n) => n.id === 'Client')?.ariaLabel).toBe('Ícone Client, 1 conexão');
    expect(nodes.find((n) => n.id === 'VPC')?.ariaLabel).toBe('Grupo VPC, 1 elemento');
  });

  it('names every edge in pt-BR and keeps it out of the Tab order', () => {
    const none = { nodes: [], edges: [] };
    const [edge] = toFlow(m, layout, none, 'light').edges;
    expect(edge).toMatchObject({ ariaLabel: 'Conexão de Client para API, HTTPS', focusable: false });
    // Renaming an endpoint renames the edge too (the cache must not hold on to the old name).
    const renamed = applyOps(m, [{ op: 'update', id: 'API', set: { label: 'Gateway' } }]);
    if (!renamed.ok) throw new Error(renamed.error.message);
    expect(toFlow(renamed.model, layout, none, 'light').edges[0]!.ariaLabel).toBe('Conexão de Client para Gateway, HTTPS');
  });

  it('inherits diagram style unless the element overrides it', () => {
    const { nodes } = toFlow(m, layout, { nodes: [], edges: [] }, 'dark');
    expect(nodes[0]?.data).toMatchObject({ colorMode: 'pastel', styleMode: 'shadow', typeface: 'clean', theme: 'dark' });
  });

  it('routes edges between element rects', () => {
    const { edges } = toFlow(m, layout, { nodes: [], edges: ['Client→API'] }, 'light');
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ id: 'Client→API', source: 'Client', target: 'API', type: 'strukt', zIndex: EDGE_Z, selected: true });
    expect(edges[0]!.data!.points.length).toBeGreaterThanOrEqual(2);
  });

  it('uses a cached route only while both endpoints stay put', () => {
    const none = { nodes: [], edges: [] };
    const { rects } = toFlow(m, layout, none, 'light');
    const points: [number, number][] = [[1, 1], [2, 2]];
    const cached = { ...layout, edges: { 'Client→API': { points, key: routeKey(rects.Client!, rects.API!) } } };
    expect(toFlow(m, cached, none, 'light').edges[0]!.data!.points).toEqual(points);
    const moved = { ...cached, nodes: { ...cached.nodes, API: { x: 320, y: 100 } } };
    expect(toFlow(m, moved, none, 'light').edges[0]!.data!.points).not.toEqual(points);
  });

  it('draws the label where it was placed while the cached route holds, halfway along until then', () => {
    const none = { nodes: [], edges: [] };
    const { rects } = toFlow(m, layout, none, 'light');
    const points: [number, number][] = [[0, 0], [0, 100], [300, 100]];
    const cached = { ...layout, edges: { 'Client→API': { points, key: routeKey(rects.Client!, rects.API!), label: [200, 100] as [number, number] } } };
    expect(toFlow(m, cached, none, 'light').edges[0]!.data!.labelAt).toEqual([200, 100]);
    const stale = { ...cached, edges: { 'Client→API': { points, key: routeKey(rects.Client!, rects.API!) } } };
    expect(toFlow(m, stale, none, 'light').edges[0]!.data!.labelAt).toEqual([100, 100]);
  });

  describe('reuse', () => {
    const none = { nodes: [], edges: [] };
    const base = () => model([
      { op: 'add_node', id: 'A' },
      { op: 'add_node', id: 'B' },
      { op: 'connect', from: 'A', to: 'B', label: 'x' },
    ]);
    const lay = { nodes: { A: { x: 0, y: 0 }, B: { x: 300, y: 0 } }, edges: {} };
    const node = (p: ReturnType<typeof toFlow>, id: string) => p.nodes.find((n) => n.id === id)!;

    it('returns the same objects when nothing changed', () => {
      const m0 = base();
      const first = toFlow(m0, lay, none, 'light');
      const second = toFlow(m0, { ...lay }, { nodes: [], edges: [] }, 'light');
      expect(second.nodes[0]).toBe(first.nodes[0]);
      expect(second.nodes[1]).toBe(first.nodes[1]);
      expect(second.edges[0]).toBe(first.edges[0]);
    });

    it('rebuilds only the node whose element changed', () => {
      const m0 = base();
      const first = toFlow(m0, lay, none, 'light');
      const r = applyOps(m0, [{ op: 'update', id: 'A', set: { label: 'Alpha' } }]);
      if (!r.ok) throw new Error(r.error.message);
      const second = toFlow(r.model, lay, none, 'light');
      expect(node(second, 'B')).toBe(node(first, 'B'));
      expect(node(second, 'A')).not.toBe(node(first, 'A'));
    });

    it('builds a new object for each input class that changes', () => {
      const m0 = base();
      const first = toFlow(m0, lay, none, 'light');
      const a = node(first, 'A');
      const moved = toFlow(m0, { ...lay, nodes: { ...lay.nodes, A: { x: 20, y: 0 } } }, none, 'light');
      expect(node(moved, 'A')).not.toBe(a);
      expect(node(moved, 'B')).toBe(node(first, 'B'));
      expect(node(toFlow(m0, lay, { nodes: ['A'], edges: [] }, 'light'), 'A')).not.toBe(a);
      expect(node(toFlow(m0, lay, none, 'dark'), 'A')).not.toBe(a);
      expect(node(toFlow(m0, lay, none, 'light', undefined, undefined, { A: [{}] }), 'A')).not.toBe(a);
      const focus = { origin: 'A', nodes: new Set(['A']), groups: new Set<string>(), edges: new Map(), calm: new Set<string>() };
      const focused = toFlow(m0, lay, none, 'light', undefined, focus as never);
      expect(node(focused, 'A')).not.toBe(a);
      expect(node(focused, 'B').className).toBe('sk-dim');
      const styled = applyOps(m0, [{ op: 'set_style', set: { colorMode: 'bold' } }]);
      if (!styled.ok) throw new Error(styled.error.message);
      expect(node(toFlow(styled.model, lay, none, 'light'), 'B')).not.toBe(node(first, 'B'));
    });

    it('rebuilds edges when route, label, selection, theme or edge change', () => {
      const m0 = base();
      const first = toFlow(m0, lay, none, 'light');
      const e = first.edges[0]!;
      expect(toFlow(m0, lay, { nodes: [], edges: [e.id] }, 'light').edges[0]).not.toBe(e);
      expect(toFlow(m0, lay, none, 'dark').edges[0]).not.toBe(e);
      const moved = toFlow(m0, { ...lay, nodes: { ...lay.nodes, B: { x: 400, y: 80 } } }, none, 'light');
      expect(moved.edges[0]).not.toBe(e);
      const r = applyOps(m0, [{ op: 'update_edge', edgeId: e.id, set: { label: 'y' } }]);
      if (!r.ok) throw new Error(r.error.message);
      expect(toFlow(r.model, lay, none, 'light').edges[0]).not.toBe(e);
    });

    it('drops entries for removed ids and handles hostile names', () => {
      const m1 = model([{ op: 'add_node', id: 'constructor' }, { op: 'add_node', id: 'toString' }]);
      const l1 = { nodes: { constructor: { x: 0, y: 0 }, toString: { x: 200, y: 0 } }, edges: {} };
      const first = toFlow(m1, l1, none, 'light');
      expect(toFlow(m1, l1, none, 'light').nodes[0]).toBe(first.nodes[0]);
      const other = toFlow(base(), lay, none, 'light');
      expect(other.nodes.map((n) => n.id)).toEqual(['A', 'B']);
      // 'constructor' was dropped: a fresh model with an equal element is a new object, never a stale one.
      const again = toFlow(m1, l1, none, 'light');
      expect(again.nodes[0]).not.toBe(first.nodes[0]);
      expect(again.nodes[0]!.data.el).toBe(first.nodes[0]!.data.el);
    });
  });
});
