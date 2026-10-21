import { applyOps, emptyLayout, emptyModel } from '@strukt/core';
import type { DiagramOp } from '@strukt/core';
import { emptyShared } from '@strukt/workspace';
import { describe, expect, it } from 'vitest';
import { readThrough } from './project';

const model = (() => {
  const ops: DiagramOp[] = [{ op: 'add_node', id: 'Usuário' }, { op: 'add_group', id: 'Sistema' }, { op: 'add_node', id: 'API', parentId: 'Sistema', tech: 'Node' }, { op: 'connect', from: 'Usuário', to: 'API' }];
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
})();
const shared = { ...emptyShared(), entities: { u: { id: 'u', tags: ['nivel:contexto'] }, s: { id: 's', tags: ['nivel:contexto'] }, a: { id: 'a', tags: ['nivel:container'] } }, views: { d: { Usuário: 'u', Sistema: 's', API: 'a' } } };

describe('readThrough', () => {
  it('finds a built-in perspective and projects the diagram through the shared tags', () => {
    const read = readThrough({ model, layout: emptyLayout(), slug: 'd', id: 'c4-contexto', shared })!;
    expect(read.perspective.name).toBe('C4: Contexto');
    expect(read.model.order).toEqual(['Usuário', 'Sistema']);
    expect(read.view.counts).toEqual({ shown: 1, total: 2 });
    expect(model.order).toEqual(['Usuário', 'Sistema', 'API']);
  });

  it('prefers a saved perspective over a built-in one with the same id', () => {
    const read = readThrough({ model, layout: emptyLayout(), slug: 'd', id: 'c4-contexto', shared, saved: [{ id: 'c4-contexto', name: 'Meu contexto', levels: ['container'] }] })!;
    expect(read.perspective.name).toBe('Meu contexto');
    expect(read.model.order).toEqual(['Sistema', 'API']);
  });

  it('answers the same question with the same object, and a changed model with a new one', () => {
    const input = { model, layout: emptyLayout(), slug: 'd', id: 'c4-contexto', shared };
    expect(readThrough(input)).toBe(readThrough({ ...input }));
    expect(readThrough({ ...input, model: { ...model } })).not.toBe(readThrough(input));
  });

  it('is null for an id the diagram does not offer, however odd', () => {
    for (const id of ['nope', 'constructor', '__proto__', '']) expect(readThrough({ model, layout: emptyLayout(), slug: 'd', id, shared })).toBeNull();
  });
});
