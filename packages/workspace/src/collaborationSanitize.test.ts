import { describe, expect, it } from 'vitest';
import { applyOps, emptyModel, validParents } from '@strukt/core';
import type { DiagramModel, NodeBox } from '@strukt/core';
import { parseDiagramJson, printDiagramJson } from '@strukt/json';
import {
  COLLAB_MAX_COORDINATE, COLLAB_MAX_DEPTH, COLLAB_MAX_EDGES, COLLAB_MAX_ELEMENTS, sanitizeCollaborativeDiagram,
} from './collaborationSanitize';
import type { DiagramSnapshot } from './diagram';

/** A snapshot as a merged or hostile Yjs doc can describe it: nothing here is trusted. */
const raw = (model: Record<string, unknown>, nodes: unknown = {}): DiagramSnapshot =>
  ({ model: { ...emptyModel(), ...model }, layout: { nodes, edges: {} } }) as unknown as DiagramSnapshot;
const kinds = (result: ReturnType<typeof sanitizeCollaborativeDiagram>) => [...new Set(result.repairs.map((repair) => repair.kind))].sort();
const group = (id: string, parentId?: string) => ({ kind: 'group', id, ...(parentId === undefined ? {} : { parentId }) });
const node = (id: string, parentId?: string) => ({ kind: 'node', id, ...(parentId === undefined ? {} : { parentId }) });

function valid(): DiagramSnapshot {
  const result = applyOps(emptyModel(), [
    { op: 'add_group', id: 'VPC', color: 'blue' },
    { op: 'add_node', id: 'API', parentId: 'VPC', shape: 'hexagon', tech: 'Go' },
    { op: 'add_node', id: 'constructor', label: 'Proto-ish' },
    { op: 'connect', from: 'API', to: 'constructor', label: 'SQL', connector: '<>' },
    { op: 'set_style', set: { direction: 'down' } },
  ]);
  if (!result.ok) throw new Error(result.error.message);
  return { model: result.model, layout: { nodes: { VPC: { x: 0, y: 0, w: 300, h: 200 }, API: { x: 20, y: 40 }, constructor: { x: -300.5, y: 1e7 } }, edges: {} } };
}

/** Everything wrong at once, in one fixed key order. */
function messy(): DiagramSnapshot {
  const elements = JSON.parse('{"__proto__": {"kind": "node", "id": "__proto__"}}') as Record<string, unknown>;
  Object.assign(elements, {
    G1: group('G1', 'G2'), G2: group('G2', 'G1'), N: node('N', 'G1'),
    Impostor: { kind: 'node', id: 'API', label: 12345, color: 'red' }, API: node('API'),
    Orphan: node('Orphan', 'gone'), Inside: node('Inside', 'API'), Junk: 'text', Empty: null,
  });
  const nodes = JSON.parse('{"__proto__": {"x": 1, "y": 2}}') as Record<string, unknown>;
  Object.assign(nodes, { G1: { x: 0, y: 0, w: 400, h: 300 }, N: { x: Number.NaN, y: 1 }, API: { x: 'abc', y: null }, Orphan: { x: 3e7, y: 0 }, ghost: { x: 1, y: 1 } });
  return raw({
    elements,
    order: ['N', 'ghost', 'G2', '__proto__', 'G1', 'N', 'Impostor', 7],
    edges: [
      { id: 'API→N', from: 'API', to: 'N', connector: '>' },
      { id: 'API→gone', from: 'API', to: 'gone', connector: '>' },
      { id: '__proto__', from: 'API', to: 'N', connector: '>' },
      { id: 'N→Orphan', from: 'N', to: 'Orphan', connector: 'zz', label: 5 },
    ],
  }, nodes);
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** The same data, with the keys of every id-keyed record inserted in another order (as another peer may hold them). */
function reshuffled(snapshot: DiagramSnapshot, seed: number): DiagramSnapshot {
  const reorder = (record: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const key of shuffled(Object.keys(record), seed)) Object.defineProperty(out, key, { value: record[key], enumerable: true, writable: true, configurable: true });
    return out;
  };
  return { model: { ...snapshot.model, elements: reorder(snapshot.model.elements) as DiagramModel['elements'] }, layout: { nodes: reorder(snapshot.layout.nodes) as Record<string, NodeBox>, edges: {} } };
}

const acyclic = (model: DiagramModel) => {
  for (const id of Object.keys(model.elements)) {
    const seen = new Set<string>();
    for (let cur: string | undefined = id; cur !== undefined; cur = model.elements[cur]?.parentId) {
      expect(seen.has(cur), `cycle through ${cur}`).toBe(false);
      seen.add(cur);
    }
  }
};

describe('sanitizeCollaborativeDiagram', () => {
  it('returns a valid diagram unchanged and reports nothing', () => {
    const input = valid();
    const result = sanitizeCollaborativeDiagram(input);
    expect(result.repairs).toEqual([]);
    expect(result.snapshot).toEqual(input);
  });

  it('uses the map key as the id and drops __proto__ elements, edges, positions and order entries', () => {
    const result = sanitizeCollaborativeDiagram(messy());
    const { model, layout } = result.snapshot;
    for (const record of [model.elements, layout.nodes]) expect(Object.hasOwn(record, '__proto__')).toBe(false);
    expect(model.order).not.toContain('__proto__');
    expect(model.edges.map((edge) => edge.id)).not.toContain('__proto__');
    expect(model.elements.Impostor).toEqual({ kind: 'node', id: 'Impostor', color: 'red' });
    for (const [key, el] of Object.entries(model.elements)) expect(el.id).toBe(key);
    expect(kinds(result)).toEqual(expect.arrayContaining(['id', 'reserved']));
  });

  it('drops records that are not objects and fields of the wrong type', () => {
    const result = sanitizeCollaborativeDiagram(raw({
      elements: { Junk: 'text', Empty: null, List: [1], N: { kind: 'weird', id: 'N', label: 12345, shape: 'blob', icon: { a: 1 }, color: 'red', typeface: 'mono', span: { from: 0, to: 1 } }, G: { kind: 'group', id: 'G', shape: 'cylinder', styleMode: 'neon' } },
      order: ['Junk', 'N', 'G', 'List', 'Empty'],
    }));
    expect(result.snapshot.model.elements).toEqual({ N: { kind: 'node', id: 'N', color: 'red', typeface: 'mono' }, G: { kind: 'group', id: 'G' } });
    expect(result.snapshot.model.order).toEqual(['N', 'G']);
    expect(kinds(result)).toEqual(['field', 'record']);
  });

  it('moves an element whose parent is missing or is a node to the top level, keeping the element', () => {
    const result = sanitizeCollaborativeDiagram(raw({
      elements: { API: node('API'), Cache: node('Cache', 'API'), Fila: node('Fila', 'G1'), Pad: { ...node('Pad'), parentId: 42 } },
      order: ['API', 'Cache', 'Fila', 'Pad'],
    }));
    expect(Object.keys(result.snapshot.model.elements)).toEqual(['API', 'Cache', 'Fila', 'Pad']);
    for (const el of Object.values(result.snapshot.model.elements)) expect(el.parentId).toBeUndefined();
    expect(kinds(result)).toEqual(['field', 'parent']);
  });

  it('breaks a parent cycle at its greatest id whatever the read order, and prints every element', () => {
    for (const order of [['G1', 'G2', 'N'], ['G2', 'N', 'G1'], ['N', 'G1', 'G2']]) {
      const result = sanitizeCollaborativeDiagram(raw({ elements: { G1: group('G1', 'G2'), G2: group('G2', 'G1'), N: node('N', 'G1') }, order }));
      const { elements } = result.snapshot.model;
      expect(elements.G2!.parentId).toBeUndefined();
      expect(elements.G1!.parentId).toBe('G2');
      expect(elements.N!.parentId).toBe('G1');
      expect(result.repairs).toEqual([{ kind: 'cycle', id: 'G2' }]);
      expect(Object.keys(parseDiagramJson(printDiagramJson(result.snapshot.model)).model.elements).sort()).toEqual(['G1', 'G2', 'N']);
    }
  });

  it('drops edges whose endpoint does not exist and repairs their fields', () => {
    const result = sanitizeCollaborativeDiagram(raw({
      elements: { A: node('A'), B: node('B') },
      order: ['A', 'B'],
      edges: [
        { id: 'A→B', from: 'A', to: 'B', connector: '>' },
        { id: 'A→gone', from: 'A', to: 'gone', connector: '>' },
        { id: 'x', from: 7, to: 'B', connector: '>' },
        { id: 'B→A', from: 'B', to: 'A', connector: 'zz', label: 5, color: 'red' },
        { id: 'A→B', from: 'B', to: 'A', connector: '-' },
        'garbage',
      ],
    }));
    expect(result.snapshot.model.edges).toEqual([
      { id: 'A→B', from: 'A', to: 'B', connector: '>' },
      { id: 'B→A', from: 'B', to: 'A', connector: '>', color: 'red' },
    ]);
    expect(kinds(result)).toEqual(['edge', 'field', 'id', 'record']);
  });

  it('omits positions that are not finite numbers or lie past ±1e7, and boxes of missing elements', () => {
    const elements = Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((id) => [id, node(id)]));
    const result = sanitizeCollaborativeDiagram(raw({ elements, order: Object.keys(elements) }, {
      A: { x: Number.NaN, y: 0 }, B: { x: Infinity, y: 0 }, C: { x: 'abc', y: null }, D: { x: 0, y: -2e7 },
      E: { x: COLLAB_MAX_COORDINATE, y: -COLLAB_MAX_COORDINATE, w: 160, h: 60 }, F: { x: 1, y: 2, w: -5, h: Number.NaN }, G: 'box', H: { x: 5, y: 6, w: 2e7 },
      ghost: { x: 1, y: 1 },
    }));
    expect(result.snapshot.layout.nodes).toEqual({ E: { x: COLLAB_MAX_COORDINATE, y: -COLLAB_MAX_COORDINATE, w: 160, h: 60 }, F: { x: 1, y: 2 }, H: { x: 5, y: 6 } });
    expect(kinds(result)).toEqual(['position']);
  });

  it('drops order entries that are unknown or repeated and appends missing elements by id', () => {
    const result = sanitizeCollaborativeDiagram(raw({ elements: { A: node('A'), B: node('B'), C: node('C'), D: node('D') }, order: ['C', 'ghost', 'C', 3, 'A'] }));
    expect(result.snapshot.model.order).toEqual(['C', 'A', 'B', 'D']);
    expect(kinds(result)).toEqual(['order']);
  });

  it('caps elements and edges, the last resort for a room bloated before updates were bounded', () => {
    const count = COLLAB_MAX_ELEMENTS + 5;
    const elements: Record<string, unknown> = {};
    const order: string[] = [];
    for (let i = 0; i < count; i++) {
      elements[`N${i}`] = node(`N${i}`);
      order.push(`N${i}`);
    }
    const edges = Array.from({ length: COLLAB_MAX_EDGES + 3 }, (_, i) => ({ id: `e${i}`, from: 'N0', to: `N${(i % 3) + 1}`, connector: '>' }));
    edges.unshift({ id: 'late', from: 'N0', to: `N${count - 1}`, connector: '>' });
    const result = sanitizeCollaborativeDiagram(raw({ elements, order, edges }));
    const { model } = result.snapshot;
    expect(model.order).toHaveLength(COLLAB_MAX_ELEMENTS);
    expect(Object.keys(model.elements)).toHaveLength(COLLAB_MAX_ELEMENTS);
    expect(model.order.at(-1)).toBe(`N${COLLAB_MAX_ELEMENTS - 1}`);
    expect(model.edges).toHaveLength(COLLAB_MAX_EDGES);
    expect(model.edges[0]!.id).toBe('e0');
    expect(kinds(result)).toEqual(['edge', 'limit']);
    expect(result.repairs.length).toBeLessThanOrEqual(100);
  });

  it('never cuts text: a long description, link or label reads back whole', () => {
    const long = {
      label: 'a'.repeat(5000), description: 'ADR '.repeat(6000), link: `https://grafana.example.com/d/abc?${'var-x=1&'.repeat(300)}`,
      tech: `a${'😀'.repeat(3000)}`, icon: 'i'.repeat(2500), color: 'c'.repeat(2500),
    };
    const input = raw({
      elements: { A: { ...node('A'), ...long }, B: node('B') },
      order: ['A', 'B'],
      edges: [{ id: 'A→B', from: 'A', to: 'B', connector: '>', label: 'l'.repeat(4000), color: 'c'.repeat(3000) }],
    });
    const result = sanitizeCollaborativeDiagram(input);
    expect(result.repairs).toEqual([]);
    expect(result.snapshot.model.elements.A).toEqual({ kind: 'node', id: 'A', ...long });
    expect(result.snapshot.model.edges[0]!.label).toHaveLength(4000);
    expect(result.snapshot.model.edges[0]!.color).toHaveLength(3000);
  });

  it(`detaches an element nested under more than ${COLLAB_MAX_DEPTH} groups, so the printed file parses, whatever the read order`, () => {
    expect(COLLAB_MAX_DEPTH).toBe(31);
    // L00 … L39: one chain 40 groups deep; Deep sits under L31 (32 ancestors, one too many), Edge under L30 (31, the limit).
    const chain = Array.from({ length: 40 }, (_, i) => `L${String(i).padStart(2, '0')}`);
    const elements: Record<string, unknown> = {};
    for (const [i, id] of chain.entries()) elements[id] = group(id, i ? chain[i - 1] : undefined);
    Object.assign(elements, { Deep: node('Deep', 'L31'), Edge: node('Edge', 'L30') });
    const ids = Object.keys(elements);
    let first: DiagramSnapshot | null = null;
    for (let seed = 0; seed < 6; seed++) {
      const result = sanitizeCollaborativeDiagram(raw({ elements, order: seed ? shuffled(ids, seed) : ids }));
      const { elements: kept } = result.snapshot.model;
      // L32 is the first element with 32 ancestors: it goes to the top level and keeps its own subtree.
      expect(kept.L32!.parentId).toBeUndefined();
      expect(kept.L33!.parentId).toBe('L32');
      expect(kept.L39!.parentId).toBe('L38');
      expect(kept.L31!.parentId).toBe('L30');
      expect(kept.Deep!.parentId).toBeUndefined();
      expect(kept.Edge!.parentId).toBe('L30');
      expect(result.repairs).toEqual(expect.arrayContaining([{ kind: 'depth', id: 'L32' }, { kind: 'depth', id: 'Deep' }]));
      expect(new Set(result.repairs.map((repair) => repair.kind))).toEqual(new Set(['depth']));
      const parsed = parseDiagramJson(printDiagramJson(result.snapshot.model));
      expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
      expect(Object.keys(parsed.model.elements).sort()).toEqual([...ids].sort());
      if (first) expect(Object.fromEntries(validParents(result.snapshot.model))).toEqual(Object.fromEntries(validParents(first.model)));
      else first = result.snapshot;
    }
    // Exactly at the limit nothing moves.
    const limit = raw({ elements: Object.fromEntries(chain.slice(0, 32).map((id, i) => [id, group(id, i ? chain[i - 1] : undefined)])), order: chain.slice(0, 32) });
    expect(sanitizeCollaborativeDiagram(limit).repairs).toEqual([]);
  });

  it('falls back to the default style for invalid values', () => {
    const result = sanitizeCollaborativeDiagram(raw({ style: { direction: 'down', colorMode: 'neon', typeface: 7, extra: 'x' } }));
    expect(result.snapshot.model.style).toEqual({ ...emptyModel().style, direction: 'down' });
    expect(kinds(result)).toEqual(['field']);
  });

  it('never throws on garbage', () => {
    for (const garbage of [null, 'x', { model: null, layout: null }, { model: { elements: 'x', order: 5, edges: {}, style: null }, layout: { nodes: [1] } }]) {
      const result = sanitizeCollaborativeDiagram(garbage as unknown as DiagramSnapshot);
      expect(result.snapshot).toEqual({ model: emptyModel(), layout: { nodes: {}, edges: {} } });
    }
  });

  it('derives the same diagram from any key order, cycle-free and without losing an element', () => {
    const first = sanitizeCollaborativeDiagram(messy()).snapshot;
    acyclic(first.model);
    expect(Object.keys(first.model.elements).sort()).toEqual(['API', 'G1', 'G2', 'Impostor', 'Inside', 'N', 'Orphan']);
    expect(first.model.order).toEqual(['N', 'G2', 'G1', 'Impostor', 'API', 'Inside', 'Orphan']);
    for (let seed = 1; seed <= 25; seed++) {
      const other = sanitizeCollaborativeDiagram(reshuffled(messy(), seed)).snapshot;
      expect(other).toEqual(first);
      expect(printDiagramJson(other.model)).toBe(printDiagramJson(first.model));
      expect(Object.fromEntries(validParents(other.model))).toEqual(Object.fromEntries(validParents(first.model)));
    }
  });

  it('is idempotent', () => {
    for (const input of [valid(), messy()]) {
      const once = sanitizeCollaborativeDiagram(input);
      const twice = sanitizeCollaborativeDiagram(once.snapshot);
      expect(twice.snapshot).toEqual(once.snapshot);
      expect(twice.repairs).toEqual([]);
    }
  });
});
