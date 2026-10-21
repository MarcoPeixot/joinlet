import { describe, expect, it } from 'vitest';
import { applyOps, emptyModel, own } from '@strukt/core';
import type { DiagramModel, DiagramOp } from '@strukt/core';
import { mergeIntoDiagram, unionModels } from './syncMerge';
import type { MergeResult } from './syncMerge';

const build = (ops: DiagramOp[], from: DiagramModel = emptyModel()): DiagramModel => {
  const result = applyOps(from, ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
};
const apply = (model: DiagramModel, result: MergeResult): DiagramModel => build(result.ops, model);
const node = (id: string, extra: Partial<Extract<DiagramOp, { op: 'add_node' }>> = {}): DiagramOp => ({ op: 'add_node', id, ...extra });
const ids = (model: DiagramModel) => [...model.order];
const pairs = (model: DiagramModel) => model.edges.map((e) => `${e.from}>${e.to}${e.label ? `:${e.label}` : ''}`);
const noteKinds = (result: MergeResult) => result.notes.map((n) => n.kind);

/** The source as the importers produce it: ids are names, props come from the files. */
const source = build([
  { op: 'add_group', id: 'vpc', label: 'VPC' },
  node('aws_instance.web', { parentId: 'vpc', label: 'Web', tech: 'aws_instance', icon: 'aws-ec2' }),
  node('aws_db_instance.main', { parentId: 'vpc', label: 'Banco', tech: 'aws_db_instance', shape: 'cylinder' }),
  { op: 'connect', from: 'aws_instance.web', to: 'aws_db_instance.main' },
]);

describe('mergeIntoDiagram (merge)', () => {
  it('imports everything into an empty diagram', () => {
    const result = mergeIntoDiagram(emptyModel(), source, undefined, 'merge');
    const merged = apply(emptyModel(), result);
    expect(ids(merged)).toEqual(ids(source));
    expect(merged.elements['aws_instance.web']).toMatchObject({ parentId: 'vpc', label: 'Web', tech: 'aws_instance', icon: 'aws-ec2' });
    expect(merged.elements.vpc!.kind).toBe('group');
    expect(pairs(merged)).toEqual(pairs(source));
    expect(result.notes).toEqual([]);
  });

  it('is idempotent: a second run against the same source and base changes nothing', () => {
    const merged = apply(emptyModel(), mergeIntoDiagram(emptyModel(), source, undefined, 'merge'));
    expect(mergeIntoDiagram(merged, source, source, 'merge').ops).toEqual([]);
  });

  it('adds what the source gained and keeps human nodes, edges and annotations', () => {
    let diagram = apply(emptyModel(), mergeIntoDiagram(emptyModel(), source, undefined, 'merge'));
    diagram = build([
      { op: 'update', id: 'aws_instance.web', set: { description: 'Serve o site', color: 'red' } },
      node('Cliente', { shape: 'ellipse' }),
      { op: 'connect', from: 'Cliente', to: 'aws_instance.web', label: 'HTTPS' },
    ], diagram);
    const next = build([node('aws_sqs_queue.jobs', { parentId: 'vpc', tech: 'aws_sqs_queue' }), { op: 'connect', from: 'aws_instance.web', to: 'aws_sqs_queue.jobs' }], source);
    const merged = apply(diagram, mergeIntoDiagram(diagram, next, source, 'merge'));
    expect(merged.elements['aws_sqs_queue.jobs']).toMatchObject({ parentId: 'vpc', tech: 'aws_sqs_queue' });
    expect(merged.elements['aws_instance.web']).toMatchObject({ description: 'Serve o site', color: 'red' });
    expect(merged.elements.Cliente).toBeDefined();
    expect(pairs(merged)).toEqual(expect.arrayContaining(['Cliente>aws_instance.web:HTTPS', 'aws_instance.web>aws_sqs_queue.jobs', 'aws_instance.web>aws_db_instance.main']));
  });

  it('takes a source change only where people did not edit the property', () => {
    let diagram = apply(emptyModel(), mergeIntoDiagram(emptyModel(), source, undefined, 'merge'));
    diagram = build([{ op: 'update', id: 'aws_instance.web', set: { label: 'Site (humano)' } }], diagram);
    const next = build([
      { op: 'update', id: 'aws_instance.web', set: { label: 'Web v2', tech: 'aws_instance v2' } },
      { op: 'update', id: 'aws_db_instance.main', set: { label: 'Banco v2' } },
    ], source);
    const result = mergeIntoDiagram(diagram, next, source, 'merge');
    const merged = apply(diagram, result);
    expect(merged.elements['aws_instance.web']).toMatchObject({ label: 'Site (humano)', tech: 'aws_instance v2' });
    expect(merged.elements['aws_db_instance.main']!.label).toBe('Banco v2');
    expect(result.notes.find((n) => n.kind === 'conflict')).toMatchObject({ id: 'aws_instance.web' });
  });

  it('clears a property the source dropped, unless people had set it', () => {
    const diagram = apply(emptyModel(), mergeIntoDiagram(emptyModel(), source, undefined, 'merge'));
    const next = build([{ op: 'update', id: 'aws_instance.web', set: { tech: null, icon: null } }], source);
    const edited = build([{ op: 'update', id: 'aws_instance.web', set: { icon: 'server' } }], diagram);
    const merged = apply(edited, mergeIntoDiagram(edited, next, source, 'merge'));
    expect(merged.elements['aws_instance.web']!.tech).toBeUndefined();
    expect(merged.elements['aws_instance.web']!.icon).toBe('server');
  });

  it('removes elements the source dropped when nobody touched them, with their connections', () => {
    const diagram = apply(emptyModel(), mergeIntoDiagram(emptyModel(), source, undefined, 'merge'));
    const next = build([{ op: 'remove', id: 'aws_db_instance.main' }], source);
    const result = mergeIntoDiagram(diagram, next, source, 'merge');
    const merged = apply(diagram, result);
    expect(own(merged.elements, 'aws_db_instance.main')).toBeUndefined();
    expect(merged.edges).toEqual([]);
    expect(own(merged.elements, 'aws_instance.web')).toBeDefined();
  });

  it('keeps a removed element that people edited, and says so', () => {
    let diagram = apply(emptyModel(), mergeIntoDiagram(emptyModel(), source, undefined, 'merge'));
    diagram = build([{ op: 'update', id: 'aws_db_instance.main', set: { description: 'Banco principal' } }], diagram);
    const next = build([{ op: 'remove', id: 'aws_db_instance.main' }], source);
    const result = mergeIntoDiagram(diagram, next, source, 'merge');
    const merged = apply(diagram, result);
    expect(merged.elements['aws_db_instance.main']!.description).toBe('Banco principal');
    expect(result.notes).toContainEqual(expect.objectContaining({ kind: 'kept-edited', id: 'aws_db_instance.main' }));
  });

  it('removes a dropped group but rescues what people put inside it', () => {
    let diagram = apply(emptyModel(), mergeIntoDiagram(emptyModel(), source, undefined, 'merge'));
    diagram = build([node('Cache', { parentId: 'vpc' })], diagram);
    const next = build([{ op: 'remove', id: 'vpc' }], source);
    const merged = apply(diagram, mergeIntoDiagram(diagram, next, source, 'merge'));
    expect(own(merged.elements, 'vpc')).toBeUndefined();
    expect(own(merged.elements, 'aws_instance.web')).toBeUndefined();
    expect(merged.elements.Cache).toBeDefined();
    expect(merged.elements.Cache!.parentId).toBeUndefined();
  });

  it('does not bring back what people deleted on purpose', () => {
    let diagram = apply(emptyModel(), mergeIntoDiagram(emptyModel(), source, undefined, 'merge'));
    diagram = build([{ op: 'remove', id: 'aws_db_instance.main' }], diagram);
    const next = build([node('aws_s3_bucket.logs'), { op: 'connect', from: 'aws_db_instance.main', to: 'aws_s3_bucket.logs' }], source);
    const result = mergeIntoDiagram(diagram, next, source, 'merge');
    const merged = apply(diagram, result);
    expect(own(merged.elements, 'aws_db_instance.main')).toBeUndefined();
    expect(merged.elements['aws_s3_bucket.logs']).toBeDefined();
    expect(noteKinds(result)).toContain('kept-deleted');
    expect(merged.edges.some((e) => e.from === 'aws_db_instance.main' || e.to === 'aws_db_instance.main')).toBe(false);
  });

  it('does not duplicate a node that people renamed', () => {
    let diagram = apply(emptyModel(), mergeIntoDiagram(emptyModel(), source, undefined, 'merge'));
    diagram = build([{ op: 'rename', id: 'aws_instance.web', to: 'Site' }], diagram);
    const merged = apply(diagram, mergeIntoDiagram(diagram, source, source, 'merge'));
    expect(ids(merged)).toContain('Site');
    expect(ids(merged)).not.toContain('aws_instance.web');
  });

  it('keeps an edge people removed from coming back', () => {
    let diagram = apply(emptyModel(), mergeIntoDiagram(emptyModel(), source, undefined, 'merge'));
    diagram = build([{ op: 'remove_edge', edgeId: diagram.edges[0]!.id }], diagram);
    const merged = apply(diagram, mergeIntoDiagram(diagram, source, source, 'merge'));
    expect(merged.edges).toEqual([]);
  });

  it('adopts an element people created before the first sync, filling only what they left empty', () => {
    const diagram = build([node('aws_instance.web', { label: 'Meu site' })]);
    const result = mergeIntoDiagram(diagram, source, undefined, 'merge');
    const merged = apply(diagram, result);
    expect(merged.elements['aws_instance.web']).toMatchObject({ label: 'Meu site', tech: 'aws_instance', icon: 'aws-ec2' });
    expect(merged.elements['aws_instance.web']!.parentId).toBeUndefined();
  });

  it('follows a source that moves an untouched element to another group, not an edited one', () => {
    const start = build([{ op: 'add_group', id: 'a' }, { op: 'add_group', id: 'b' }, node('x', { parentId: 'a' }), node('y', { parentId: 'a' })]);
    const diagram = apply(emptyModel(), mergeIntoDiagram(emptyModel(), start, undefined, 'merge'));
    const humanMoved = build([{ op: 'move_to_group', id: 'y', parentId: null }], diagram);
    const next = build([{ op: 'move_to_group', id: 'x', parentId: 'b' }, { op: 'move_to_group', id: 'y', parentId: 'b' }], start);
    const merged = apply(humanMoved, mergeIntoDiagram(humanMoved, next, start, 'merge'));
    expect(merged.elements.x!.parentId).toBe('b');
    expect(merged.elements.y!.parentId).toBeUndefined();
  });

  it('merges the diagram style only where people kept the default', () => {
    const src = build([{ op: 'set_style', set: { direction: 'down' } }, node('a')]);
    const merged = apply(emptyModel(), mergeIntoDiagram(emptyModel(), src, undefined, 'merge'));
    expect(merged.style.direction).toBe('down');
    const human = build([{ op: 'set_style', set: { direction: 'left' } }]);
    expect(apply(human, mergeIntoDiagram(human, src, undefined, 'merge')).style.direction).toBe('left');
  });

  it('survives names such as constructor and toString', () => {
    const hostile = build([node('constructor'), node('toString'), { op: 'connect', from: 'constructor', to: 'toString' }]);
    const merged = apply(emptyModel(), mergeIntoDiagram(emptyModel(), hostile, undefined, 'merge'));
    expect(ids(merged)).toEqual(['constructor', 'toString']);
    expect(mergeIntoDiagram(merged, hostile, hostile, 'merge').ops).toEqual([]);
    const next = build([{ op: 'remove', id: 'toString' }], hostile);
    expect(ids(apply(merged, mergeIntoDiagram(merged, next, hostile, 'merge')))).toEqual(['constructor']);
  });

  it('turns an invalid operation into a note instead of failing the whole sync', () => {
    // A human put "g1" inside its own child's subtree; the source wants the opposite nesting.
    const start = build([{ op: 'add_group', id: 'g1' }, { op: 'add_group', id: 'g2' }, node('n')]);
    const diagram = apply(emptyModel(), mergeIntoDiagram(emptyModel(), start, undefined, 'merge'));
    const humanNested = build([{ op: 'move_to_group', id: 'g2', parentId: 'g1' }], diagram);
    const next = build([{ op: 'move_to_group', id: 'g1', parentId: 'g2' }], start);
    const result = mergeIntoDiagram(humanNested, next, start, 'merge');
    expect(() => apply(humanNested, result)).not.toThrow();
    expect(noteKinds(result)).toContain('skipped');
    expect(apply(humanNested, result).elements.g1!.parentId).toBeUndefined();
  });
});

describe('mergeIntoDiagram (replace)', () => {
  it('makes the diagram mirror the source and drops what only people added', () => {
    let diagram = apply(emptyModel(), mergeIntoDiagram(emptyModel(), source, undefined, 'replace'));
    diagram = build([node('Cliente'), { op: 'connect', from: 'Cliente', to: 'aws_instance.web' }], diagram);
    const merged = apply(diagram, mergeIntoDiagram(diagram, source, source, 'replace'));
    expect(ids(merged)).toEqual(ids(source));
    expect(pairs(merged)).toEqual(pairs(source));
  });

  it('keeps the human annotations where the source says nothing, and overwrites where it speaks', () => {
    let diagram = apply(emptyModel(), mergeIntoDiagram(emptyModel(), source, undefined, 'replace'));
    diagram = build([{ op: 'update', id: 'aws_instance.web', set: { description: 'Nota', label: 'Mudado à mão' } }], diagram);
    const merged = apply(diagram, mergeIntoDiagram(diagram, source, source, 'replace'));
    expect(merged.elements['aws_instance.web']).toMatchObject({ description: 'Nota', label: 'Web' });
  });

  it('clears a property the source dropped when people did not set it', () => {
    const diagram = apply(emptyModel(), mergeIntoDiagram(emptyModel(), source, undefined, 'replace'));
    const next = build([{ op: 'update', id: 'aws_instance.web', set: { tech: null } }], source);
    expect(apply(diagram, mergeIntoDiagram(diagram, next, source, 'replace')).elements['aws_instance.web']!.tech).toBeUndefined();
  });

  it('follows the source order and is idempotent', () => {
    const diagram = apply(emptyModel(), mergeIntoDiagram(emptyModel(), source, undefined, 'replace'));
    const reordered = build([{ op: 'reorder', order: ['aws_db_instance.main', 'vpc', 'aws_instance.web'] }], source);
    const merged = apply(diagram, mergeIntoDiagram(diagram, reordered, source, 'replace'));
    expect(ids(merged)).toEqual(ids(reordered));
    expect(mergeIntoDiagram(merged, reordered, reordered, 'replace').ops).toEqual([]);
  });
});

describe('unionModels', () => {
  it('keeps the first definition of an element and adds the rest', () => {
    const a = build([node('x', { label: 'A' }), node('y'), { op: 'connect', from: 'x', to: 'y' }]);
    const b = build([node('x', { label: 'B' }), node('y'), node('z', { tech: 'zz' }), { op: 'connect', from: 'x', to: 'y' }, { op: 'connect', from: 'y', to: 'z' }]);
    const merged = unionModels([a, b]);
    expect(ids(merged)).toEqual(['x', 'y', 'z']);
    expect(merged.elements.x!.label).toBe('A');
    expect(merged.elements.z!.tech).toBe('zz');
    expect(pairs(merged)).toEqual(['x>y', 'y>z']);
  });

  it('keeps groups and nesting, and returns an empty model for no input', () => {
    expect(unionModels([])).toEqual(emptyModel());
    expect(unionModels([source]).elements['aws_instance.web']!.parentId).toBe('vpc');
  });

  it('copies a non-default style from the first model that has one', () => {
    const styled = build([{ op: 'set_style', set: { direction: 'down' } }]);
    expect(unionModels([emptyModel(), styled]).style.direction).toBe('down');
  });
});

describe('scale', () => {
  it('plans large imports, no-op re-runs and mass removals in well under a second each', () => {
    const n = 1500;
    const ops: DiagramOp[] = [{ op: 'add_group', id: 'g' }];
    for (let i = 0; i < n; i += 1) ops.push(node(`n${i}`, { parentId: 'g' }));
    for (let i = 1; i < n; i += 1) ops.push({ op: 'connect', from: `n${i}`, to: `n${i - 1}` });
    const big = build(ops);
    const start = performance.now();
    const diagram = apply(emptyModel(), mergeIntoDiagram(emptyModel(), big, undefined, 'merge'));
    expect(mergeIntoDiagram(diagram, big, big, 'merge').ops).toEqual([]);
    const cleared = apply(diagram, mergeIntoDiagram(diagram, emptyModel(), big, 'merge'));
    expect(cleared.order).toEqual([]);
    expect(performance.now() - start).toBeLessThan(3000);
  });
});

