import { applyOps, emptyModel, semanticView } from '@strukt/core';
import type { DiagramModel, DiagramOp } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { deserializeDiagram, parseLayout, printLayout, serializeDiagram, snapshotFromDsl } from './diagram';

function model(ops: DiagramOp[]): DiagramModel {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

const shop = model([
  { op: 'add_group', id: 'Serviços', color: 'purple' },
  { op: 'add_node', id: 'API Gateway', icon: 'nginx' },
  { op: 'add_node', id: 'Pedidos', parentId: 'Serviços', tech: 'Node.js' },
  { op: 'update', id: 'Pedidos', set: { link: 'doc:pedidos' } },
  { op: 'connect', from: 'API Gateway', to: 'Pedidos', label: 'HTTPS' },
]);

describe('printLayout', () => {
  it('keeps positions of existing elements only, rounded, with sorted keys', () => {
    const text = printLayout(shop, {
      nodes: { Pedidos: { x: 600.4, y: 80.6 }, 'API Gateway': { x: 330, y: 160, w: 180.2, h: 64 }, Fantasma: { x: 1, y: 1 } },
      edges: { 'API Gateway→Pedidos': { points: [[0, 0]] } },
    });
    expect(text).toBe(
      '{\n  "nodes": {\n    "API Gateway": {\n      "h": 64,\n      "w": 180,\n      "x": 330,\n      "y": 160\n    },\n' +
        '    "Pedidos": {\n      "x": 600,\n      "y": 81\n    }\n  },\n  "version": 1\n}\n',
    );
  });
});

describe('parseLayout', () => {
  it('reads positions and ignores anything that is not a finite box', () => {
    const text = JSON.stringify({ version: 1, nodes: { A: { x: 1, y: 2, w: 3 }, B: { x: 'no', y: 1 }, C: null } });
    expect(parseLayout(text)).toEqual({ A: { x: 1, y: 2, w: 3 } });
  });

  it('never lets ids from the file reach a prototype', () => {
    const nodes = parseLayout('{"nodes":{"__proto__":{"x":1,"y":1},"constructor":{"x":2,"y":2}}}');
    expect(Object.keys(nodes)).toEqual(['constructor']);
    expect(Object.getPrototypeOf(nodes)).toBe(Object.prototype);
    expect(printLayout(shop, { nodes, edges: {} })).not.toContain('constructor');
  });

  it('treats a missing or broken file as "no positions"', () => {
    expect(parseLayout(null)).toEqual({});
    expect(parseLayout('{oops')).toEqual({});
  });
});

describe('diagram files', () => {
  it('round-trips model and positions through the JSON and the sidecar', () => {
    const layout = { nodes: { 'API Gateway': { x: 330, y: 160 }, Pedidos: { x: 600, y: 80 } }, edges: {} };
    const files = serializeDiagram({ model: shop, layout });
    expect(files.json).toContain('"id": "Pedidos"');
    expect(files.json).toContain('"link": "doc:pedidos"');
    expect(files.json).toContain('"children"');
    const { snapshot, diagnostics } = deserializeDiagram(files.json, files.layout);
    expect(diagnostics).toEqual([]);
    expect(semanticView(snapshot.model)).toEqual(semanticView(shop));
    expect(snapshot.layout).toEqual(layout);
    expect(Object.values(snapshot.model.elements).some((el) => el.span)).toBe(false);
    expect(snapshot.model.edges.every((edge) => !edge.span)).toBe(true);
  });

  it('loads a missing diagram file as an empty diagram', () => {
    const { snapshot, diagnostics } = deserializeDiagram(null, null);
    expect(snapshot.model.order).toEqual([]);
    expect(snapshot.layout).toEqual({ nodes: {}, edges: {} });
    expect(diagnostics).toEqual([]);
  });

  it('reports JSON errors and keeps what could be read', () => {
    const { snapshot, diagnostics } = deserializeDiagram('{\n  "version": 1,\n  "nodes": [}\n}', null);
    expect(diagnostics.some((d) => d.severity === 'error')).toBe(true);
    expect(snapshot.model.order).toEqual([]);
  });

  it('snapshotFromDsl reads the legacy format for the migration', () => {
    const { snapshot, diagnostics } = snapshotFromDsl('A > B\nC [shape: \n', '{"version":1,"nodes":{"A":{"x":10,"y":20}}}');
    expect(diagnostics.some((d) => d.severity === 'error')).toBe(true);
    expect(snapshot.model.elements.A).toBeDefined();
    expect(snapshot.layout.nodes).toEqual({ A: { x: 10, y: 20 } });
    expect(snapshot.model.diagnostics).toEqual([]);
  });
});
