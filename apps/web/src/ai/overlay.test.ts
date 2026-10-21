import { describe, expect, it } from 'vitest';
import { exampleSnapshot } from '../samples/example';
import { createDraft } from './draft';
import type { Proposal } from './draft';
import { GHOST, draftProjection } from './overlay';

const { model, layout } = exampleSnapshot();

async function preview(ops: Proposal['ops']) {
  const made = await createDraft(model, layout, { ops, summary: 'x', source: 'ai' });
  if (!made.ok) throw new Error(made.error);
  return draftProjection(made.draft, layout, 'light');
}

describe('draftProjection', () => {
  it('marks new edges and keeps a ghost of the replaced one', async () => {
    const { nodes, edges } = await preview([
      { op: 'remove_edge', edgeId: 'API Gateway→Pedidos' },
      { op: 'connect', from: 'API Gateway', to: 'Redis' },
      { op: 'connect', from: 'Redis', to: 'Pedidos' },
    ]);
    expect(nodes.filter((n) => n.className)).toEqual([]);
    const marked = edges.filter((e) => e.className).map((e) => [e.id, e.className, e.source, e.target, e.data?.diff]);
    expect(marked).toEqual([
      ['API Gateway→Redis', 'sk-diff-added', 'API Gateway', 'Redis', 'added'],
      ['Redis→Pedidos', 'sk-diff-added', 'Redis', 'Pedidos', 'added'],
      [`${GHOST}API Gateway→Pedidos`, 'sk-diff-removed', 'API Gateway', 'Pedidos', 'removed'],
    ]);
  });

  it('draws removed elements as ghosts where they were and marks added and changed ones', async () => {
    const { nodes, edges } = await preview([
      { op: 'remove', id: 'Kafka' },
      { op: 'rename', id: 'Pedidos', to: 'Orders' },
      { op: 'insert_between', from: 'Orders', to: 'PostgreSQL', node: { id: 'Pool' } },
    ]);
    const ghost = nodes.find((n) => n.id === `${GHOST}Kafka`)!;
    expect(ghost).toMatchObject({ className: 'sk-diff-removed', position: layout.nodes.Kafka, selectable: false, draggable: false });
    expect(ghost.parentId).toBeUndefined();
    expect(nodes.find((n) => n.id === 'Orders')?.className).toBe('sk-diff-changed');
    expect(nodes.find((n) => n.id === 'Pool')?.className).toBe('sk-diff-added');
    const ghostEdges = edges.filter((e) => e.id.startsWith(GHOST)).map((e) => [e.source, e.target]);
    expect(ghostEdges).toEqual([
      ['Orders', 'PostgreSQL'],
      ['Orders', `${GHOST}Kafka`],
      [`${GHOST}Kafka`, 'Pagamentos'],
    ]);
    const ids = [...nodes.map((n) => n.id), ...edges.map((e) => e.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
