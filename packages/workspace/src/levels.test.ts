import { describe, expect, it } from 'vitest';
import { applyOps, emptyModel } from '@strukt/core';
import type { DiagramModel, DiagramOp } from '@strukt/core';
import { LEVELS, applyLevels, levelOf, levelTag, suggestLevels, withLevel } from './levels';
import { emptyShared } from './shared';

function build(ops: DiagramOp[]): DiagramModel {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.model;
}

describe('level tags', () => {
  it('reads the level from a nivel:<valor> tag and ignores anything else', () => {
    expect(levelOf(['risco:alto', 'nivel:container'])).toBe('container');
    expect(levelOf(['Nivel:Contexto'])).toBe('contexto');
    expect(levelOf(['nivel:outro', 'risco:alto'])).toBeUndefined();
    expect(levelOf(undefined)).toBeUndefined();
    expect(LEVELS.map(levelTag)).toEqual(['nivel:contexto', 'nivel:container', 'nivel:componente']);
  });

  it('replaces the level without touching other tags, and clears it with null', () => {
    expect(withLevel(['risco:alto', 'nivel:contexto'], 'componente')).toEqual(['risco:alto', 'nivel:componente']);
    expect(withLevel(undefined, 'container')).toEqual(['nivel:container']);
    expect(withLevel(['nivel:container', 'nivel:contexto', 'a:b'], null)).toEqual(['a:b']);
  });
});

describe('suggestLevels', () => {
  const model = build([
    { op: 'add_node', id: 'Usuário', label: 'Usuário' },
    { op: 'add_node', id: 'Gateway externo', label: 'Gateway externo', tech: 'Stripe' },
    { op: 'add_group', id: 'Plataforma' },
    { op: 'add_node', id: 'API', parentId: 'Plataforma', tech: 'Node.js' },
    { op: 'add_node', id: 'Fila', parentId: 'Plataforma' },
    { op: 'add_group', id: 'Pedidos', parentId: 'Plataforma' },
    { op: 'add_node', id: 'Controller', parentId: 'Pedidos', tech: 'NestJS' },
  ]);

  it('derives the level from depth and technology, with a reason for each', () => {
    const levels = Object.fromEntries(suggestLevels(model, () => undefined).map((p) => [p.id, p.level]));
    expect(levels).toEqual({
      Usuário: 'contexto',
      'Gateway externo': 'container',
      Plataforma: 'contexto',
      API: 'container',
      Fila: 'container',
      Pedidos: 'container',
      Controller: 'componente',
    });
    expect(suggestLevels(model, () => undefined).every((p) => p.reason.length > 10)).toBe(true);
  });

  it('never proposes a level for something that already has one', () => {
    const proposals = suggestLevels(model, (id) => (id === 'Plataforma' ? 'container' : undefined));
    expect(proposals.map((p) => p.id)).not.toContain('Plataforma');
    expect(proposals).toHaveLength(6);
  });

  it('keeps the model order and survives odd ids', () => {
    const odd = build([{ op: 'add_node', id: 'constructor' }, { op: 'add_node', id: 'toString', tech: 'x' }]);
    expect(suggestLevels(odd, () => undefined).map((p) => p.id)).toEqual(['constructor', 'toString']);
  });
});

describe('applyLevels', () => {
  const model = build([{ op: 'add_node', id: 'API', label: 'API', tech: 'Node' }, { op: 'add_node', id: 'DB' }]);
  let n = 0;
  const newId = () => `e${++n}`;

  it('shares an unlinked element as a new entity and tags it', () => {
    n = 0;
    const next = applyLevels(emptyShared(), 'visao', model, { API: 'container' }, newId);
    expect(next.views.visao).toEqual({ API: 'e1' });
    expect(next.entities.e1).toMatchObject({ id: 'e1', label: 'API', tech: 'Node', tags: ['nivel:container'] });
  });

  it('reuses the linked entity, replaces its level and keeps other tags', () => {
    const shared = { ...emptyShared(), entities: { x: { id: 'x', tags: ['risco:alto', 'nivel:contexto'] } }, views: { visao: { API: 'x' } } };
    const next = applyLevels(shared, 'visao', model, { API: 'componente' }, newId);
    expect(next.entities.x!.tags).toEqual(['risco:alto', 'nivel:componente']);
    expect(Object.keys(next.entities)).toEqual(['x']);
  });

  it('clears a level (null) and does not share an element just to clear nothing', () => {
    const shared = { ...emptyShared(), entities: { x: { id: 'x', tags: ['nivel:contexto'] } }, views: { visao: { API: 'x' } } };
    const next = applyLevels(shared, 'visao', model, { API: null, DB: null }, newId);
    expect(next.entities.x!.tags).toBeUndefined();
    expect(next.views.visao).toEqual({ API: 'x' });
  });

  it('ignores ids that are not in the diagram', () => {
    const next = applyLevels(emptyShared(), 'visao', model, { fantasma: 'container' }, newId);
    expect(next).toEqual(emptyShared());
  });
});
