import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyOps, computeRects, emptyLayout, emptyModel, normalizeEdgeIds, syncLayout } from '@strukt/core';
import type { DiagramModel, DiagramOp } from '@strukt/core';
import { parseDiagramJson, printDiagramJson } from '@strukt/json';
import {
  applyCollaborativeDiagramDelta, inspectCollaborativeDiagram, readCollaborativeDiagram, repairCollaborativeDiagram, repairedLocalDiagram,
  seedCollaborativeDiagram, seedCollaborativeText,
} from './collaboration';
import { COLLAB_MAX_ELEMENTS } from './collaborationSanitize';
import type { DiagramSnapshot } from './diagram';

const exchange = (a: Y.Doc, b: Y.Doc) => {
  const fromA = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const fromB = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(a, fromB);
  Y.applyUpdate(b, fromA);
};

describe('collaborative workspace', () => {
  it('replicates typed fields and cardinalities while concurrent labels remain independent', () => {
    const result = applyOps(emptyModel(), [{ op: 'add_node', id: 'Users', presentation: 'table', fields: [{ name: 'id', type: 'uuid', key: 'PK' }] }, { op: 'add_node', id: 'Teams', presentation: 'table' }, { op: 'connect', from: 'Teams', to: 'Users', connector: '-', fromCardinality: 'one', toCardinality: 'zero-many' }]);
    if (!result.ok) throw new Error(result.error.message);
    const base = { model: result.model, layout: emptyLayout() }, a = new Y.Doc(), b = new Y.Doc();
    seedCollaborativeDiagram(a, base); exchange(a, b);
    const fields = applyOps(base.model, [{ op: 'update', id: 'Users', set: { fields: [{ name: 'id', type: 'bigint', key: 'PK' }, { name: 'team_id', type: 'uuid', key: 'FK' }] } }, { op: 'update_edge', edgeId: 'Teams→Users', set: { toCardinality: 'many' } }]);
    const title = applyOps(base.model, [{ op: 'update', id: 'Users', set: { label: 'Clientes' } }]);
    if (!fields.ok || !title.ok) throw new Error('Could not construct edits');
    applyCollaborativeDiagramDelta(a, base, { ...base, model: fields.model });
    applyCollaborativeDiagramDelta(b, base, { ...base, model: title.model }); exchange(a, b);
    for (const doc of [a, b]) {
      const read = inspectCollaborativeDiagram(doc)!;
      expect(read.repairs).toEqual([]);
      expect(read.snapshot.model.elements.Users).toMatchObject({ presentation: 'table', label: 'Clientes', fields: [{ name: 'id', type: 'bigint', key: 'PK' }, { name: 'team_id', type: 'uuid', key: 'FK' }] });
      expect(read.snapshot.model.edges[0]).toMatchObject({ fromCardinality: 'one', toCardinality: 'many' });
      expect(repairCollaborativeDiagram(doc).update).toBeNull();
    }
  });

  it('replicates sequence message order and participant presentation', () => {
    const result = applyOps(emptyModel(), [{ op: 'add_node', id: 'Client', presentation: 'participant' }, { op: 'add_node', id: 'API', presentation: 'participant' }, { op: 'connect', from: 'Client', to: 'API', label: 'Request' }, { op: 'connect', from: 'API', to: 'Client', label: 'Reply', connector: '-->' }]);
    if (!result.ok) throw new Error(result.error.message);
    const base = { model: result.model, layout: emptyLayout() }, a = new Y.Doc(), b = new Y.Doc();
    seedCollaborativeDiagram(a, base); exchange(a, b);
    const reordered = applyOps(base.model, [{ op: 'reorder', edges: [1, 0] }]);
    if (!reordered.ok) throw new Error(reordered.error.message);
    applyCollaborativeDiagramDelta(a, base, { ...base, model: reordered.model }); exchange(a, b);
    const read = readCollaborativeDiagram(b)!;
    expect(read.model.elements.API!.presentation).toBe('participant');
    expect(read.model.edges.map(edge => edge.label)).toEqual(['Reply', 'Request']);
    expect(read.model.edges[0]!.connector).toBe('-->');
  });
  it('merges concurrent Markdown insertions and repeated updates', () => {
    const a = new Y.Doc();
    seedCollaborativeText(a, 'Hello');
    const b = new Y.Doc();
    exchange(a, b);
    a.getText('content').insert(0, 'A ');
    b.getText('content').insert(5, ' B');
    exchange(a, b);
    exchange(a, b);
    expect(a.getText('content').toString()).toBe('A Hello B');
    expect(b.getText('content').toString()).toBe('A Hello B');
  });

  it('keeps independent elements and positions added at the same time', () => {
    const first = new Y.Doc();
    const base = { model: emptyModel(), layout: emptyLayout() };
    seedCollaborativeDiagram(first, base);
    const second = new Y.Doc();
    exchange(first, second);
    const withA = {
      model: { ...base.model, elements: { A: { kind: 'node' as const, id: 'A', label: 'A' } }, order: ['A'] },
      layout: { nodes: { A: { x: 0, y: 0 } }, edges: {} },
    };
    const withB = {
      model: { ...base.model, elements: { B: { kind: 'node' as const, id: 'B', label: 'B' } }, order: ['B'] },
      layout: { nodes: { B: { x: 100, y: 0 } }, edges: {} },
    };
    applyCollaborativeDiagramDelta(first, base, withA);
    applyCollaborativeDiagramDelta(second, base, withB);
    exchange(first, second);
    for (const doc of [first, second]) {
      const snapshot = readCollaborativeDiagram(doc)!;
      expect(Object.keys(snapshot.model.elements).sort()).toEqual(['A', 'B']);
      expect(snapshot.model.order).toEqual(['A', 'B']);
      expect(snapshot.layout.nodes).toEqual({ A: { x: 0, y: 0 }, B: { x: 100, y: 0 } });
    }
  });

  it('merges edits to different fields of the same node', () => {
    const base = {
      model: { ...emptyModel(), elements: { N: { kind: 'node' as const, id: 'N', label: 'old', tech: 'old' } }, order: ['N'] },
      layout: { nodes: { N: { x: 0, y: 0 } }, edges: {} },
    };
    const a = new Y.Doc();
    seedCollaborativeDiagram(a, base);
    const b = new Y.Doc();
    exchange(a, b);
    applyCollaborativeDiagramDelta(a, base, { ...base, model: { ...base.model, elements: { N: { ...base.model.elements.N, label: 'new' } } } });
    applyCollaborativeDiagramDelta(b, base, { ...base, model: { ...base.model, elements: { N: { ...base.model.elements.N, tech: 'Bun' } } } });
    exchange(a, b);
    expect(readCollaborativeDiagram(a)?.model.elements.N).toMatchObject({ label: 'new', tech: 'Bun' });
    expect(readCollaborativeDiagram(b)?.model.elements.N).toMatchObject({ label: 'new', tech: 'Bun' });
  });
});

/** The verification workspace: two nodes, a cache, a queue and two empty groups. */
function mapa(): DiagramSnapshot {
  const model = emptyModel();
  const nodes: DiagramSnapshot['layout']['nodes'] = {};
  const add = (el: DiagramModel['elements'][string], box: { x: number; y: number; w: number; h: number }) => {
    model.elements[el.id] = el;
    model.order.push(el.id);
    nodes[el.id] = box;
  };
  add({ kind: 'node', id: 'API' }, { x: 0, y: 0, w: 160, h: 60 });
  add({ kind: 'node', id: 'DB', shape: 'cylinder' }, { x: 300, y: 0, w: 160, h: 60 });
  add({ kind: 'node', id: 'Cache', label: 'Cache' }, { x: 0, y: 200, w: 160, h: 60 });
  add({ kind: 'node', id: 'Fila', label: 'Fila' }, { x: 300, y: 200, w: 160, h: 60 });
  add({ kind: 'group', id: 'G1', label: 'Grupo 1' }, { x: 700, y: 0, w: 300, h: 200 });
  add({ kind: 'group', id: 'G2', label: 'Grupo 2' }, { x: 700, y: 300, w: 300, h: 200 });
  model.edges.push({ id: '', from: 'API', to: 'DB', connector: '>' }, { id: '', from: 'API', to: 'Cache', connector: '>' });
  return { model: normalizeEdgeIds(model), layout: { nodes, edges: {} } };
}

/** What the web client does for a local edit: applyOps on the current view, then publish the delta. */
function edit(doc: Y.Doc, ops: DiagramOp[]): void {
  const before = readCollaborativeDiagram(doc)!;
  const result = applyOps(before.model, ops);
  if (!result.ok) throw new Error(result.error.message);
  applyCollaborativeDiagramDelta(doc, before, { model: result.model, layout: syncLayout(before.layout, result.model, ops) });
}

/** Peers that start from the same seeded room and each make one edit offline; returns their updates. */
function concurrent(first: DiagramOp[], second: DiagramOp[]) {
  const server = new Y.Doc();
  seedCollaborativeDiagram(server, mapa());
  const seed = Y.encodeStateAsUpdate(server);
  const peer = (ops: DiagramOp[]) => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, seed);
    const vector = Y.encodeStateVector(doc);
    edit(doc, ops);
    return Y.encodeStateAsUpdate(doc, vector);
  };
  const updates = [peer(first), peer(second)];
  const merged = (order: number[]) => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, seed);
    for (const index of order) Y.applyUpdate(doc, updates[index]!);
    return doc;
  };
  return { ab: merged([0, 1]), ba: merged([1, 0]) };
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

describe('merged collaborative diagrams are repaired on read', () => {
  const ids = ['API', 'Cache', 'DB', 'Fila', 'G1', 'G2'];

  it('concurrent valid moves G1→G2 and G2→G1 read as the same cycle-free diagram on every peer, losing nothing', () => {
    const { ab, ba } = concurrent([{ op: 'move_to_group', id: 'G1', parentId: 'G2' }], [{ op: 'move_to_group', id: 'G2', parentId: 'G1' }]);
    // The CRDT itself keeps both writes: the repair happens only when the doc is read.
    expect((ab.getMap('elements').get('G1') as Y.Map<unknown>).get('parentId')).toBe('G2');
    expect((ab.getMap('elements').get('G2') as Y.Map<unknown>).get('parentId')).toBe('G1');
    const [first, second] = [readCollaborativeDiagram(ab)!, readCollaborativeDiagram(ba)!];
    expect(second).toEqual(first);
    acyclic(first.model);
    expect(Object.keys(first.model.elements).sort()).toEqual(ids);
    expect(first.model.elements.G1!.parentId).toBe('G2');
    expect(first.model.elements.G2!.parentId).toBeUndefined();
    expect(() => computeRects(first.model, first.layout)).not.toThrow();
    expect(Object.keys(parseDiagramJson(printDiagramJson(first.model)).model.elements).sort()).toEqual(ids);
    expect(inspectCollaborativeDiagram(ab)!.repairs).toEqual([{ kind: 'cycle', id: 'G2' }]);
  });

  it('a local move that would close a cycle in the current view is refused before anything is written', () => {
    const { ab } = concurrent([{ op: 'move_to_group', id: 'G1', parentId: 'G2' }], [{ op: 'move_to_group', id: 'G2', parentId: 'G1' }]);
    const writes: Uint8Array[] = [];
    ab.on('update', (update: Uint8Array) => writes.push(update));
    const view = readCollaborativeDiagram(ab)!;
    const result = applyOps(view.model, [{ op: 'move_to_group', id: 'G2', parentId: 'G1' }]);
    expect(result.ok).toBe(false);
    expect(() => edit(ab, [{ op: 'move_to_group', id: 'G2', parentId: 'G1' }])).toThrow('ciclo');
    applyCollaborativeDiagramDelta(ab, view, view);
    expect(writes).toEqual([]);
  });

  it('removing an element named like an Object.prototype member deletes its record', () => {
    const doc = new Y.Doc();
    seedCollaborativeDiagram(doc, mapa());
    edit(doc, [{ op: 'add_node', id: 'toString' }, { op: 'add_node', id: 'constructor' }]);
    edit(doc, [{ op: 'remove', id: 'toString' }, { op: 'remove', id: 'constructor' }]);
    expect(doc.getMap('elements').has('toString')).toBe(false);
    expect(doc.getMap('elements').has('constructor')).toBe(false);
    expect(Object.keys(readCollaborativeDiagram(doc)!.model.elements).sort()).toEqual(ids);
  });

  it('a local element written over a key a hostile peer filled with something that is not a map gets a fresh record', () => {
    const doc = new Y.Doc();
    seedCollaborativeDiagram(doc, mapa());
    doc.getMap<unknown>('elements').set('Junk', 'not a map');
    doc.getMap<unknown>('positions').set('Junk', 7);
    expect(readCollaborativeDiagram(doc)!.model.elements.Junk).toBeUndefined();
    const before = readCollaborativeDiagram(doc)!;
    const result = applyOps(before.model, [{ op: 'add_node', id: 'Junk', label: 'Fila nova' }]);
    if (!result.ok) throw new Error(result.error.message);
    applyCollaborativeDiagramDelta(doc, before, { model: result.model, layout: { nodes: { ...before.layout.nodes, Junk: { x: 1, y: 2 } }, edges: {} } });
    const after = inspectCollaborativeDiagram(doc)!;
    expect(after.snapshot.model.elements.Junk).toEqual({ kind: 'node', id: 'Junk', label: 'Fila nova' });
    expect(after.snapshot.layout.nodes.Junk).toEqual({ x: 1, y: 2 });
    expect(after.repairs).toEqual([]);
  });

  it('an element moved into a group that a peer removed stays, at the top level', () => {
    const { ab, ba } = concurrent([{ op: 'move_to_group', id: 'Cache', parentId: 'G1' }], [{ op: 'remove', id: 'G1' }]);
    const snapshot = readCollaborativeDiagram(ab)!;
    expect(readCollaborativeDiagram(ba)).toEqual(snapshot);
    expect(snapshot.model.elements.Cache).toEqual({ kind: 'node', id: 'Cache', label: 'Cache' });
    expect(parseDiagramJson(printDiagramJson(snapshot.model)).model.elements.Cache).toBeDefined();
  });

  it('a connection to an element a peer removed is dropped', () => {
    const { ab, ba } = concurrent([{ op: 'connect', from: 'Fila', to: 'DB' }], [{ op: 'remove', id: 'Fila' }]);
    expect(ab.getMap('edges').has('Fila→DB')).toBe(true);
    const snapshot = readCollaborativeDiagram(ab)!;
    expect(readCollaborativeDiagram(ba)).toEqual(snapshot);
    expect(snapshot.model.edges.map((edge) => edge.id)).toEqual(['API→DB', 'API→Cache']);
  });

  it('a hostile doc (__proto__, NaN, strings, id ≠ key, non-map records, 50k elements) reads as a bounded, valid diagram', () => {
    const doc = new Y.Doc();
    seedCollaborativeDiagram(doc, mapa());
    doc.transact(() => {
      const elements = doc.getMap<unknown>('elements');
      const positions = doc.getMap<unknown>('positions');
      const order = doc.getMap<unknown>('element-order');
      const record = (fields: Record<string, unknown>) => {
        const map = new Y.Map<unknown>();
        for (const [key, value] of Object.entries(fields)) map.set(key, value);
        return map;
      };
      elements.set('__proto__', record({ kind: 'node', id: '__proto__', label: 'proto' }));
      positions.set('__proto__', record({ x: 50, y: 500 }));
      order.set('__proto__', 0);
      elements.set('Impostor', record({ kind: 'node', id: 'API', label: 'impostor' }));
      elements.set('Junk', 'not a map');
      doc.getMap<unknown>('edges').set('Junk', 5);
      (positions.get('Cache') as Y.Map<unknown>).set('x', 'abc');
      (positions.get('Fila') as Y.Map<unknown>).set('x', Number.NaN);
      (positions.get('DB') as Y.Map<unknown>).set('y', 1e12);
      order.set('Impostor', 6);
      (elements.get('Cache') as Y.Map<unknown>).set('parentId', 'API');
      for (let i = 0; i < 50_000; i++) {
        elements.set(`H${i}`, record({ kind: 'node', id: `H${i}` }));
        order.set(`H${i}`, 100 + i);
      }
    });
    const read = inspectCollaborativeDiagram(doc)!;
    const { model, layout } = read.snapshot;
    expect(Object.hasOwn(model.elements, '__proto__')).toBe(false);
    expect(Object.hasOwn(layout.nodes, '__proto__')).toBe(false);
    expect(model.order).toHaveLength(COLLAB_MAX_ELEMENTS);
    expect(model.order.slice(0, 6)).toEqual(['API', 'DB', 'Cache', 'Fila', 'G1', 'G2']);
    expect(model.order[6]).toBe('Impostor');
    expect(model.elements.Impostor).toEqual({ kind: 'node', id: 'Impostor', label: 'impostor' });
    for (const [key, el] of Object.entries(model.elements)) expect(el.id).toBe(key);
    for (const box of Object.values(layout.nodes)) for (const value of Object.values(box)) expect(Number.isFinite(value)).toBe(true);
    expect(Object.keys(layout.nodes).sort()).toEqual(['API', 'G1', 'G2']);
    expect(model.elements.Cache!.parentId).toBeUndefined();
    expect(new Set(read.repairs.map((repair) => repair.kind))).toEqual(new Set(['id', 'record', 'reserved', 'parent', 'position', 'limit']));
    expect(() => computeRects(model, layout)).not.toThrow();
  }, 30_000);

  it('reads a long description and link whole, so the projection never rewrites valid text', () => {
    const doc = new Y.Doc();
    const snapshot = mapa();
    const description = 'ADR '.repeat(6000);
    const link = `https://grafana.example.com/d/abc?${'var-x=1&'.repeat(300)}`;
    snapshot.model.elements.API = { ...snapshot.model.elements.API!, description, link };
    seedCollaborativeDiagram(doc, snapshot);
    const read = inspectCollaborativeDiagram(doc)!;
    expect(read.repairs).toEqual([]);
    expect(read.snapshot.model.elements.API).toMatchObject({ description, link });
  });

  it('orders elements whose order value is not a finite number last, the same on every peer', () => {
    const updates = [['A', 5], ['Z', 0], ['M', 'x'], ['B', Number.NaN]].map(([id, index]) => {
      const doc = new Y.Doc();
      doc.transact(() => {
        doc.getMap<boolean>('meta').set('initialized', true);
        const record = new Y.Map<unknown>();
        record.set('kind', 'node');
        record.set('id', id);
        doc.getMap<unknown>('elements').set(id as string, record);
        doc.getMap<unknown>('element-order').set(id as string, index);
      });
      return Y.encodeStateAsUpdate(doc);
    });
    for (const order of [[0, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1], [1, 3, 0, 2]]) {
      const doc = new Y.Doc();
      for (const index of order) Y.applyUpdate(doc, updates[index]!);
      expect(readCollaborativeDiagram(doc)!.model.order).toEqual(['Z', 'A', 'B', 'M']);
    }
  });
});


/** The raw doc as plain data, map by map (what every replica must agree on). */
function rawState(doc: Y.Doc) {
  const plain = (value: unknown): unknown => (value instanceof Y.Map ? Object.fromEntries([...value.entries()].map(([key, inner]) => [key, plain(inner)]).sort(([a], [b]) => (a! < b! ? -1 : 1))) : value);
  return Object.fromEntries(['style', 'elements', 'edges', 'positions', 'element-order', 'edge-order'].map((name) => [name, plain(doc.getMap(name))]));
}

/** Every rule the read enforces holds in the raw doc itself, not only in the view. */
function expectCleanRaw(doc: Y.Doc) {
  const read = inspectCollaborativeDiagram(doc)!;
  expect(read.repairs).toEqual([]);
  const raw = rawState(doc) as Record<string, Record<string, unknown>>;
  const { model, layout } = read.snapshot;
  const edges = Object.fromEntries(model.edges.map((edge) => [edge.id, edge]));
  const sorted = (record: object) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, Object.fromEntries(Object.entries(value as object).sort(([a], [b]) => (a < b ? -1 : 1)))]).sort(([a], [b]) => (a < b ? -1 : 1)));
  expect(raw.elements).toEqual(sorted(model.elements));
  expect(raw.edges).toEqual(sorted(edges));
  expect(raw.positions).toEqual(sorted(layout.nodes));
  for (const id of Object.keys(raw['element-order']!)) expect(Object.hasOwn(model.elements, id)).toBe(true);
  for (const id of Object.keys(raw['edge-order']!)) expect(Object.hasOwn(edges, id)).toBe(true);
  for (const value of [...Object.values(raw['element-order']!), ...Object.values(raw['edge-order']!)]) expect(Number.isFinite(value)).toBe(true);
}

describe('repairCollaborativeDiagram (the host writes the read repairs into the doc)', () => {
  /** Everything a merge or a hostile peer can leave behind, in one doc. */
  function dirty(): Y.Doc {
    const { ab } = concurrent([{ op: 'move_to_group', id: 'G1', parentId: 'G2' }, { op: 'connect', from: 'Fila', to: 'DB' }], [{ op: 'move_to_group', id: 'G2', parentId: 'G1' }, { op: 'remove', id: 'Fila' }]);
    ab.transact(() => {
      const elements = ab.getMap<unknown>('elements');
      const record = (fields: Record<string, unknown>) => {
        const map = new Y.Map<unknown>();
        for (const [key, value] of Object.entries(fields)) map.set(key, value);
        return map;
      };
      elements.set('__proto__', record({ kind: 'node', id: '__proto__' }));
      elements.set('Impostor', record({ kind: 'weird', id: 'API', label: 12345, junk: 'x', shape: 'blob', colorMode: 'neon' }));
      elements.set('Junk', 'not a map');
      (elements.get('Cache') as Y.Map<unknown>).set('parentId', 'API');
      (ab.getMap<unknown>('positions').get('DB') as Y.Map<unknown>).set('x', Number.NaN);
      (ab.getMap<unknown>('positions').get('API') as Y.Map<unknown>).set('w', -5);
      ab.getMap<unknown>('positions').set('ghost', record({ x: 1, y: 1 }));
      ab.getMap<unknown>('element-order').set('ghost', 3);
      ab.getMap<unknown>('element-order').set('Cache', Number.NaN);
      ab.getMap<unknown>('edge-order').set('ghost', 0);
      ab.getMap<unknown>('edges').set('X→Y', record({ id: 'other', from: 'API', to: 'DB', connector: 'zz', label: 5 }));
      ab.getMap<unknown>('style').set('extra', 'x');
      ab.getMap<unknown>('style').set('colorMode', 'neon');
    });
    return ab;
  }

  it('writes every repair in one transaction with the given origin; the view does not change and needs no more repairs', () => {
    const doc = dirty();
    const view = readCollaborativeDiagram(doc)!;
    const events: unknown[] = [];
    doc.on('update', (_update: Uint8Array, origin: unknown) => events.push(origin));
    const origin = Symbol('repair');
    const result = repairCollaborativeDiagram(doc, origin);
    expect(events).toEqual([origin]);
    expect(result.update).toBeInstanceOf(Uint8Array);
    expect(new Set(result.repairs.map((repair) => repair.kind))).toEqual(new Set(['cycle', 'edge', 'reserved', 'id', 'field', 'record', 'parent', 'position', 'order']));
    expect(readCollaborativeDiagram(doc)).toEqual(view);
    expectCleanRaw(doc);
    // The CRDT itself lost the hidden state: G2 no longer points at G1, the dangling edge is gone.
    expect((doc.getMap('elements').get('G2') as Y.Map<unknown>).has('parentId')).toBe(false);
    expect(doc.getMap('edges').has('Fila→DB')).toBe(false);
  });

  it('is idempotent: a clean doc (or a second pass) writes nothing at all', () => {
    const doc = dirty();
    repairCollaborativeDiagram(doc);
    const events: unknown[] = [];
    doc.on('update', (_update: Uint8Array, origin: unknown) => events.push(origin));
    expect(repairCollaborativeDiagram(doc)).toEqual({ update: null, repairs: [] });
    const clean = new Y.Doc();
    seedCollaborativeDiagram(clean, mapa());
    clean.on('update', (_update: Uint8Array, origin: unknown) => events.push(origin));
    expect(repairCollaborativeDiagram(clean)).toEqual({ update: null, repairs: [] });
    expect(events).toEqual([]);
  });

  it('its update brings another replica of the same state to the same clean raw doc', () => {
    const doc = dirty();
    const replica = new Y.Doc();
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc));
    const { update } = repairCollaborativeDiagram(doc);
    Y.applyUpdate(replica, update!);
    expect(rawState(replica)).toEqual(rawState(doc));
    expectCleanRaw(replica);
  });

  it('only deletes what it saw: a concurrent peer write to the same key survives the repair', () => {
    const doc = dirty();
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    const vector = Y.encodeStateVector(peer);
    // Concurrently with the host's repair, the peer gives Cache a valid parent and moves API (whose bad w the repair drops).
    (peer.getMap<unknown>('elements').get('Cache') as Y.Map<unknown>).set('parentId', 'G1');
    (peer.getMap<unknown>('positions').get('API') as Y.Map<unknown>).set('x', 42);
    const fromPeer = Y.encodeStateAsUpdate(peer, vector);
    const { update } = repairCollaborativeDiagram(doc);
    Y.applyUpdate(doc, fromPeer);
    Y.applyUpdate(peer, update!);
    expect(rawState(peer)).toEqual(rawState(doc));
    const read = readCollaborativeDiagram(doc)!;
    expect(read.model.elements.Cache!.parentId).toBe('G1');
    expect(read.layout.nodes.API).toEqual({ x: 42, y: 0, h: 60 });
  });

  it('rewrites order values to the positions the view shows, so a local edit on the repaired view reads back as made', () => {
    const doc = new Y.Doc();
    seedCollaborativeDiagram(doc, mapa());
    // Merged or hostile order values: a huge one, a tie, a missing one. The view sorts them; raw values stay arbitrary.
    doc.transact(() => {
      const order = doc.getMap<unknown>('element-order');
      order.set('API', 1e300);
      order.set('DB', 2);
      order.delete('Cache');
      doc.getMap<unknown>('edge-order').set('API→Cache', -7);
    });
    const view = readCollaborativeDiagram(doc)!;
    repairCollaborativeDiagram(doc);
    expect(readCollaborativeDiagram(doc)).toEqual(view);
    expect(Object.fromEntries(doc.getMap('element-order').entries())).toEqual(Object.fromEntries(view.model.order.map((id, index) => [id, index])));
    expect(Object.fromEntries(doc.getMap('edge-order').entries())).toEqual(Object.fromEntries(view.model.edges.map((edge, index) => [edge.id, index])));
    // A node added at the end of the view stays at the end for everyone (before, it sorted before API's 1e300).
    const result = applyOps(view.model, [{ op: 'add_node', id: 'Novo' }]);
    if (!result.ok) throw new Error(result.error.message);
    applyCollaborativeDiagramDelta(doc, view, { model: result.model, layout: view.layout });
    expect(readCollaborativeDiagram(doc)!.model.order).toEqual(result.model.order);
  });

  it('repairedLocalDiagram: a local edit that the host will repair reads as repaired; a clean one needs nothing', () => {
    const ops: DiagramOp[] = [{ op: 'add_node', id: 'API' }];
    for (let i = 0; i < 32; i++) ops.push({ op: 'add_group', id: `L${i}`, ...(i ? { parentId: `L${i - 1}` } : {}) });
    const built = applyOps(emptyModel(), ops);
    if (!built.ok) throw new Error(built.error.message);
    const snapshot = { model: built.model, layout: emptyLayout() };
    expect(repairedLocalDiagram(snapshot)).toBeNull();
    const moved = applyOps(built.model, [{ op: 'move_to_group', id: 'API', parentId: 'L31' }]);
    if (!moved.ok) throw new Error(moved.error.message);
    expect(repairedLocalDiagram({ model: moved.model, layout: emptyLayout() })!.model.elements.API).toEqual({ kind: 'node', id: 'API' });
  });

  it('detaches, in the doc, an element that concurrent valid moves nested past the depth limit', () => {
    const model = emptyModel();
    const nodes: DiagramSnapshot['layout']['nodes'] = {};
    const add = (id: string, parentId?: string) => {
      model.elements[id] = { kind: 'group', id, ...(parentId ? { parentId } : {}) };
      model.order.push(id);
      nodes[id] = { x: 0, y: 0 };
    };
    for (let i = 0; i < 20; i++) add(`X${i}`, i ? `X${i - 1}` : undefined);
    for (let i = 0; i < 14; i++) add(`Y${i}`, i ? `Y${i - 1}` : undefined);
    add('G');
    const server = new Y.Doc();
    seedCollaborativeDiagram(server, { model, layout: { nodes, edges: {} } });
    const seed = Y.encodeStateAsUpdate(server);
    for (const ops of [[{ op: 'move_to_group', id: 'X0', parentId: 'G' }], [{ op: 'move_to_group', id: 'G', parentId: 'Y13' }]] as DiagramOp[][]) {
      const peer = new Y.Doc();
      Y.applyUpdate(peer, seed);
      const vector = Y.encodeStateVector(peer);
      edit(peer, ops);
      Y.applyUpdate(server, Y.encodeStateAsUpdate(peer, vector));
    }
    // Y0…Y13 → G → X0…X19: X17 is the first element with 32 ancestors.
    const read = inspectCollaborativeDiagram(server)!;
    expect(read.repairs).toEqual([{ kind: 'depth', id: 'X17' }]);
    expect(read.snapshot.model.elements.X17!.parentId).toBeUndefined();
    expect(parseDiagramJson(printDiagramJson(read.snapshot.model)).diagnostics).toEqual([]);
    repairCollaborativeDiagram(server);
    expect((server.getMap('elements').get('X17') as Y.Map<unknown>).has('parentId')).toBe(false);
    expect(readCollaborativeDiagram(server)).toEqual(read.snapshot);
    expectCleanRaw(server);
  });
});

it('keeps card presentation, composition roles and ports across replicas',()=>{
 const applied=applyOps(emptyModel(),[{op:'add_node',id:'API',presentation:'card',layoutRole:'entry'},{op:'add_node',id:'Infra',presentation:'card',layoutRole:'shared'},{op:'connect',from:'API',to:'Infra',fromPort:'right',toPort:'right'}]);
 if(!applied.ok)throw new Error(applied.error.message);
 const a=new Y.Doc(),b=new Y.Doc();
 seedCollaborativeDiagram(a,{model:applied.model,layout:{nodes:{API:{x:0,y:0,w:236,h:84},Infra:{x:0,y:240,w:1200,h:84}},edges:{}}});
 exchange(a,b);
 const read=readCollaborativeDiagram(b)!;
 expect(read.model.elements.API).toMatchObject({presentation:'card',layoutRole:'entry'});
 expect(read.model.edges[0]).toMatchObject({fromPort:'right',toPort:'right'});
 expect(read.layout.nodes.Infra?.w).toBe(1200);
});

it('preserves diagram frames through collaboration sanitization, sync and canonical JSON', () => {
  const made = applyOps(emptyModel(), [{ op: 'add_group', id: 'Consulta', canvasFrame: true }, { op: 'add_node', id: 'API', parentId: 'Consulta' }]);
  if (!made.ok) throw Error(made.error.message);
  const a = new Y.Doc(), b = new Y.Doc();
  seedCollaborativeDiagram(a, { model: made.model, layout: emptyLayout() }); exchange(a, b);
  const snapshot = readCollaborativeDiagram(b)!;
  expect(snapshot.model.elements.Consulta).toMatchObject({ kind: 'group', canvasFrame: true });
  expect(parseDiagramJson(printDiagramJson(snapshot.model)).diagnostics).toEqual([]);
  a.destroy(); b.destroy();
});
