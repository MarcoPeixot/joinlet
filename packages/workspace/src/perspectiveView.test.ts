import { describe, expect, it } from 'vitest';
import { applyOps, computeRects, emptyLayout, emptyModel } from '@strukt/core';
import type { DiagramModel, DiagramOp, LayoutState } from '@strukt/core';
import { BUILTIN_PERSPECTIVES } from './perspectives';
import type { Perspective } from './perspectives';
import { projectPerspective, resolvePerspective, sharedTagsOf } from './perspectiveView';
import { emptyShared } from './shared';

function build(ops: DiagramOp[]): DiagramModel {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.model;
}

const model = build([
  { op: 'add_node', id: 'Usuário' },
  { op: 'add_node', id: 'Stripe', tech: 'API' },
  { op: 'add_group', id: 'Plataforma' },
  { op: 'add_node', id: 'API', parentId: 'Plataforma', tech: 'Node' },
  { op: 'add_node', id: 'DB', parentId: 'Plataforma', tech: 'Postgres' },
  { op: 'add_group', id: 'Pedidos', parentId: 'Plataforma' },
  { op: 'add_node', id: 'Controller', parentId: 'Pedidos' },
  { op: 'connect', from: 'Usuário', to: 'API' },
  { op: 'connect', from: 'API', to: 'DB' },
  { op: 'connect', from: 'API', to: 'Stripe', label: 'cobra' },
  { op: 'connect', from: 'Controller', to: 'DB' },
  { op: 'connect', from: 'Usuário', to: 'Controller' },
]);
const layout: LayoutState = {
  nodes: { Usuário: { x: 0, y: 0 }, Stripe: { x: 600, y: 0 }, API: { x: 200, y: 0 }, DB: { x: 400, y: 0 }, Controller: { x: 200, y: 200 } },
  edges: {},
};
const TAGS: Record<string, string[]> = {
  Usuário: ['nivel:contexto', 'risco:baixo'], Stripe: ['nivel:contexto', 'risco:alto'], Plataforma: ['nivel:contexto'],
  API: ['nivel:container', 'risco:alto', 'ambiente:produção'], DB: ['nivel:container', 'risco:alto', 'ambiente:staging'],
  Pedidos: ['nivel:container'], Controller: ['nivel:componente'],
};
const tagsOf = (id: string) => (Object.hasOwn(TAGS, id) ? TAGS[id] : undefined);
const [contexto, containers, componentes] = BUILTIN_PERSPECTIVES as [Perspective, Perspective, Perspective];
const ids = (set: Set<string>) => [...set].sort();

describe('resolvePerspective', () => {
  it('shows everything for a perspective that restricts nothing', () => {
    const view = resolvePerspective(model, tagsOf, { id: 'tudo', name: 'Tudo' });
    expect(view.hidden.size).toBe(0);
    expect(view.dimmed.size).toBe(0);
    expect(view.counts).toEqual({ shown: 5, total: 5 });
  });

  it('C4 contexto: the context-level elements, with the groups drawn as boxes', () => {
    const view = resolvePerspective(model, tagsOf, contexto);
    expect(ids(view.shown)).toEqual(['Plataforma', 'Stripe', 'Usuário']);
    expect(ids(view.boxes)).toEqual(['Plataforma']);
    expect(view.counts).toEqual({ shown: 2, total: 5 });
  });

  it('C4 containers: containers and the context around them; a group is a frame while a member shows', () => {
    const view = resolvePerspective(model, tagsOf, containers);
    expect(ids(view.shown)).toEqual(['API', 'DB', 'Pedidos', 'Plataforma', 'Stripe', 'Usuário']);
    expect(ids(view.boxes)).toEqual(['Pedidos']);
  });

  it('C4 componentes', () => {
    const view = resolvePerspective(model, tagsOf, componentes);
    expect(ids(view.shown)).toEqual(['API', 'Controller', 'DB', 'Pedidos', 'Plataforma']);
    expect(ids(view.boxes)).toEqual([]);
  });

  it('values of one key are alternatives, different keys all have to match', () => {
    const prod = resolvePerspective(model, tagsOf, { id: 'x', name: 'x', tags: ['risco:alto', 'ambiente:produção'] });
    expect(ids(prod.shown)).toEqual(['API', 'Plataforma']);
    const both = resolvePerspective(model, tagsOf, { id: 'x', name: 'x', tags: ['ambiente:produção', 'ambiente:staging'] });
    expect(ids(both.shown)).toEqual(['API', 'DB', 'Plataforma']);
    const withLevel = resolvePerspective(model, tagsOf, { id: 'x', name: 'x', tags: ['risco:alto'], levels: ['container'] });
    expect(ids(withLevel.shown)).toEqual(['API', 'DB', 'Plataforma']);
  });

  it('tags compare without caring about case', () => {
    expect(ids(resolvePerspective(model, tagsOf, { id: 'x', name: 'x', tags: ['Risco:ALTO'] }).shown)).toEqual(['API', 'DB', 'Plataforma', 'Stripe']);
  });

  it('include brings an element back (and the group around it); hide wins over everything', () => {
    const view = resolvePerspective(model, tagsOf, { ...contexto, include: ['Controller'], hide: ['Stripe'] });
    expect(ids(view.shown)).toEqual(['Controller', 'Pedidos', 'Plataforma', 'Usuário']);
    expect(view.hidden.has('Stripe')).toBe(true);
  });

  it('a hidden group takes its members with it, even an included one', () => {
    const view = resolvePerspective(model, tagsOf, { id: 'x', name: 'x', hide: ['Plataforma'], include: ['API'] });
    expect(ids(view.shown)).toEqual(['Stripe', 'Usuário']);
  });

  it('a collapsed group is one box and keeps showing even when it does not match', () => {
    const view = resolvePerspective(model, tagsOf, { id: 'x', name: 'x', levels: ['componente'], collapsed: ['Plataforma'] });
    expect(ids(view.shown)).toEqual(['Plataforma']);
    expect(ids(view.boxes)).toEqual(['Plataforma']);
  });

  it('dim keeps everything and fades what does not match; a group is lit by what it holds', () => {
    const view = resolvePerspective(model, tagsOf, { id: 'x', name: 'x', tags: ['risco:alto'], mode: 'dim' });
    expect(view.hidden.size).toBe(0);
    expect(ids(view.dimmed)).toEqual(['Controller', 'Pedidos', 'Usuário']);
    expect(view.counts).toEqual({ shown: 5, total: 5 });
  });

  it('dim still removes what is hidden by name', () => {
    const view = resolvePerspective(model, tagsOf, { id: 'x', name: 'x', tags: ['risco:alto'], mode: 'dim', hide: ['DB'] });
    expect(view.hidden.has('DB')).toBe(true);
    expect(view.shown.has('DB')).toBe(false);
  });

  it('copes with ids that are Object.prototype names and with unknown ids in the lists', () => {
    const odd = build([{ op: 'add_node', id: 'constructor' }, { op: 'add_node', id: 'toString' }, { op: 'connect', from: 'constructor', to: 'toString' }]);
    const view = resolvePerspective(odd, () => undefined, { id: 'x', name: 'x', hide: ['toString', 'fantasma', 'hasOwnProperty'] });
    expect(ids(view.shown)).toEqual(['constructor']);
  });
});

describe('projectPerspective', () => {
  it('returns the same model and layout when nothing is hidden or lifted', () => {
    const view = resolvePerspective(model, tagsOf, { id: 'tudo', name: 'Tudo' });
    const projected = projectPerspective(model, layout, view);
    expect(projected.model.order).toEqual(model.order);
    expect(projected.model.edges).toEqual(model.edges);
    expect(projected.model.elements.API).toBe(model.elements.API);
    expect(projected.layout.nodes).toEqual(layout.nodes);
  });

  it('drops hidden elements and the connections that touch them', () => {
    const projected = projectPerspective(model, layout, resolvePerspective(model, tagsOf, containers));
    expect(projected.model.order).toEqual(['Usuário', 'Stripe', 'Plataforma', 'API', 'DB', 'Pedidos']);
    expect(projected.model.edges.map((edge) => `${edge.from}→${edge.to}`)).toEqual(['Usuário→API', 'API→DB', 'API→Stripe']);
    expect(projected.model.edges[2]).toBe(model.edges[2]);
    expect(Object.keys(projected.model.elements).sort()).toEqual([...projected.model.order].sort());
  });

  it('with collapse, connections to what is not shown go to the nearest shown group, merged', () => {
    const projected = projectPerspective(model, layout, resolvePerspective(model, tagsOf, contexto));
    expect(projected.model.edges.map((edge) => `${edge.from}→${edge.to}${edge.label ? ` (${edge.label})` : ''}`)).toEqual(['Usuário→Plataforma (2 conexões)', 'Plataforma→Stripe (cobra)']);
    expect(projected.model.edges.map((edge) => edge.id)).toEqual(['Usuário→API', 'API→Stripe']);
  });

  it('without collapse those connections simply disappear', () => {
    const projected = projectPerspective(model, layout, resolvePerspective(model, tagsOf, { ...contexto, collapse: false }));
    expect(projected.model.edges).toEqual([]);
  });

  it('never lifts a connection to something hidden by name', () => {
    const projected = projectPerspective(model, layout, resolvePerspective(model, tagsOf, { ...contexto, hide: ['API'] }));
    expect(projected.model.edges.map((edge) => `${edge.from}→${edge.to}`)).toEqual(['Usuário→Plataforma']);
  });

  it('draws a group with nothing shown inside as a compact box where the group was', () => {
    const view = resolvePerspective(model, tagsOf, contexto);
    const projected = projectPerspective(model, layout, view);
    const original = computeRects(model, layout).Plataforma!;
    const box = computeRects(projected.model, projected.layout).Plataforma!;
    expect(box.w).toBeLessThanOrEqual(original.w);
    expect(box.h).toBeLessThanOrEqual(96);
    expect(box.x + box.w / 2).toBeCloseTo(original.x + original.w / 2);
    expect(box.y + box.h / 2).toBeCloseTo(original.y + original.h / 2);
  });

  it('keeps an empty group of the original diagram as the diagram has it', () => {
    const withEmpty = build([{ op: 'add_group', id: 'Vazio' }, { op: 'add_node', id: 'A' }]);
    const empty: LayoutState = { nodes: { Vazio: { x: 5, y: 6, w: 300, h: 200 } }, edges: {} };
    const projected = projectPerspective(withEmpty, empty, resolvePerspective(withEmpty, () => undefined, { id: 'x', name: 'x' }));
    expect(projected.layout.nodes.Vazio).toEqual({ x: 5, y: 6, w: 300, h: 200 });
  });

  it('shrinks a group to the members that stay', () => {
    const projected = projectPerspective(model, layout, resolvePerspective(model, tagsOf, { id: 'x', name: 'x', hide: ['DB'] }));
    const before = computeRects(model, layout).Plataforma!;
    const after = computeRects(projected.model, projected.layout).Plataforma!;
    expect(after.w).toBeLessThan(before.w);
  });

  it('does not touch the model it was given', () => {
    const snapshot = JSON.stringify(model);
    projectPerspective(model, emptyLayout(), resolvePerspective(model, tagsOf, contexto));
    expect(JSON.stringify(model)).toBe(snapshot);
  });
});

describe('sharedTagsOf', () => {
  it('reads an element tags through the diagram view of the shared model', () => {
    const shared = { ...emptyShared(), entities: { e1: { id: 'e1', tags: ['nivel:container'] } }, views: { visao: { API: 'e1', constructor: 'e1' } } };
    const tags = sharedTagsOf(shared, 'visao');
    expect(tags('API')).toEqual(['nivel:container']);
    expect(tags('DB')).toBeUndefined();
    expect(tags('toString')).toBeUndefined();
    expect(sharedTagsOf(undefined, 'visao')('API')).toBeUndefined();
    expect(sharedTagsOf(shared, 'outro')('API')).toBeUndefined();
  });
});
