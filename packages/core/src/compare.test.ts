import { describe, expect, it } from 'vitest';
import { applyOps } from './applyOps';
import { compareModels, renamesIn } from './compare';
import { emptyModel } from './model';
import type { DiagramModel, DiagramOp, NodeEl } from './model';

function build(ops: DiagramOp[]): DiagramModel {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

const base = build([
  { op: 'add_group', id: 'Serviços' },
  { op: 'add_node', id: 'API', parentId: 'Serviços' },
  { op: 'add_node', id: 'DB', shape: 'cylinder' },
  { op: 'add_node', id: 'Log' },
  { op: 'connect', from: 'API', to: 'DB', label: 'SQL' },
  { op: 'connect', from: 'API', to: 'Log' },
]);

/** compareModels the way the AI draft uses it: renames taken from the batch, everything else by content. */
function afterOps(ops: DiagramOp[]) {
  const result = applyOps(base, ops);
  if (!result.ok) throw new Error(result.error.message);
  return compareModels(base, result.model, renamesIn(base, ops));
}

const none = { added: [], removed: [], changed: [] };

describe('compareModels', () => {
  it('marks reordered sequence messages as changed for version and AI previews', () => {
    const model = build([{ op: 'add_node', id: 'Client', presentation: 'participant' }, { op: 'add_node', id: 'API', presentation: 'participant' }, { op: 'connect', from: 'Client', to: 'API', label: 'Request' }, { op: 'connect', from: 'API', to: 'Client', label: 'Response', connector: '-->' }]);
    const changed = applyOps(model, [{ op: 'reorder', edges: [1, 0] }]);
    if (!changed.ok) throw new Error(changed.error.message);
    expect(compareModels(model, changed.model).edges).toEqual({ added: [], removed: [], changed: ['API→Client', 'Client→API'] });
  });
  it('finds nothing between equal models', () => {
    expect(compareModels(base, structuredClone(base))).toEqual({ elements: none, edges: none, renamed: {}, style: false });
  });

  it('shows insert_between as one new node, one removed edge and two new edges', () => {
    expect(afterOps([{ op: 'insert_between', from: 'API', to: 'DB', node: { id: 'Redis', icon: 'redis' } }])).toEqual({
      elements: { added: ['Redis'], removed: [], changed: [] },
      edges: { added: ['API→Redis', 'Redis→DB'], removed: ['API→DB'], changed: [] },
      renamed: {},
      style: false,
    });
  });

  it('follows renames: the element is changed, its edges survive', () => {
    const changes = afterOps([
      { op: 'rename', id: 'API', to: 'Gateway' },
      { op: 'rename', id: 'Gateway', to: 'Borda' },
      { op: 'update', id: 'DB', set: { color: 'red' } },
    ]);
    expect(changes).toEqual({ elements: { added: [], removed: [], changed: ['Borda', 'DB'] }, edges: none, renamed: { API: 'Borda' }, style: false });
  });

  it('marks moves between groups, edge edits and style changes', () => {
    const changes = afterOps([
      { op: 'move_to_group', id: 'API', parentId: null },
      { op: 'update_edge', edgeId: 'API→DB', set: { connector: '-->' } },
      { op: 'set_style', set: { direction: 'down' } },
    ]);
    expect(changes.elements).toEqual({ added: [], removed: [], changed: ['API'] });
    expect(changes.edges).toEqual({ added: [], removed: [], changed: ['API→DB'] });
    expect(changes.style).toBe(true);
  });

  it('lists everything a removed group takes with it', () => {
    expect(afterOps([{ op: 'remove', id: 'Serviços' }])).toMatchObject({
      elements: { added: [], removed: ['Serviços', 'API'], changed: [] },
      edges: { added: [], removed: ['API→DB', 'API→Log'], changed: [] },
    });
  });

  it('matches edges by content, not by id, and survives renumbering', () => {
    const twin = build([
      { op: 'add_node', id: 'A' },
      { op: 'add_node', id: 'B' },
      { op: 'connect', from: 'A', to: 'B', label: 'um' },
      { op: 'connect', from: 'A', to: 'B', label: 'dois' },
    ]);
    const result = applyOps(twin, [{ op: 'remove_edge', edgeId: 'A→B' }]);
    if (!result.ok) throw new Error(result.error.message);
    // The survivor is renumbered from A→B#2 to A→B: still the same edge ("dois").
    expect(compareModels(twin, result.model).edges).toEqual({ added: [], removed: ['A→B'], changed: [] });
    const relabeled = applyOps(twin, [{ op: 'update_edge', edgeId: 'A→B#2', set: { label: 'três' } }]);
    if (!relabeled.ok) throw new Error(relabeled.error.message);
    expect(compareModels(twin, relabeled.model).edges).toEqual({ added: [], removed: [], changed: ['A→B#2'] });
  });

  it('matches by id without a batch (version compare)', () => {
    const next = build([
      { op: 'add_group', id: 'Serviços' },
      { op: 'add_node', id: 'API', parentId: 'Serviços' },
      { op: 'add_node', id: 'DB', shape: 'cylinder' },
      { op: 'add_node', id: 'Fila' },
      { op: 'connect', from: 'API', to: 'DB', label: 'SQL' },
      { op: 'connect', from: 'API', to: 'Fila' },
    ]);
    expect(compareModels(base, next)).toEqual({
      elements: { added: ['Fila'], removed: ['Log'], changed: [] },
      edges: { added: ['API→Fila'], removed: ['API→Log'], changed: [] },
      renamed: {},
      style: false,
    });
  });
});

describe('compareModels with hostile names', () => {
  it('never matches names against Object.prototype', () => {
    const node = (id: string): NodeEl => ({ kind: 'node', id });
    const odd: DiagramModel = { ...emptyModel(), elements: { toString: node('toString'), constructor: node('constructor') }, order: ['toString', 'constructor'] };
    expect(compareModels(odd, emptyModel()).elements.removed).toEqual(['toString', 'constructor']);
    expect(compareModels(emptyModel(), odd, { constructor: 'x' }).elements.added).toEqual(['toString', 'constructor']);
    // A plain `renamed[id]` lookup "finds" Object.prototype.toString/.constructor (truthy, so `?? id` never
    // falls back to the id): every element would show up as both removed and added against itself.
    expect(compareModels(odd, odd)).toMatchObject({ elements: { added: [], removed: [], changed: [] }, renamed: {} });
    expect(compareModels(odd, odd, { toString: 'toString' })).toMatchObject({ elements: { added: [], removed: [], changed: [] } });
  });
});

describe('renamesIn', () => {
  it('maps original ids to final ids and ignores elements created in the batch', () => {
    expect(renamesIn(base, [
      { op: 'rename', id: 'DB', to: 'Banco' },
      { op: 'add_node', id: 'Novo' },
      { op: 'rename', id: 'Novo', to: 'Outro' },
      { op: 'rename', id: 'Banco', to: 'Postgres' },
    ])).toEqual({ DB: 'Postgres' });
  });
});
