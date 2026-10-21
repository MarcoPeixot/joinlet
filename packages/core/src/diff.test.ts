import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyOps } from './applyOps';
import { diffModels, semanticView } from './diff';
import { CONNECTORS, SHAPES, emptyModel } from './model';
import type { Connector, DiagramModel, DiagramOp, Shape } from './model';
import { modelArb } from './testing';

function build(ops: DiagramOp[]): DiagramModel {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

function patched(prev: DiagramModel, next: DiagramModel): DiagramModel {
  const result = applyOps(prev, diffModels(prev, next));
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

const base = build([
  { op: 'add_group', id: 'VPC', color: 'blue' },
  { op: 'add_node', id: 'API', parentId: 'VPC', icon: 'server' },
  { op: 'add_node', id: 'DB', parentId: 'VPC', shape: 'cylinder' },
  { op: 'connect', from: 'API', to: 'DB', label: 'SQL' },
]);

it('treats sequence message order as semantic and replays it through model diff', () => {
  const model = build([{ op: 'add_node', id: 'Client', presentation: 'participant' }, { op: 'add_node', id: 'API', presentation: 'participant' }, { op: 'connect', from: 'Client', to: 'API', label: 'Request' }, { op: 'connect', from: 'API', to: 'Client', label: 'Response', connector: '-->' }]);
  const changed = applyOps(model, [{ op: 'reorder', edges: [1, 0] }]);
  if (!changed.ok) throw new Error(changed.error.message);
  expect(semanticView(changed.model)).not.toEqual(semanticView(model));
  expect(patched(model, changed.model).edges.map(edge => edge.label)).toEqual(['Response', 'Request']);
});

describe('diffModels', () => {
  it('returns no ops for equivalent models', () => {
    expect(diffModels(base, structuredClone(base))).toEqual([]);
  });

  it('detects a rename instead of remove + add, keeping edges', () => {
    const next = build([
      { op: 'add_group', id: 'VPC', color: 'blue' },
      { op: 'add_node', id: 'Gateway', parentId: 'VPC', icon: 'server' },
      { op: 'add_node', id: 'DB', parentId: 'VPC', shape: 'cylinder' },
      { op: 'connect', from: 'Gateway', to: 'DB', label: 'SQL' },
    ]);
    expect(diffModels(base, next)).toEqual([{ op: 'rename', id: 'API', to: 'Gateway' }]);
  });

  it('renames a group and its child in the same edit', () => {
    const prev = build([{ op: 'add_group', id: 'G' }, { op: 'add_node', id: 'A', parentId: 'G' }]);
    const next = build([{ op: 'add_group', id: 'H' }, { op: 'add_node', id: 'B', parentId: 'H' }]);
    expect(diffModels(prev, next)).toEqual([
      { op: 'rename', id: 'G', to: 'H' },
      { op: 'rename', id: 'A', to: 'B' },
    ]);
  });

  it('removes only the top-level element of a deleted subtree', () => {
    const next = build([]);
    expect(diffModels(base, next)).toEqual([{ op: 'remove', id: 'VPC' }]);
  });

  it('adds parents before children, with props as a separate update', () => {
    const next = build([
      { op: 'add_group', id: 'VPC', color: 'blue' },
      { op: 'add_node', id: 'API', parentId: 'VPC', icon: 'server' },
      { op: 'add_node', id: 'DB', parentId: 'VPC', shape: 'cylinder' },
      { op: 'connect', from: 'API', to: 'DB', label: 'SQL' },
      { op: 'add_group', id: 'Edge' },
      { op: 'add_node', id: 'CDN', parentId: 'Edge', icon: 'cdn' },
      { op: 'connect', from: 'CDN', to: 'API' },
    ]);
    expect(diffModels(base, next)).toEqual([
      { op: 'add_group', id: 'Edge' },
      { op: 'add_node', id: 'CDN', parentId: 'Edge' },
      { op: 'update', id: 'CDN', set: { icon: 'cdn' } },
      { op: 'connect', from: 'CDN', to: 'API', connector: '>' },
    ]);
  });

  it('emits prop, style and edge changes', () => {
    const next = structuredClone(base);
    next.elements.DB = { kind: 'node', id: 'DB', parentId: 'VPC', color: 'green' };
    next.style.direction = 'down';
    next.edges[0] = { ...next.edges[0]!, label: 'TCP', connector: '-->' };
    expect(diffModels(base, next)).toEqual([
      { op: 'update_edge', edgeId: 'API→DB', set: { connector: '-->', label: 'TCP' } },
      { op: 'update', id: 'DB', set: { shape: null, color: 'green' } },
      { op: 'set_style', set: { direction: 'down' } },
    ]);
  });

  it('moves survivors out of a removed group before removing it', () => {
    const next = build([{ op: 'add_node', id: 'API', icon: 'server' }]);
    expect(diffModels(base, next)).toEqual([
      { op: 'move_to_group', id: 'API', parentId: null },
      { op: 'remove', id: 'VPC' },
    ]);
  });

  it('swaps nesting without creating a cycle', () => {
    const prev = build([{ op: 'add_group', id: 'A' }, { op: 'add_group', id: 'B', parentId: 'A' }]);
    const next = build([{ op: 'add_group', id: 'B' }, { op: 'add_group', id: 'A', parentId: 'B' }]);
    expect(semanticView(patched(prev, next))).toEqual(semanticView(next));
  });

  it('replaces an element whose kind changed', () => {
    const next = structuredClone(base);
    next.elements.DB = { kind: 'group', id: 'DB', parentId: 'VPC' };
    const ops = diffModels(base, next);
    expect(ops.slice(0, 2)).toEqual([{ op: 'remove', id: 'DB' }, { op: 'add_group', id: 'DB', parentId: 'VPC' }]);
    expect(semanticView(patched(base, next))).toEqual(semanticView(next));
  });

  it('keeps the declaration order of elements and edges', () => {
    const next = build([
      { op: 'add_group', id: 'VPC', color: 'blue' },
      { op: 'add_node', id: 'Cache', parentId: 'VPC' },
      { op: 'add_node', id: 'API', parentId: 'VPC', icon: 'server' },
      { op: 'add_node', id: 'DB', parentId: 'VPC', shape: 'cylinder' },
      { op: 'connect', from: 'API', to: 'Cache' },
      { op: 'connect', from: 'API', to: 'DB', label: 'SQL' },
    ]);
    const ops = diffModels(base, next);
    expect(ops.at(-1)).toEqual({ op: 'reorder', order: ['VPC', 'Cache', 'API', 'DB'], edges: [1, 0] });
    const result = patched(base, next);
    expect(result.order).toEqual(next.order);
    expect(result.edges).toEqual(next.edges);
  });

  it('applyOps(prev, diffModels(prev, next)) reproduces next, order and edge ids included', () => {
    const names = fc.constantFrom('A', 'B', 'C', 'D', 'E', 'F');
    fc.assert(
      fc.property(modelArb({ names }), modelArb({ names }), (prev, next) => {
        const result = patched(prev, next);
        expect(semanticView(result)).toEqual(semanticView(next));
        expect(result.order).toEqual(next.order);
        expect(result.edges).toEqual(next.edges);
      }),
      { numRuns: 400 },
    );
  });
});

describe('diffModels with names that collide with Object.prototype', () => {
  it('adds, removes and renames them like any other name', () => {
    const names = fc.constantFrom('constructor', 'toString', 'valueOf', 'hasOwnProperty', 'A', 'B');
    fc.assert(
      fc.property(modelArb({ names }), modelArb({ names }), (prev, next) => {
        const result = patched(prev, next);
        expect(semanticView(result)).toEqual(semanticView(next));
        expect(result.order).toEqual(next.order);
        expect(result.edges).toEqual(next.edges);
      }),
      { numRuns: 200 },
    );
  });
});

describe('diffModels — edit scripts', () => {
  /** An abstract edit, resolved against the model it is applied to (indices wrap around). */
  type Step =
    | { t: 'rename'; a: number; to: string }
    | { t: 'move'; a: number; b: number; top: boolean }
    | { t: 'remove'; a: number }
    | { t: 'add'; id: string; group: boolean; b: number; top: boolean }
    | { t: 'update'; a: number; color: string | null; shape: Shape }
    | { t: 'connect'; a: number; b: number; connector: Connector; label: string | null }
    | { t: 'removeEdge'; a: number }
    | { t: 'updateEdge'; a: number; label: string | null; connector: Connector }
    | { t: 'shuffle'; seed: number };

  const stepArb: fc.Arbitrary<Step> = fc.oneof(
    fc.record({ t: fc.constant('rename' as const), a: fc.nat(), to: fc.constantFrom('R1', 'R2', 'R3', 'X', 'Y') }),
    fc.record({ t: fc.constant('move' as const), a: fc.nat(), b: fc.nat(), top: fc.boolean() }),
    fc.record({ t: fc.constant('remove' as const), a: fc.nat() }),
    fc.record({ t: fc.constant('add' as const), id: fc.constantFrom('N1', 'N2', 'N3'), group: fc.boolean(), b: fc.nat(), top: fc.boolean() }),
    fc.record({ t: fc.constant('update' as const), a: fc.nat(), color: fc.constantFrom('red', 'blue', null), shape: fc.constantFrom(...SHAPES) }),
    fc.record({
      t: fc.constant('connect' as const), a: fc.nat(), b: fc.nat(), connector: fc.constantFrom(...CONNECTORS), label: fc.constantFrom(null, 'x', 'y'),
    }),
    fc.record({ t: fc.constant('removeEdge' as const), a: fc.nat() }),
    fc.record({ t: fc.constant('updateEdge' as const), a: fc.nat(), label: fc.constantFrom(null, 'z'), connector: fc.constantFrom(...CONNECTORS) }),
    fc.record({ t: fc.constant('shuffle' as const), seed: fc.nat() }),
  );

  /** Deterministic permutation of `items` from `seed`. */
  function shuffled<T>(items: readonly T[], seed: number): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = (seed * (i + 7)) % (i + 1);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  function resolve(m: DiagramModel, step: Step): DiagramOp | null {
    const ids = m.order;
    const groups = ids.filter((id) => m.elements[id]!.kind === 'group');
    const pick = (i: number) => (ids.length ? ids[i % ids.length]! : null);
    const group = (i: number, top: boolean) => (top || !groups.length ? undefined : groups[i % groups.length]!);
    const edge = (i: number) => m.edges[i % Math.max(1, m.edges.length)];
    switch (step.t) {
      case 'rename': {
        const id = pick(step.a);
        return id ? { op: 'rename', id, to: step.to } : null;
      }
      case 'move': {
        const id = pick(step.a);
        return id ? { op: 'move_to_group', id, parentId: group(step.b, step.top) ?? null } : null;
      }
      case 'remove': {
        const id = pick(step.a);
        return id ? { op: 'remove', id } : null;
      }
      case 'add': {
        const parentId = group(step.b, step.top);
        return step.group ? { op: 'add_group', id: step.id, parentId } : { op: 'add_node', id: step.id, parentId };
      }
      case 'update': {
        const id = pick(step.a);
        if (!id) return null;
        return { op: 'update', id, set: m.elements[id]!.kind === 'node' ? { color: step.color, shape: step.shape } : { color: step.color } };
      }
      case 'connect': {
        const [from, to] = [pick(step.a), pick(step.b)];
        return from && to ? { op: 'connect', from, to, connector: step.connector, ...(step.label ? { label: step.label } : {}) } : null;
      }
      case 'removeEdge': {
        const e = edge(step.a);
        return e ? { op: 'remove_edge', edgeId: e.id } : null;
      }
      case 'updateEdge': {
        const e = edge(step.a);
        return e ? { op: 'update_edge', edgeId: e.id, set: { label: step.label, connector: step.connector } } : null;
      }
      case 'shuffle':
        return { op: 'reorder', order: shuffled(ids, step.seed), edges: shuffled(m.edges.map((_, i) => i), step.seed + 1) };
    }
  }

  it('reproduces a model edited by 1–4 renames, reparents, reorders, edge edits, removals and additions', () => {
    const names = fc.constantFrom('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H');
    fc.assert(
      fc.property(modelArb({ names, maxElements: 7, maxEdges: 7 }), fc.array(stepArb, { minLength: 1, maxLength: 4 }), (prev, steps) => {
        let next = prev;
        for (const step of steps) {
          const op = resolve(next, step);
          const result = op && applyOps(next, [op]);
          if (result && result.ok) next = result.model;
        }
        const result = patched(prev, next);
        expect(semanticView(result)).toEqual(semanticView(next));
        expect(result.order).toEqual(next.order);
        expect(result.edges).toEqual(next.edges);
      }),
      { numRuns: 500 },
    );
  });
});
