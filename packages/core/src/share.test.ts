import { describe, expect, it } from 'vitest';
import { applyOps } from './applyOps';
import { emptyModel } from './model';
import type { DiagramModel, DiagramOp } from './model';
import { reuseUnchanged } from './share';

function run(model: DiagramModel, ops: DiagramOp[]): DiagramModel {
  const r = applyOps(model, ops);
  if (!r.ok) throw new Error(r.error.message);
  return r.model;
}

describe('applyOps identity', () => {
  const base = run(emptyModel(), [
    { op: 'add_node', id: 'A' },
    { op: 'add_node', id: 'B' },
    { op: 'connect', from: 'A', to: 'B' },
  ]);

  it('keeps references of untouched elements and edges', () => {
    const next = run(base, [{ op: 'update', id: 'A', set: { label: 'Alpha' } }]);
    expect(next.elements['B']).toBe(base.elements['B']);
    expect(next.edges[0]).toBe(base.edges[0]);
    expect(next.elements['A']).not.toBe(base.elements['A']);
    expect(next.elements['A']!.label).toBe('Alpha');
  });

  it('returns the same model when nothing changed', () => {
    const labeled = run(base, [{ op: 'update', id: 'A', set: { label: 'Alpha' } }]);
    expect(run(labeled, [{ op: 'update', id: 'A', set: { label: 'Alpha' } }])).toBe(labeled);
    expect(run(base, [])).toBe(base);
  });

  it('handles hostile names like constructor', () => {
    const a = run(base, [{ op: 'add_node', id: 'constructor' }]);
    const b = run(a, [{ op: 'update', id: 'A', set: { label: 'x' } }]);
    expect(b.elements['constructor']).toBe(a.elements['constructor']);
    expect(Object.hasOwn(b.elements, 'constructor')).toBe(true);
    expect(run(a, [{ op: 'add_node', id: 'toString' }]).elements['constructor']).toBe(a.elements['constructor']);
  });

  it('keeps edgeIds correct and leaves failed batches untouched', () => {
    const r = applyOps(base, [{ op: 'rename', id: 'A', to: 'Z' }]);
    if (!r.ok) throw new Error();
    expect(r.edgeIds).toEqual({ 'A→B': 'Z→B' });
    expect(r.model.elements['B']).toBe(base.elements['B']);
    const bad = applyOps(base, [{ op: 'update', id: 'A', set: { label: 'q' } }, { op: 'remove', id: 'nope' }]);
    expect(bad.ok).toBe(false);
    expect(base.elements['A']!.label).toBeUndefined();
  });

  it('reuseUnchanged returns prev for structurally equal clones', () => {
    expect(reuseUnchanged(base, structuredClone(base))).toBe(base);
  });
});
