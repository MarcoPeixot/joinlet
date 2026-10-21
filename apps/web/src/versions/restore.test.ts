import { applyOps, semanticView } from '@strukt/core';
import type { DiagramOp, NodeBox } from '@strukt/core';
import { orthogonalRouter } from '@strukt/layout';
import type { DiagramSnapshot } from '@strukt/workspace';
import { describe, expect, it } from 'vitest';
import { GHOST, draftProjection } from '../ai/overlay';
import { exampleSnapshot } from '../samples/example';
import { createDiagramStore } from '../state/diagramStore';
import { changeLines, planRestore } from './restore';

const saved = exampleSnapshot();

/** The example after `ops`, with `boxes` merged into its positions. */
function edited(ops: DiagramOp[], boxes: Record<string, NodeBox> = {}): DiagramSnapshot {
  const result = applyOps(saved.model, ops);
  if (!result.ok) throw new Error(result.error.message);
  const nodes = Object.fromEntries(Object.entries({ ...saved.layout.nodes, ...boxes }).filter(([id]) => Object.hasOwn(result.model.elements, id)));
  return { model: result.model, layout: { nodes, edges: {} } };
}

const current = edited(
  [
    { op: 'remove', id: 'Kafka' },
    { op: 'add_node', id: 'Auditoria', parentId: 'Dados' },
    { op: 'connect', from: 'Pedidos', to: 'Auditoria' },
    { op: 'update', id: 'Pagamentos', set: { tech: 'Rust' } },
  ],
  { 'API Gateway': { x: 400, y: 160 }, Auditoria: { x: 900, y: 400 } },
);

describe('planRestore', () => {
  it('previews the version against the current diagram and restores it in one undo step', () => {
    const plan = planRestore(current, saved, orthogonalRouter);
    expect(plan.unchanged).toBe(false);
    expect(plan.preview.base).toBe(current.model);
    expect(plan.preview.changes.elements).toEqual({ added: ['Kafka'], removed: ['Auditoria'], changed: ['Pagamentos'] });
    expect(plan.preview.changes.edges).toEqual({ added: ['Pedidos→Kafka', 'Kafka→Pagamentos'], removed: ['Pedidos→Auditoria'], changed: [] });
    expect(Object.keys(plan.preview.layout.edges).sort()).toEqual(plan.preview.next.edges.map((e) => e.id).sort());

    const store = createDiagramStore(current);
    expect(store.getState().apply(plan.ops, plan.positions)).toBe(true);
    expect(semanticView(store.getState().model)).toEqual(semanticView(saved.model));
    expect(store.getState().model.order).toEqual(saved.model.order);
    expect(store.getState().layout.nodes).toEqual(saved.layout.nodes);
    expect(store.getState().layout.nodes).toEqual(plan.preview.layout.nodes);
    expect(store.getState().past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().model).toBe(current.model);
  });

  it('lists the changes in words', () => {
    expect(changeLines(planRestore(current, saved, orthogonalRouter).preview)).toEqual([
      { kind: 'added', text: 'Kafka' },
      { kind: 'added', text: 'Pedidos → Kafka: eventos' },
      { kind: 'added', text: 'Kafka → Pagamentos' },
      { kind: 'removed', text: 'Auditoria' },
      { kind: 'removed', text: 'Pedidos → Auditoria' },
      { kind: 'changed', text: 'Pagamentos' },
    ]);
  });

  it('is drawn by the AI diff overlay: ghosts for what restoring removes', () => {
    const { nodes, edges } = draftProjection(planRestore(current, saved, orthogonalRouter).preview, current.layout, 'light');
    expect(nodes.find((n) => n.id === 'Kafka')?.className).toBe('sk-diff-added');
    expect(nodes.find((n) => n.id === `${GHOST}Auditoria`)).toMatchObject({ className: 'sk-diff-removed', position: { x: 900, y: 400 } });
    expect(nodes.find((n) => n.id === 'Pagamentos')?.className).toBe('sk-diff-changed');
    expect(edges.filter((e) => e.id.startsWith(GHOST)).map((e) => [e.source, e.target])).toEqual([['Pedidos', `${GHOST}Auditoria`]]);
  });

  it('follows renames: the element keeps its box and reads "antes: …"', () => {
    const renamed = edited([{ op: 'rename', id: 'Redis', to: 'Cache' }]);
    const plan = planRestore(renamed, saved, orthogonalRouter);
    expect(plan.preview.changes.renamed).toEqual({ Cache: 'Redis' });
    expect(changeLines(plan.preview)).toEqual([{ kind: 'changed', text: 'Redis (antes: Cache)' }]);
    expect(plan.preview.layout.nodes.Redis).toEqual(saved.layout.nodes.Redis);
  });

  it('restores positions alone as a layout-only step, and does nothing when all is equal', () => {
    const moved = edited([], { Kafka: { x: 50, y: 700 } });
    const plan = planRestore(moved, saved, orthogonalRouter);
    expect(plan.ops).toEqual([]);
    expect(plan.unchanged).toBe(false);
    expect(changeLines(plan.preview)).toEqual([]);
    const store = createDiagramStore(moved);
    store.getState().apply(plan.ops, plan.positions);
    expect(store.getState().layout.nodes.Kafka).toEqual({ x: 600, y: 440 });
    expect(store.getState().past).toHaveLength(1);
    expect(planRestore(saved, saved, orthogonalRouter).unchanged).toBe(true);
  });

  it('places elements the version has no box for next to their neighbors', () => {
    const { Kafka: _kafka, ...rest } = saved.layout.nodes;
    const plan = planRestore(current, { model: saved.model, layout: { nodes: rest, edges: {} } }, orthogonalRouter);
    const box = plan.positions.Kafka!;
    expect(Number.isFinite(box.x) && Number.isFinite(box.y)).toBe(true);
    expect(plan.preview.layout.nodes.Kafka).toEqual(box);
  });

  it('marks a different diagram style as a change', () => {
    const bold = edited([{ op: 'set_style', set: { colorMode: 'bold' } }]);
    expect(changeLines(planRestore(bold, saved, orthogonalRouter).preview)).toEqual([{ kind: 'changed', text: 'Estilo do diagrama' }]);
  });
});
