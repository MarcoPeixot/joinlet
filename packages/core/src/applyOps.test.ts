import { describe, expect, it } from 'vitest';
import { applyOps, normalizeEdgeIds } from './applyOps';
import { own } from './ids';
import { emptyModel } from './model';
import type { DiagramModel, DiagramOp } from './model';

function build(ops: DiagramOp[]): DiagramModel {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

describe('applyOps', () => {
  it('preserves descriptions when creating nodes, groups and inserted components', () => {
    const model = build([
      { op: 'add_group', id: 'Backend', description: 'Processa as solicitações.' },
      { op: 'add_node', id: 'API', parentId: 'Backend', description: 'Valida e encaminha pedidos.' },
      { op: 'add_node', id: 'Banco', description: '' },
      { op: 'connect', from: 'API', to: 'Banco' },
      { op: 'insert_between', from: 'API', to: 'Banco', node: { id: 'Cache', description: 'Mantém respostas frequentes.' } },
    ]);
    expect(model.elements.Backend!.description).toBe('Processa as solicitações.');
    expect(model.elements.API!.description).toBe('Valida e encaminha pedidos.');
    expect(model.elements.Cache!.description).toBe('Mantém respostas frequentes.');
    expect(model.elements.Banco).not.toHaveProperty('description');
    const result = applyOps(model, [{ op: 'update', id: 'API', set: { label: 'Alterada' } }, { op: 'add_node', id: 'Inválido', description: 42 } as unknown as DiagramOp]);
    expect(result.ok).toBe(false);
    expect(model.elements.API!.label).toBeUndefined();
    expect(model.elements.Inválido).toBeUndefined();
  });

  it('validates table fields atomically and does not retain mutable operation data', () => {
    const fields = [{ name: 'id', type: 'uuid', key: 'PK' as const }];
    const model = build([{ op: 'add_node', id: 'Users', presentation: 'table', fields }]);
    fields[0]!.name = 'mutated';
    expect(model.elements.Users!.fields![0]!.name).toBe('id');
    const invalid = applyOps(model, [{ op: 'update', id: 'Users', set: { label: 'Changed' } }, { op: 'update', id: 'Users', set: { fields: [{ name: '' }] } }]);
    expect(invalid.ok).toBe(false);
    expect(model.elements.Users!.label).toBeUndefined();
    const cleared = applyOps(model, [{ op: 'update', id: 'Users', set: { fields: null } }]);
    if (!cleared.ok) throw new Error(cleared.error.message);
    expect(cleared.model.elements.Users!.fields).toBeUndefined();
  });
  it('adds nodes in declaration order', () => {
    const m = build([{ op: 'add_node', id: 'API' }, { op: 'add_node', id: 'DB', shape: 'cylinder' }]);
    expect(m.order).toEqual(['API', 'DB']);
    expect(m.elements.DB).toEqual({ kind: 'node', id: 'DB', shape: 'cylinder' });
  });

  it('rejects duplicate names', () => {
    const result = applyOps(build([{ op: 'add_node', id: 'API' }]), [{ op: 'add_node', id: 'API' }]);
    expect(result).toEqual({ ok: false, error: { opIndex: 0, message: 'Já existe um elemento chamado "API".' } });
  });

  it('suggests a close name for unknown references', () => {
    const result = applyOps(build([{ op: 'add_node', id: 'Database' }]), [
      { op: 'connect', from: 'Databse', to: 'Database' },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Você quis dizer "Database"?');
  });

  it('is atomic: a failing op discards the whole batch', () => {
    const base = emptyModel();
    const result = applyOps(base, [{ op: 'add_node', id: 'A' }, { op: 'connect', from: 'A', to: 'Z' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.opIndex).toBe(1);
    expect(base.order).toEqual([]);
  });

  it('nests nodes in groups and rejects non-group parents', () => {
    const m = build([{ op: 'add_group', id: 'VPC' }, { op: 'add_node', id: 'API', parentId: 'VPC' }]);
    expect(m.elements.API?.parentId).toBe('VPC');
    expect(applyOps(m, [{ op: 'add_node', id: 'X', parentId: 'API' }]).ok).toBe(false);
  });

  it('derives stable edge ids and numbers duplicates', () => {
    const m = build([
      { op: 'add_node', id: 'A' },
      { op: 'add_node', id: 'B' },
      { op: 'connect', from: 'A', to: 'B', label: 'HTTP' },
      { op: 'connect', from: 'A', to: 'B', connector: '-->' },
    ]);
    expect(m.edges.map((e) => e.id)).toEqual(['A→B', 'A→B#2']);
    expect(m.edges[0]).toEqual({ id: 'A→B', from: 'A', to: 'B', connector: '>', label: 'HTTP' });
  });

  describe('canonical edge ids', () => {
    const step = (m: DiagramModel, ops: DiagramOp[]): DiagramModel => {
      const result = applyOps(m, ops);
      if (!result.ok) throw new Error(result.error.message);
      return result.model;
    };
    const idsAndLabels = (m: DiagramModel) => m.edges.map((e) => [e.id, e.label]);
    const pair = build([
      { op: 'add_node', id: 'A' },
      { op: 'add_node', id: 'B' },
      { op: 'add_node', id: 'C' },
      { op: 'connect', from: 'A', to: 'B', label: 'one' },
      { op: 'connect', from: 'A', to: 'B', label: 'two' },
    ]);

    it('renumbers after removing an edge, so ids do not depend on history', () => {
      const removed = step(pair, [{ op: 'remove_edge', edgeId: 'A→B' }]);
      expect(idsAndLabels(removed)).toEqual([['A→B', 'two']]);
      const connected = step(removed, [{ op: 'connect', from: 'A', to: 'B', label: 'three' }]);
      expect(idsAndLabels(connected)).toEqual([['A→B', 'two'], ['A→B#2', 'three']]);
      expect(step(connected, [{ op: 'rename', id: 'C', to: 'D' }]).edges).toEqual(connected.edges);
    });

    it('renumbers the remaining duplicate after insert_between', () => {
      const m = step(pair, [{ op: 'insert_between', from: 'A', to: 'B', node: { id: 'X' } }]);
      expect(idsAndLabels(m)).toEqual([['A→X', 'one'], ['X→B', undefined], ['A→B', 'two']]);
    });

    it('keeps ids stable inside a batch and normalizes them when it commits', () => {
      const m = step(pair, [
        { op: 'remove_edge', edgeId: 'A→B' },
        { op: 'rename', id: 'C', to: 'D' },
        { op: 'update_edge', edgeId: 'A→B#2', set: { label: 'dois' } },
      ]);
      expect(idsAndLabels(m)).toEqual([['A→B', 'dois']]);
    });

    it('reports where each surviving edge id went', () => {
      const three = step(pair, [{ op: 'connect', from: 'A', to: 'B', label: 'three' }]);
      const result = applyOps(three, [
        { op: 'remove_edge', edgeId: 'A→B' },
        { op: 'rename', id: 'B', to: 'DB' },
        { op: 'connect', from: 'A', to: 'C' },
      ]);
      expect(result.ok && result.edgeIds).toEqual({ 'A→B#2': 'A→DB', 'A→B#3': 'A→DB#2' });
    });

    it('rewrites the ids of edges touching a renamed element', () => {
      const m = step(pair, [{ op: 'rename', id: 'A', to: 'API' }]);
      expect(idsAndLabels(m)).toEqual([['API→B', 'one'], ['API→B#2', 'two']]);
    });
  });

  it('normalizes loaded edge ids', () => {
    const m = build([{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }, { op: 'connect', from: 'A', to: 'B' }]);
    const stale = { ...m, edges: [{ ...m.edges[0]!, id: 'A→B#2' }] };
    expect(normalizeEdgeIds(stale).edges.map((e) => e.id)).toEqual(['A→B']);
    expect(normalizeEdgeIds(m)).toEqual(m);
  });

  it('rejects self connections', () => {
    expect(applyOps(build([{ op: 'add_node', id: 'A' }]), [{ op: 'connect', from: 'A', to: 'A' }]).ok).toBe(false);
  });

  it('inserts a node between two connected nodes keeping the label on the first hop', () => {
    const m = build([
      { op: 'add_node', id: 'API' },
      { op: 'add_node', id: 'DB' },
      { op: 'connect', from: 'API', to: 'DB', label: 'SQL' },
      { op: 'insert_between', from: 'API', to: 'DB', node: { id: 'Cache', icon: 'redis' } },
    ]);
    expect(m.edges.map((e) => [e.from, e.to, e.label])).toEqual([
      ['API', 'Cache', 'SQL'],
      ['Cache', 'DB', undefined],
    ]);
    expect(m.elements.Cache).toEqual({ kind: 'node', id: 'Cache', icon: 'redis' });
  });

  it('updates and clears properties', () => {
    const m = build([
      { op: 'add_node', id: 'A', color: 'blue' },
      { op: 'update', id: 'A', set: { color: null, icon: 'server', shape: 'diamond' } },
    ]);
    expect(m.elements.A).toEqual({ kind: 'node', id: 'A', icon: 'server', shape: 'diamond' });
  });

  it('treats an empty property as absent when adding, as update does', () => {
    const m = build([
      { op: 'add_node', id: 'A', label: '', icon: '', color: '', tech: '', parentId: '' },
      { op: 'add_group', id: 'G', label: '', icon: '', color: '' },
      { op: 'connect', from: 'A', to: 'G', label: '', color: '' },
      { op: 'insert_between', from: 'A', to: 'G', node: { id: 'M', label: '', icon: '', tech: '' } },
    ]);
    expect(m.elements.A).toEqual({ kind: 'node', id: 'A' });
    expect(m.elements.G).toEqual({ kind: 'group', id: 'G' });
    expect(m.elements.M).toEqual({ kind: 'node', id: 'M' });
    expect(m.edges).toEqual([
      { id: 'A→M', from: 'A', to: 'M', connector: '>' },
      { id: 'M→G', from: 'M', to: 'G', connector: '>' },
    ]);
  });

  it('validates enum values and forbids shape on groups', () => {
    const m = build([{ op: 'add_node', id: 'A' }, { op: 'add_group', id: 'G' }]);
    expect(applyOps(m, [{ op: 'update', id: 'A', set: { shape: 'blob' as never } }]).ok).toBe(false);
    expect(applyOps(m, [{ op: 'update', id: 'G', set: { shape: 'diamond' } }]).ok).toBe(false);
  });

  it('keeps the edge id when changing the connector', () => {
    const m = build([
      { op: 'add_node', id: 'A' },
      { op: 'add_node', id: 'B' },
      { op: 'connect', from: 'A', to: 'B', label: 'x' },
      { op: 'update_edge', edgeId: 'A→B', set: { connector: '<>', label: null } },
    ]);
    expect(m.edges).toEqual([{ id: 'A→B', from: 'A', to: 'B', connector: '<>' }]);
  });

  it('renames an element everywhere', () => {
    const m = build([
      { op: 'add_group', id: 'G' },
      { op: 'add_node', id: 'A', parentId: 'G' },
      { op: 'add_node', id: 'B' },
      { op: 'connect', from: 'A', to: 'B' },
      { op: 'rename', id: 'G', to: 'Core' },
      { op: 'rename', id: 'A', to: 'API' },
    ]);
    expect(m.order).toEqual(['Core', 'API', 'B']);
    expect(m.elements.API?.parentId).toBe('Core');
    expect(m.edges[0]).toMatchObject({ id: 'API→B', from: 'API', to: 'B' });
  });

  it('prevents containment cycles', () => {
    const m = build([{ op: 'add_group', id: 'Outer' }, { op: 'add_group', id: 'Inner', parentId: 'Outer' }]);
    expect(applyOps(m, [{ op: 'move_to_group', id: 'Outer', parentId: 'Inner' }]).ok).toBe(false);
    const moved = build([{ op: 'add_group', id: 'G' }, { op: 'add_node', id: 'A', parentId: 'G' }, { op: 'move_to_group', id: 'A', parentId: null }]);
    expect(moved.elements.A?.parentId).toBeUndefined();
  });

  it('removes a group with its descendants and touching edges', () => {
    const m = build([
      { op: 'add_group', id: 'G' },
      { op: 'add_node', id: 'A', parentId: 'G' },
      { op: 'add_node', id: 'B' },
      { op: 'connect', from: 'A', to: 'B' },
      { op: 'remove', id: 'G' },
    ]);
    expect(m.order).toEqual(['B']);
    expect(m.edges).toEqual([]);
  });

  it('rejects unknown operations', () => {
    const result = applyOps(emptyModel(), [{ op: 'add_nodes' } as never]);
    expect(result).toEqual({ ok: false, error: { opIndex: 0, message: 'Operação desconhecida: "add_nodes".' } });
  });

  it('validates diagram style values', () => {
    const m = build([{ op: 'set_style', set: { colorMode: 'bold', typeface: 'clean' } }]);
    expect(m.style).toMatchObject({ colorMode: 'bold', typeface: 'clean', styleMode: 'shadow' });
    expect(applyOps(m, [{ op: 'set_style', set: { direction: 'sideways' as never } }]).ok).toBe(false);
  });
});

describe('reorder', () => {
  const m = build([
    { op: 'add_node', id: 'A' },
    { op: 'add_node', id: 'B' },
    { op: 'add_node', id: 'C' },
    { op: 'connect', from: 'A', to: 'B', label: 'um' },
    { op: 'connect', from: 'A', to: 'B', label: 'dois' },
    { op: 'connect', from: 'B', to: 'C' },
  ]);

  it('reorders elements and edges, renumbering duplicate edge ids', () => {
    const result = applyOps(m, [{ op: 'reorder', order: ['C', 'A', 'B'], edges: [2, 1, 0] }]);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.model.order).toEqual(['C', 'A', 'B']);
    expect(result.model.edges.map((e) => [e.id, e.label])).toEqual([['B→C', undefined], ['A→B', 'dois'], ['A→B#2', 'um']]);
  });

  it('rejects anything that is not a permutation', () => {
    for (const op of [
      { op: 'reorder', order: ['A', 'B'] },
      { op: 'reorder', order: ['A', 'A', 'B'] },
      { op: 'reorder', edges: [0, 0, 1] },
      { op: 'reorder', edges: [0, 1, 3] },
    ] as DiagramOp[]) {
      expect(applyOps(m, [op]).ok).toBe(false);
    }
  });
});

describe('names that collide with Object.prototype', () => {
  const polluted = () => ['label', 'tech', 'kind', 'parentId'].filter((key) => key in {});

  it('rejects "__proto__" as a name and never touches Object.prototype', () => {
    const m = build([{ op: 'add_node', id: 'API' }]);
    for (const op of [
      { op: 'add_node', id: '__proto__' },
      { op: 'add_group', id: '__proto__' },
      { op: 'rename', id: 'API', to: '__proto__' },
    ] as DiagramOp[]) {
      expect(applyOps(m, [op])).toEqual({ ok: false, error: { opIndex: 0, message: 'O nome "__proto__" é reservado.' } });
    }
    expect(applyOps(m, [{ op: 'update', id: '__proto__', set: { tech: 'x', label: 'y' } }])).toEqual({
      ok: false,
      error: { opIndex: 0, message: 'Elemento "__proto__" não existe.' },
    });
    expect(applyOps(m, [{ op: 'add_node', id: 'X', parentId: '__proto__' }]).ok).toBe(false);
    expect(polluted()).toEqual([]);
  });

  it('treats "constructor", "toString" and friends as ordinary names', () => {
    const empty = build([{ op: 'add_node', id: 'API' }]);
    expect(applyOps(empty, [{ op: 'update', id: 'constructor', set: { label: 'x' } }])).toMatchObject({ ok: false });
    expect(applyOps(empty, [{ op: 'connect', from: 'toString', to: 'API' }])).toMatchObject({ ok: false });
    const m = build([
      { op: 'add_node', id: 'API' },
      { op: 'add_node', id: 'constructor' },
      { op: 'add_group', id: 'toString' },
      { op: 'add_node', id: 'hasOwnProperty', parentId: 'toString' },
      { op: 'connect', from: 'constructor', to: 'API' },
      { op: 'update', id: 'constructor', set: { label: 'Construtor' } },
      { op: 'rename', id: 'API', to: 'valueOf' },
    ]);
    expect(m.order).toEqual(['valueOf', 'constructor', 'toString', 'hasOwnProperty']);
    expect(own(m.elements, 'constructor')).toEqual({ kind: 'node', id: 'constructor', label: 'Construtor' });
    expect(m.edges.map((e) => e.id)).toEqual(['constructor→valueOf']);
    expect(applyOps(m, [{ op: 'remove', id: 'toString' }])).toMatchObject({ ok: true, model: { order: ['valueOf', 'constructor'] } });
    expect(polluted()).toEqual([]);
  });
});
