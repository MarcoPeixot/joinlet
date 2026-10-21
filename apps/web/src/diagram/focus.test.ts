import { readFileSync } from 'node:fs';
import { applyOps, emptyModel } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_OPS } from '../samples/example';
import { DIM_OPACITY, breadcrumb, connections, neighborhood, reach, reachFocus, withPreview } from './focus';

const built = applyOps(emptyModel(), EXAMPLE_OPS);
if (!built.ok) throw new Error(built.error.message);
const model = built.model;
const sorted = (set: Iterable<string>) => [...set].sort();

describe('neighborhood (what a click on a node lights up)', () => {
  it('keeps the node, its direct neighbours and their groups; tells outgoing from incoming edges', () => {
    const focus = neighborhood(model, 'Pedidos');
    expect(sorted(focus.nodes)).toEqual(['API Gateway', 'Kafka', 'Pedidos', 'PostgreSQL', 'Redis']);
    expect(sorted(focus.groups)).toEqual(['Dados', 'Serviços']);
    expect(Object.fromEntries(focus.edges)).toEqual({
      'API Gateway→Pedidos': 'in',
      'Pedidos→PostgreSQL': 'out',
      'Pedidos→Redis': 'out',
      'Pedidos→Kafka': 'out',
    });
    expect(focus.calm.size).toBe(0);
  });

  it('for a group: its members stay lit, edges crossing its border pulse, inner edges stay calm', () => {
    const focus = neighborhood(model, 'Serviços');
    expect(sorted(focus.nodes)).toEqual(['API Gateway', 'Kafka', 'Pagamentos', 'Pedidos', 'PostgreSQL', 'Redis', 'Serviços']);
    expect(focus.edges.get('API Gateway→Pedidos')).toBe('in');
    expect(focus.edges.get('Kafka→Pagamentos')).toBe('in');
    expect(focus.edges.get('Pedidos→Redis')).toBe('out');
    expect(focus.edges.has('Web App→API Gateway')).toBe(false);
  });

  it('never resolves names from Object.prototype', () => {
    const focus = neighborhood(model, 'constructor');
    expect(focus.nodes.size).toBe(1);
    expect(focus.edges.size).toBe(0);
  });
});

describe('reach (authored upstream / downstream chains)', () => {
  it('follows arrows forward, counting nodes without the origin, and the longest hop', () => {
    const down = reach(model, 'Pedidos', 'downstream');
    expect(down.count).toBe(4);
    expect(down.hops).toBe(2);
    expect(sorted(down.nodes)).toEqual(['Kafka', 'Pagamentos', 'Pedidos', 'PostgreSQL', 'Redis']);
    // Every edge whose ends were both reached, not only the search tree.
    expect(sorted(down.edges)).toEqual(['Kafka→Pagamentos', 'Pagamentos→PostgreSQL', 'Pedidos→Kafka', 'Pedidos→PostgreSQL', 'Pedidos→Redis']);
  });

  it('follows arrows backward for upstream and stops at cycles', () => {
    const up = reach(model, 'Pedidos', 'upstream');
    expect(up).toMatchObject({ count: 3, hops: 2 });
    expect(sorted(up.edges)).toEqual(['API Gateway→Pedidos', 'Mobile→API Gateway', 'Web App→API Gateway']);
    const loop = applyOps(model, [{ op: 'connect', from: 'PostgreSQL', to: 'Pedidos' }]);
    if (!loop.ok) throw new Error(loop.error.message);
    expect(reach(loop.model, 'Pedidos', 'downstream').count).toBe(4);
  });

  it('a chain as a focus: downstream edges read as outgoing, upstream as incoming', () => {
    const focus = reachFocus(model, 'Pedidos', 'upstream');
    expect(focus.edges.get('Web App→API Gateway')).toBe('in');
    expect(sorted(focus.groups)).toEqual(['Frontend', 'Serviços']);
    expect(reachFocus(model, 'Pedidos', 'downstream').edges.get('Kafka→Pagamentos')).toBe('out');
  });
});

describe('connections (the passport lists)', () => {
  it('lists outgoing and incoming edges with the neighbour, in diagram order', () => {
    const { outgoing, incoming } = connections(model, 'Pedidos');
    expect(outgoing.map((c) => [c.neighbor, c.edge.label ?? null])).toEqual([
      ['PostgreSQL', 'SQL'],
      ['Redis', 'cache'],
      ['Kafka', 'eventos'],
    ]);
    expect(incoming.map((c) => c.neighbor)).toEqual(['API Gateway']);
    expect(outgoing[0]!.via).toBeNull();
  });

  it('for a group: only edges crossing its border, with the member they touch', () => {
    const { outgoing, incoming } = connections(model, 'Serviços');
    expect(outgoing.map((c) => `${c.via}→${c.neighbor}`)).toEqual(['Pedidos→PostgreSQL', 'Pagamentos→PostgreSQL', 'Pedidos→Redis', 'Pedidos→Kafka']);
    expect(incoming.map((c) => `${c.neighbor}→${c.via}`)).toEqual(['API Gateway→Pedidos', 'API Gateway→Pagamentos', 'Kafka→Pagamentos']);
  });
});

describe('withPreview (hovering one row of the passport)', () => {
  it('narrows the focus to that one edge and its two ends', () => {
    const focus = withPreview(model, neighborhood(model, 'Pedidos'), 'Pedidos→Redis');
    expect(Object.fromEntries(focus.edges)).toEqual({ 'Pedidos→Redis': 'out' });
    expect(sorted(focus.nodes)).toEqual(['Pedidos', 'Redis']);
    expect(sorted(focus.groups)).toEqual(['Dados', 'Serviços']);
  });

  it('ignores an edge that is not part of the focus', () => {
    const base = neighborhood(model, 'Pedidos');
    expect(withPreview(model, base, 'Web App→API Gateway')).toBe(base);
  });
});

describe('breadcrumb', () => {
  it('names the groups around an element, outermost first', () => {
    expect(breadcrumb(model, 'Redis')).toEqual(['Dados']);
    expect(breadcrumb(model, 'Kafka')).toEqual([]);
  });
});

describe('DIM_OPACITY', () => {
  it('keeps what is out of focus readable', () => {
    expect(DIM_OPACITY).toBe(0.55);
  });
  it('is the value the dimming CSS reads through --sk-dim', () => {
    const css = readFileSync(new URL('../styles/diagram.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.sk-focusing \.react-flow__node\.sk-dim\s*\{\s*opacity:\s*var\(--sk-dim/);
    expect(css).not.toMatch(/\.sk-focusing[^{]*\{\s*opacity:\s*0\./);
    const canvas = readFileSync(new URL('../canvas/DiagramCanvas.tsx', import.meta.url), 'utf8');
    expect(canvas).toContain('DIM_OPACITY');
  });
});
