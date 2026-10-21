import { orthogonalRouter } from '@strukt/layout';
import { describe, expect, it, vi } from 'vitest';
import { exampleSnapshot } from '../samples/example';
import { createDraft } from './draft';
import { interpretOffline } from './offline';

const { model, layout } = exampleSnapshot();

describe('createDraft', () => {
  it('previews the offline acceptance phrase without moving anything', async () => {
    const proposal = interpretOffline('adicione Redis entre API Gateway e Pedidos', model);
    if (!proposal.ok) throw new Error(proposal.error);
    const made = await createDraft(model, layout, { ...proposal, source: 'offline' });
    if (!made.ok) throw new Error(made.error);
    const { draft } = made;
    expect(draft.base).toBe(model);
    expect(draft.changes.edges).toEqual({ added: ['API Gateway→Redis', 'Redis→Pedidos'], removed: ['API Gateway→Pedidos'], changed: [] });
    expect(draft.changes.elements).toEqual({ added: [], removed: [], changed: [] });
    expect(draft.positions).toEqual({});
    expect(draft.autoLayout).toBe(false);
    expect(draft.layout.nodes).toEqual(layout.nodes);
    // The preview is routed on its own (eraser router by default): every edge of the draft has a route.
    expect(Object.keys(draft.layout.edges).sort()).toEqual(draft.next.edges.map((e) => e.id).sort());
  });

  it('reorganizes the whole diagram when an AI proposal adds a service', async () => {
    const proposal = {
      ops: [{ op: 'add_node' as const, id: 'Auth', parentId: 'Serviços' }, { op: 'connect' as const, from: 'API Gateway', to: 'Auth' }],
      summary: 'Adicionei Auth.',
      source: 'ai' as const,
    };
    const runLayout = vi.fn(async (next: typeof model) => Object.fromEntries(next.order.map((id, index) => [id, { x: index * 280, y: 40 }])));
    const made = await createDraft(model, layout, proposal, { runLayout });
    if (!made.ok) throw new Error(made.error);

    expect(runLayout).toHaveBeenCalledWith(made.draft.next);
    expect(made.draft.autoLayout).toBe(true);
    expect(Object.keys(made.draft.positions)).toHaveLength(made.draft.next.order.length);
    expect(made.draft.layout.nodes).toEqual(made.draft.positions);
  });

  it('places new elements next to their neighbors if automatic layout fails', async () => {
    const made = await createDraft(model, layout, {
      ops: [{ op: 'insert_between', from: 'Pedidos', to: 'Kafka', node: { id: 'Outbox' } }, { op: 'rename', id: 'Kafka', to: 'Eventos' }],
      summary: 'x',
      source: 'ai',
      model: 'claude-sonnet-5',
    }, { runLayout: async () => { throw new Error('elk'); } });
    if (!made.ok) throw new Error(made.error);
    expect(Object.keys(made.draft.positions)).toEqual(['Outbox']);
    expect(made.draft.layout.nodes.Outbox).toEqual(made.draft.positions.Outbox);
    expect(made.draft.layout.nodes.Eventos).toEqual(layout.nodes.Kafka);
    expect(made.draft.changes.elements).toEqual({ added: ['Outbox'], removed: [], changed: ['Eventos'] });
    expect(made.draft.changes.renamed).toEqual({ Kafka: 'Eventos' });
    expect(made.draft.autoLayout).toBe(true);
  });

  it('lays a replaced diagram out with ELK, falling back to placeNear if ELK fails', async () => {
    const ops = [
      ...model.order.filter((id) => !model.elements[id]!.parentId).map((id) => ({ op: 'remove' as const, id })),
      { op: 'add_node' as const, id: 'A' },
      { op: 'add_node' as const, id: 'B' },
      { op: 'connect' as const, from: 'A', to: 'B' },
    ];
    const runLayout = vi.fn(async () => ({ A: { x: 0, y: 0 }, B: { x: 400, y: 0 } }));
    const made = await createDraft(model, layout, { ops, summary: 'x', source: 'ai' }, { runLayout, router: orthogonalRouter });
    if (!made.ok) throw new Error(made.error);
    expect(made.draft.autoLayout).toBe(true);
    expect(made.draft.layout.nodes).toEqual({ A: { x: 0, y: 0 }, B: { x: 400, y: 0 } });
    expect(made.draft.changes.elements.removed).toHaveLength(model.order.length);
    const failing = await createDraft(model, layout, { ops, summary: 'x', source: 'ai' }, { runLayout: async () => Promise.reject(new Error('elk')) });
    expect(failing.ok && Object.keys(failing.draft.positions)).toEqual(['A', 'B']);
  });

  it('relayouts everything for "Gerar do zero", even when names come back', async () => {
    const ops = [
      ...model.order.filter((id) => !model.elements[id]!.parentId).map((id) => ({ op: 'remove' as const, id })),
      { op: 'add_node' as const, id: 'Kafka' },
    ];
    const runLayout = vi.fn(async () => ({ Kafka: { x: 7, y: 7 } }));
    const made = await createDraft(model, layout, { ops, summary: 'x', source: 'ai' }, { runLayout });
    expect(made.ok && made.draft).toMatchObject({ autoLayout: true, positions: { Kafka: { x: 7, y: 7 } } });
  });

  it('refuses ops that do not apply', async () => {
    expect(await createDraft(model, layout, { ops: [{ op: 'remove', id: 'Nada' }], summary: 'x', source: 'ai' })).toEqual({
      ok: false,
      error: 'A proposta não pôde ser aplicada: Elemento "Nada" não existe.',
    });
    const malformed = await createDraft(model, layout, { ops: [{ op: 'add_node' } as never], summary: 'x', source: 'ai' });
    expect(malformed.ok).toBe(false);
  });
});

it('keeps other diagram areas stationary when the AI adds a component inside one frame', async () => {
  const { addCanvasDiagram, applyOps, emptyModel, emptyLayout, syncLayout } = await import('@strukt/core');
  let scene = emptyModel(), positions = emptyLayout();
  const frames: string[] = [];
  for (const name of ['Consulta', 'Ingestão']) {
    const made = addCanvasDiagram(scene, positions, emptyModel(), emptyLayout(), name);
    const added = applyOps(scene, made.ops); if (!added.ok) throw Error(added.error.message);
    scene = added.model; positions = syncLayout(positions, scene, made.ops, made.positions); frames.push(made.frame);
  }
  const runLayout = vi.fn(async () => ({ Cache: { x: 10, y: 60 } }));
  const made = await createDraft(scene, positions, { source: 'ai', summary: 'Cache na consulta', ops: [{ op: 'add_node', id: 'Cache', parentId: frames[0] }] }, { router: orthogonalRouter, runLayout });
  expect(made.ok).toBe(true);
  if (!made.ok) return;
  expect(runLayout).toHaveBeenCalledOnce();
  expect((runLayout.mock.calls[0] as unknown as [import('@strukt/core').DiagramModel])[0].elements[frames[1]!]).toBeUndefined();
  expect(made.draft.layout.nodes[frames[1]!]).toEqual(positions.nodes[frames[1]!]);
});
