import { computeRects, emptyLayout, unionRect } from '@strukt/core';
import { parseDiagramJson } from '@strukt/json';
import type { DiagramModel } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { exampleSnapshot } from '../samples/example';
import { diagramStore } from '../state/appStore';
import { composeArchitecture, reorganize } from './layout';
import grouped from '../../../../packages/layout/src/groupComposition.fixture.json' with {type:'json'};
import mixed from '../../../../packages/layout/src/flowComposition.fixture.json' with {type:'json'};

describe('composition orientation', () => {
  for (const direction of ['right', 'down'] as const) {
    it(`lays out a chain ${direction} and restores layout and direction together on undo`, async () => {
      const model = parseDiagramJson(JSON.stringify({ version: 1, style: { direction: direction === 'right' ? 'down' : 'right' }, nodes: [{ id: 'Web' }, { id: 'API' }, { id: 'Banco' }], connections: [{ from: 'Web', to: 'API' }, { from: 'API', to: 'Banco' }] })).model;
      diagramStore.getState().load({ model, layout: emptyLayout() });
      const before = diagramStore.getState();
      await composeArchitecture(direction);
      const after = diagramStore.getState();
      const rects = computeRects(after.model, after.layout);
      expect(after.model.style.direction).toBe(direction);
      const axis = direction === 'right' ? 'x' : 'y';
      expect(rects.Web![axis]).toBeLessThan(rects.API![axis]);
      expect(rects.API![axis]).toBeLessThan(rects.Banco![axis]);
      expect(after.model.edges).toEqual(model.edges);
      expect(after.past).toHaveLength(1);
      after.undo();
      expect(diagramStore.getState().model).toBe(before.model);
      expect(diagramStore.getState().layout.nodes).toEqual(before.layout.nodes);
      diagramStore.getState().redo();
      expect(diagramStore.getState().model.style.direction).toBe(direction);
      expect(diagramStore.getState().layout.nodes).toEqual(after.layout.nodes);
    });
  }

  it('preserves the saved horizontal direction when no override is supplied', async () => {
    const model = parseDiagramJson(JSON.stringify({ version: 1, style: { direction: 'right' }, nodes: [{ id: 'Web' }, { id: 'API' }], connections: [{ from: 'Web', to: 'API' }] })).model;
    diagramStore.getState().load({ model, layout: emptyLayout() });
    await composeArchitecture();
    expect(diagramStore.getState().model.style.direction).toBe('right');
  });
});

describe('reorganize', () => {
  it('recomposes the real example instead of perpetuating generated entry roles',async()=>{
    const model=structuredClone(mixed) as DiagramModel;
    diagramStore.getState().load({model,layout:{nodes:{},edges:{}}});
    await composeArchitecture();
    const state=diagramStore.getState(),rects=computeRects(state.model,state.layout);
    expect(state.model.elements.Frontend!.layoutRole).toBe('entry');
    expect(state.model.elements['Serviços']!.layoutRole).toBe('peer');
    expect(rects.Frontend!.x).toBeLessThan(rects.Borda!.x);
    expect(rects.Borda!.x).toBeLessThan(rects['Serviços']!.x);
    expect(rects['Serviços']!.x).toBeLessThan(rects.Dados!.x);
    expect(state.model.edges).toEqual(model.edges);
    expect(state.past).toHaveLength(1);
  });
  it('composes groups as one undo step, preserving all component identities and connections', async () => {
    const model=structuredClone(grouped) as DiagramModel;
    diagramStore.getState().load({model,layout:{nodes:{},edges:{}}});
    const before=diagramStore.getState();
    await composeArchitecture();
    const state=diagramStore.getState(), bounds=unionRect(Object.values(computeRects(state.model,state.layout)))!;
    expect(state.model.order).toEqual(before.model.order);
    expect(state.model.edges).toEqual(before.model.edges);
    for(const id of model.order)expect(state.model.elements[id]!.parentId).toBe(model.elements[id]!.parentId);
    expect(state.model.elements['Experiências']!.layoutRole).toBe('entry');
    expect(bounds.w).toBeLessThan(2600);
    expect(bounds.h).toBeLessThan(1300);
    expect(state.past).toHaveLength(1);
    state.undo();expect(diagramStore.getState().layout).toEqual(before.layout);
    diagramStore.getState().redo();expect(diagramStore.getState().layout.nodes).toEqual(state.layout.nodes);
  });
  it('lays out the example as one layout-only undo step, keeping the model and its top-left corner', async () => {
    diagramStore.getState().load(exampleSnapshot());
    const before = diagramStore.getState();
    const corner = (s: typeof before) => {
      const rects = Object.values(computeRects(s.model, s.layout));
      return { x: Math.min(...rects.map((r) => r.x)), y: Math.min(...rects.map((r) => r.y)) };
    };
    await reorganize();
    const after = diagramStore.getState();
    expect(after.model).toBe(before.model);
    expect(after.past).toHaveLength(before.past.length + 1);
    expect(after.layout.nodes).not.toEqual(before.layout.nodes);
    expect(Math.abs(corner(after).x - corner(before).x)).toBeLessThanOrEqual(1);
    after.undo();
    expect(diagramStore.getState().layout.nodes).toEqual(before.layout.nodes);
  });

  it('drops the arrangement when a drag starts or a node moves while ELK runs', async () => {
    const past = diagramStore.getState().past.length;
    const dragged = reorganize();
    diagramStore.getState().beginGesture();
    await dragged;
    expect(diagramStore.getState().past).toHaveLength(past);
    diagramStore.getState().endGesture();

    const moved = reorganize();
    diagramStore.getState().moveLive({ Kafka: { x: 1, y: 1 } });
    await moved;
    expect(diagramStore.getState().layout.nodes.Kafka).toEqual({ x: 1, y: 1 });
    expect(diagramStore.getState().past).toHaveLength(past);
  });
});
