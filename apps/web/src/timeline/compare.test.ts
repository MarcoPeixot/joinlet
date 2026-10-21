import { applyOps } from '@strukt/core';
import type { DiagramOp, NodeBox } from '@strukt/core';
import { orthogonalRouter } from '@strukt/layout';
import type { DiagramSnapshot } from '@strukt/workspace';
import { describe, expect, it } from 'vitest';
import { GHOST, draftProjection } from '../ai/overlay';
import { exampleSnapshot } from '../samples/example';
import { diffStates, summarizeLines } from './compare';

const base = exampleSnapshot();

function edited(ops: DiagramOp[], boxes: Record<string, NodeBox> = {}, from: DiagramSnapshot = base): DiagramSnapshot {
  const result = applyOps(from.model, ops);
  if (!result.ok) throw new Error(result.error.message);
  const nodes = Object.fromEntries(Object.entries({ ...from.layout.nodes, ...boxes }).filter(([id]) => Object.hasOwn(result.model.elements, id)));
  return { model: result.model, layout: { nodes, edges: {} } };
}

const planned = edited([{ op: 'remove', id: 'Kafka' }, { op: 'add_node', id: 'Auditoria', parentId: 'Dados' }, { op: 'connect', from: 'Pedidos', to: 'Auditoria' }, { op: 'update', id: 'Pagamentos', set: { tech: 'Rust' } }], { Auditoria: { x: 900, y: 400 } });

describe('diffStates', () => {
  it('compares two states in the direction of time: base is the earlier one', () => {
    const diff = diffStates(base, planned, orthogonalRouter);
    expect(diff.preview.base).toBe(base.model);
    expect(diff.preview.next).toBe(planned.model);
    expect(diff.preview.changes.elements).toEqual({ added: ['Auditoria'], removed: ['Kafka'], changed: ['Pagamentos'] });
    expect(diff.unchanged).toBe(false);
    expect(diff.lines.map((l) => `${l.kind}:${l.text}`)).toEqual([
      'added:Auditoria',
      'added:Pedidos → Auditoria',
      'removed:Kafka',
      'removed:Pedidos → Kafka: eventos',
      'removed:Kafka → Pagamentos',
      'changed:Pagamentos',
    ]);
    expect(diff.counts).toEqual({ added: 2, removed: 3, changed: 1 });
  });

  it('draws the later state with routes and the removed elements where the earlier one had them', () => {
    const diff = diffStates(base, planned, orthogonalRouter);
    expect(Object.keys(diff.preview.layout.edges).sort()).toEqual(planned.model.edges.map((e) => e.id).sort());
    expect(diff.preview.layout.nodes.Auditoria).toEqual({ x: 900, y: 400 });
    const { nodes } = draftProjection(diff.preview, diff.oldLayout, 'light');
    expect(nodes.find((n) => n.id === `${GHOST}Kafka`)).toMatchObject({ className: 'sk-diff-removed', position: { x: base.layout.nodes.Kafka!.x, y: base.layout.nodes.Kafka!.y } });
    expect(nodes.find((n) => n.id === 'Auditoria')?.className).toBe('sk-diff-added');
  });

  it('places elements a saved state has no box for, instead of piling them at the origin', () => {
    const bare: DiagramSnapshot = { model: planned.model, layout: { nodes: {}, edges: {} } };
    const diff = diffStates(base, bare, orthogonalRouter);
    const boxes = Object.values(diff.preview.layout.nodes);
    expect(boxes.length).toBeGreaterThan(0);
    expect(new Set(boxes.map((b) => `${b.x},${b.y}`)).size).toBe(boxes.length);
    expect(Object.keys(diff.oldLayout.nodes).sort()).toEqual(Object.keys(base.layout.nodes).sort());
  });

  it('reports no changes (and positions alone do not count) for equal meaning', () => {
    const moved = edited([], { Kafka: { x: 50, y: 700 } });
    const diff = diffStates(base, moved, orthogonalRouter);
    expect(diff.lines).toEqual([]);
    expect(diff.unchanged).toBe(true);
    expect(diff.counts).toEqual({ added: 0, removed: 0, changed: 0 });
  });

  it('follows a rename as one change, not an addition plus a removal', () => {
    const renamed = edited([{ op: 'rename', id: 'Redis', to: 'Cache' }]);
    const diff = diffStates(base, renamed, orthogonalRouter);
    expect(diff.counts).toEqual({ added: 0, removed: 0, changed: 1 });
    expect(diff.lines).toEqual([{ kind: 'changed', text: 'Cache (antes: Redis)' }]);
  });
});

describe('summarizeLines', () => {
  it('writes what changes in pt-BR, with the right number', () => {
    expect(summarizeLines({ added: 0, removed: 0, changed: 0 })).toBe('Sem mudanças no diagrama.');
    expect(summarizeLines({ added: 1, removed: 0, changed: 0 })).toBe('1 adicionado.');
    expect(summarizeLines({ added: 2, removed: 1, changed: 0 })).toBe('2 adicionados e 1 removido.');
    expect(summarizeLines({ added: 3, removed: 2, changed: 4 })).toBe('3 adicionados, 2 removidos e 4 alterados.');
    expect(summarizeLines({ added: 0, removed: 0, changed: 1 })).toBe('1 alterado.');
  });
});
