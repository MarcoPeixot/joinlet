import { emptyLayout, emptyModel } from '@strukt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { diagramStore } from '../state/appStore';
import { uiStore } from '../ui/uiStore';
import { flowchartStep } from './flowchart';

beforeEach(() => {
  diagramStore.getState().load({ model: emptyModel(), layout: emptyLayout() });
  uiStore.setState({ editingId: null });
});

describe('flowchartStep', () => {
  it('creates a connected shape node to the right, matching shape/color and parent', () => {
    diagramStore.getState().apply(
      [
        { op: 'add_group', id: 'G' },
        { op: 'add_node', id: 'A', parentId: 'G', shape: 'diamond', color: '#ff0000' },
      ],
      { A: { x: 100, y: 100 } },
    );
    diagramStore.getState().select({ nodes: ['A'], edges: [] });

    flowchartStep('right');

    const state = diagramStore.getState();
    const created = state.model.order.find((id) => id !== 'G' && id !== 'A');
    expect(created).toBeDefined();
    const node = state.model.elements[created!];
    expect(node.kind).toBe('node');
    expect(node.parentId).toBe('G');
    expect((node as { shape?: string }).shape).toBe('diamond');
    expect(node.color).toBe('#ff0000');
    expect(node.icon).toBeUndefined();
    expect(state.model.edges).toHaveLength(1);
    expect(state.model.edges[0]).toMatchObject({ from: 'A', to: created });
    const box = state.layout.nodes[created!];
    expect(box).toBeDefined();
    expect(box!.x).toBeGreaterThan(100);
    expect(state.selection).toEqual({ nodes: [created], edges: [] });
    expect(uiStore.getState().editingId).toBe(created);
  });

  it('creates a connected icon node below, matching icon/color and no parent', () => {
    diagramStore.getState().apply(
      [{ op: 'add_node', id: 'Api', icon: 'server', color: '#112233' }],
      { Api: { x: 50, y: 50 } },
    );
    diagramStore.getState().select({ nodes: ['Api'], edges: [] });

    flowchartStep('down');

    const state = diagramStore.getState();
    expect(state.model.order).toEqual(['Api', 'Serviço']);
    const node = state.model.elements['Serviço'];
    expect(node.icon).toBe('server');
    expect(node.color).toBe('#112233');
    expect((node as { shape?: string }).shape).toBeUndefined();
    expect(node.parentId).toBeUndefined();
    expect(state.model.edges[0]).toMatchObject({ from: 'Api', to: 'Serviço' });
    const box = state.layout.nodes['Serviço'];
    expect(box!.y).toBeGreaterThan(50);
    expect(state.selection).toEqual({ nodes: ['Serviço'], edges: [] });
    expect(uiStore.getState().editingId).toBe('Serviço');
  });

  it('is a no-op when nothing is selected', () => {
    diagramStore.getState().apply([{ op: 'add_node', id: 'A' }]);
    diagramStore.getState().select({ nodes: [], edges: [] });
    const before = diagramStore.getState().past.length;

    flowchartStep('right');

    const state = diagramStore.getState();
    expect(state.model.order).toEqual(['A']);
    expect(state.past.length).toBe(before);
  });

  it('is a no-op when two nodes are selected', () => {
    diagramStore.getState().apply([{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }]);
    diagramStore.getState().select({ nodes: ['A', 'B'], edges: [] });
    const before = diagramStore.getState().past.length;

    flowchartStep('right');

    const state = diagramStore.getState();
    expect(state.model.order).toEqual(['A', 'B']);
    expect(state.past.length).toBe(before);
  });
});
