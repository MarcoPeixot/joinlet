import { beforeEach, describe, expect, it } from 'vitest';
import { emptyModel } from '@strukt/core';
import type { DiagramTemplate } from '@strukt/workspace';
import { createMemoryAdapter, newWorkspace } from '@strukt/workspace';
import { diagramStore } from '../state/appStore';
import { workspace } from '../workspace/appWorkspace';
import { applyTemplate, templateSnapshot } from './templates';

const template: DiagramTemplate = {
  id: 'test', title: 'Meu exemplo', description: 'Um exemplo com posição autorada.', category: 'Teste',
  ops: [{ op: 'add_node', id: 'API', presentation: 'card', icon: 'server' }],
  positions: { API: { x: 410, y: 230, w: 260, h: 100 } },
};

describe('templates', () => {
  beforeEach(async () => {
    diagramStore.getState().setReadOnly(null);
    diagramStore.getState().load({ model: emptyModel(), layout: { nodes: {}, edges: {} } });
    await workspace.open(createMemoryAdapter(), () => newWorkspace('Templates'));
    await workspace.create('diagram', 'Vazio');
  });

  it('preserves authored dimensions and positions', async () => {
    expect((await templateSnapshot(template)).layout.nodes).toEqual(template.positions);
  });

  it('rejects invalid operations before changing a diagram', async () => {
    const before = diagramStore.getState().model;
    expect(await applyTemplate({ ...template, ops: [{ op: 'connect', from: 'missing', to: 'missing' }] })).toBe(false);
    expect(diagramStore.getState().model).toBe(before);
  });

  it('creates a new diagram from a populated one and preserves the original', async () => {
    const original = await workspace.create('diagram', 'Original');
    diagramStore.getState().apply([{ op: 'add_node', id: 'Meu conteúdo' }]);
    expect(await applyTemplate(template)).toBe(true);
    const state = workspace.store.getState();
    expect(state.diagram).not.toBe(original);
    expect(state.data?.diagrams[original]?.model.order).toEqual(['Meu conteúdo']);
    expect(diagramStore.getState().model.order).toEqual(['API']);
    expect(diagramStore.getState().layout.nodes.API).toEqual(template.positions?.API);
  });

  it('applies into an empty diagram as one undo step', async () => {
    const empty = await workspace.create('diagram', 'Vazio');
    const past = diagramStore.getState().past.length;
    expect(await applyTemplate(template)).toBe(true);
    expect(workspace.store.getState().diagram).toBe(empty);
    expect(diagramStore.getState().past).toHaveLength(past + 1);
    diagramStore.getState().undo();
    expect(diagramStore.getState().model.order).toEqual([]);
  });

  it('keeps a read-only diagram intact', async () => {
    const before = diagramStore.getState().model;
    diagramStore.getState().setReadOnly('Somente leitura');
    expect(await applyTemplate(template)).toBe(false);
    expect(diagramStore.getState().model).toBe(before);
    diagramStore.getState().setReadOnly(null);
  });
});
