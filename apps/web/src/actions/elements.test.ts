import { COMPONENT_PRESETS, EMPTY_GROUP_SIZE, ICON_NODE_SIZE, SHAPE_SIZES, emptyLayout, emptyModel } from '@strukt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { diagramStore } from '../state/appStore';
import { uiStore } from '../ui/uiStore';
import { addComponentAt, changeShape, addNodeAt, deleteSelection, groupSelectionOrCreate, renameElement, selectAll, updateElements } from './elements';

beforeEach(() => {
  diagramStore.getState().load({ model: emptyModel(), layout: emptyLayout() });
  uiStore.setState({ editingId: null });
});

describe('addNodeAt', () => {
  it('adds a shape node centered on the point, selects it and opens it for editing', () => {
    addNodeAt({ x: 100, y: 100 }, 'shape');
    const state = diagramStore.getState();
    expect(state.model.order).toEqual(['Nó']);
    expect(state.model.elements['Nó'].icon).toBeUndefined();
    const size = SHAPE_SIZES.rectangle;
    expect(state.layout.nodes['Nó']).toEqual({
      x: Math.round(100 - size.w / 2),
      y: Math.round(100 - size.h / 2),
    });
    expect(state.selection).toEqual({ nodes: ['Nó'], edges: [] });
    expect(uiStore.getState().editingId).toBe('Nó');
  });

  it('gives subsequent shape nodes unique names', () => {
    addNodeAt({ x: 0, y: 0 }, 'shape');
    addNodeAt({ x: 0, y: 0 }, 'shape');
    expect(diagramStore.getState().model.order).toEqual(['Nó', 'Nó 2']);
  });

  it('adds an icon node with the default server icon, sized for icons', () => {
    addNodeAt({ x: 50, y: 50 }, 'icon');
    const state = diagramStore.getState();
    expect(state.model.elements['Serviço'].icon).toBe('server');
    expect(state.layout.nodes['Serviço']).toEqual({
      x: Math.round(50 - ICON_NODE_SIZE.w / 2),
      y: Math.round(50 - ICON_NODE_SIZE.h / 2),
    });
  });
});

describe('addComponentAt', () => {
  it('inserts a cloud boundary as a group with its authored size and supports undo', () => {
    addComponentAt({x:500,y:300}, {id:'vpc',label:'VPC',category:'AWS',description:'Fronteira da rede',kind:'group',icon:'aws:group-virtual-private-cloud-vpc',color:'gray',width:400,height:260});
    const state = diagramStore.getState();
    expect(state.model.elements.VPC).toMatchObject({kind:'group',icon:'aws:group-virtual-private-cloud-vpc'});
    expect(state.layout.nodes.VPC).toEqual({x:300,y:170,w:400,h:260});
    state.undo();
    expect(diagramStore.getState().model.order).toEqual([]);
    diagramStore.getState().redo();
    expect(diagramStore.getState().model.elements.VPC.kind).toBe('group');
  });
  it('inserts distinct queue and storage components with editable names and one undo step each', () => {
    const queue = COMPONENT_PRESETS.find((preset) => preset.id === 'queue')!;
    const storage = COMPONENT_PRESETS.find((preset) => preset.id === 'storage')!;
    addComponentAt({ x: 300, y: 200 }, queue);
    addComponentAt({ x: 600, y: 200 }, storage);
    addComponentAt({ x: 300, y: 400 }, queue);
    expect(diagramStore.getState().model.elements.Fila).toMatchObject({ icon: 'layers', color: 'gray' });
    expect(diagramStore.getState().model.elements.Fila).not.toHaveProperty('shape');
    expect(diagramStore.getState().model.elements.Armazenamento).toMatchObject({ icon: 'archive', color: 'gray' });
    expect(uiStore.getState().editingId).toBe('Fila 2');
    expect(diagramStore.getState().selection.nodes).toEqual(['Fila 2']);
    diagramStore.getState().undo();
    expect(diagramStore.getState().model.order).toEqual(['Fila', 'Armazenamento']);
    diagramStore.getState().redo();
    expect(diagramStore.getState().model.elements['Fila 2']).toMatchObject({ icon: 'layers' });
  });
});

describe('groupSelectionOrCreate', () => {
  it('wraps the selected top-level nodes in a new group', () => {
    diagramStore.getState().apply([{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }]);
    diagramStore.getState().select({ nodes: ['A', 'B'] });

    groupSelectionOrCreate({ x: 0, y: 0 });

    const state = diagramStore.getState();
    expect(state.model.elements['A'].parentId).toBe('Grupo');
    expect(state.model.elements['B'].parentId).toBe('Grupo');
    expect(state.selection.nodes).toEqual(['Grupo']);
  });

  it('nests the new group under the members shared parent', () => {
    diagramStore.getState().apply([
      { op: 'add_group', id: 'Outer' },
      { op: 'add_node', id: 'A', parentId: 'Outer' },
      { op: 'add_node', id: 'B', parentId: 'Outer' },
    ]);
    diagramStore.getState().select({ nodes: ['A', 'B'] });

    groupSelectionOrCreate({ x: 0, y: 0 });

    expect(diagramStore.getState().model.elements['Grupo'].parentId).toBe('Outer');
  });

  it('drops an empty group centered on the point when nothing is selected', () => {
    groupSelectionOrCreate({ x: 200, y: 100 });

    const state = diagramStore.getState();
    expect(state.model.elements['Grupo'].kind).toBe('group');
    expect(state.layout.nodes['Grupo']).toEqual({
      x: Math.round(200 - EMPTY_GROUP_SIZE.w / 2),
      y: Math.round(100 - EMPTY_GROUP_SIZE.h / 2),
    });
  });
});

describe('deleteSelection', () => {
  it('removes a group with its descendants and a selected edge whose endpoint is being removed, in one history step', () => {
    diagramStore.getState().apply([
      { op: 'add_group', id: 'G' },
      { op: 'add_node', id: 'A', parentId: 'G' },
      { op: 'add_node', id: 'X' },
      { op: 'connect', from: 'A', to: 'X' },
    ]);
    const edgeId = diagramStore.getState().model.edges[0].id;
    diagramStore.getState().select({ nodes: ['G'], edges: [edgeId] });
    const pastBefore = diagramStore.getState().past.length;

    deleteSelection();

    const state = diagramStore.getState();
    expect(state.lastError).toBeNull();
    expect(state.model.elements['G']).toBeUndefined();
    expect(state.model.elements['A']).toBeUndefined();
    expect(state.model.elements['X']).toBeDefined();
    expect(state.model.edges).toEqual([]);
    expect(state.past.length).toBe(pastBefore + 1);
  });

  it('does nothing when the selection is empty', () => {
    const before = diagramStore.getState().past.length;
    deleteSelection();
    expect(diagramStore.getState().past.length).toBe(before);
  });
});

describe('renameElement', () => {
  it('is a no-op for the same name or a blank name', () => {
    diagramStore.getState().apply([{ op: 'add_node', id: 'A' }]);

    expect(renameElement('A', 'A')).toBe(false);
    expect(renameElement('A', '   ')).toBe(false);
    expect(diagramStore.getState().model.elements['A']).toBeDefined();
  });

  it('renames an element', () => {
    diagramStore.getState().apply([{ op: 'add_node', id: 'A' }]);

    expect(renameElement('A', 'B')).toBe(true);

    const state = diagramStore.getState();
    expect(state.model.elements['A']).toBeUndefined();
    expect(state.model.elements['B']).toBeDefined();
  });
});

describe('updateElements', () => {
  it('updates every element in one history step', () => {
    diagramStore.getState().apply([{ op: 'add_node', id: 'A' }, { op: 'add_group', id: 'G' }]);
    const past = diagramStore.getState().past.length;

    updateElements(['A', 'G'], { color: 'blue' });

    const state = diagramStore.getState();
    expect(state.model.elements['A'].color).toBe('blue');
    expect(state.model.elements['G'].color).toBe('blue');
    expect(state.past.length).toBe(past + 1);
  });

  it('does nothing for an empty list', () => {
    const past = diagramStore.getState().past.length;
    updateElements([], { color: 'blue' });
    expect(diagramStore.getState().past.length).toBe(past);
  });
});

describe('selectAll', () => {
  it('selects every node, group and edge', () => {
    diagramStore.getState().apply([
      { op: 'add_node', id: 'A' },
      { op: 'add_group', id: 'G' },
      { op: 'add_node', id: 'B', parentId: 'G' },
      { op: 'connect', from: 'A', to: 'B' },
    ]);

    selectAll();

    const state = diagramStore.getState();
    expect(state.selection.nodes).toEqual(state.model.order);
    expect(state.selection.edges).toEqual(state.model.edges.map((e) => e.id));
    expect(state.selection.nodes).toHaveLength(3);
    expect(state.selection.edges).toHaveLength(1);
  });
});


describe('shape selection', () => {
  it('changes a card into an actual circle, with a square footprint, and restores it on undo', () => {
    diagramStore.getState().apply([{op:'add_node',id:'Vertex',presentation:'card',icon:'server',label:'Vertex'}], {Vertex:{x:100,y:100,w:240,h:100}});
    changeShape('Vertex','circle');
    const state=diagramStore.getState();
    expect(state.model.elements.Vertex).toMatchObject({shape:'circle'});
    expect(state.model.elements.Vertex.presentation).toBeUndefined();
    expect(state.layout.nodes.Vertex.w).toBe(state.layout.nodes.Vertex.h);
    state.undo();
    expect(diagramStore.getState().model.elements.Vertex.presentation).toBe('card');
    expect(diagramStore.getState().layout.nodes.Vertex).toEqual({x:100,y:100,w:240,h:100});
  });
});
