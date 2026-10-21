import { applyOps, emptyModel } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { applyEntity, applyRelation, emptyShared, followRelationIds, parseShared, printShared } from './shared';

describe('shared model', () => {
  it('round trips entities and view mappings', () => {
    const shared = emptyShared();
    shared.entities.api = { id: 'api', tech: 'Bun' };
    shared.views.overview = { API: 'api' };
    expect(parseShared(printShared(shared))).toEqual(shared);
  });

  it('keeps grouped tags and drops malformed tag values', () => {
    const shared = parseShared(JSON.stringify({ version: 1, entities: { api: { id: 'api', tags: ['risk:high', 'risk:high', '../bad', 'owner:payments'] } }, views: {} }));
    expect(shared.entities.api?.tags).toEqual(['risk:high', 'owner:payments']);
  });

  it('projects semantic properties without touching the diagram layout', () => {
    const added = applyOps(emptyModel(), [{ op: 'add_node', id: 'API' }]);
    if (!added.ok) throw new Error(added.error.message);
    expect(applyEntity(added.model, 'API', { id: 'api', tech: 'Bun' }).elements.API?.tech).toBe('Bun');
    expect(applyEntity(added.model, 'Missing', { id: 'api' })).toBe(added.model);
  });

  it('reuses a relation across views and follows endpoint renames', () => {
    const first = applyOps(emptyModel(), [
      { op: 'add_node', id: 'API' }, { op: 'add_node', id: 'DB' }, { op: 'connect', from: 'API', to: 'DB', label: 'old' },
    ]);
    if (!first.ok) throw new Error(first.error.message);
    const shared = emptyShared();
    shared.entities.api = { id: 'api' };
    shared.entities.db = { id: 'db' };
    shared.relations = { sql: { id: 'sql', from: 'api', to: 'db', connector: '>', label: 'SQL', tech: 'PostgreSQL', description: 'Leitura dos pedidos' } };
    shared.viewRelations = { overview: { 'API→DB': 'sql' }, detail: { 'API→DB': 'sql' } };
    expect(parseShared(printShared(shared))).toEqual(shared);
    expect(applyRelation(first.model, 'API→DB', shared.relations.sql).edges[0]?.label).toBe('SQL');
    const renamed = applyOps(first.model, [{ op: 'rename', id: 'API', to: 'Gateway' }]);
    if (!renamed.ok) throw new Error(renamed.error.message);
    expect(followRelationIds(first.model, renamed.model, shared.viewRelations.overview, new Map([['API', 'Gateway']]))).toEqual({ 'Gateway→DB': 'sql' });
  });
});
