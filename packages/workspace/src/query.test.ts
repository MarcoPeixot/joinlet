import { applyOps, emptyModel } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { addItem, newWorkspace } from './workspace';
import { diagramElement, focusedContext, graphNeighbors, graphPath, impactedBy, modelIndex, searchModel } from './query';

describe('architecture queries', () => {
  const applied = applyOps(emptyModel(), [
    { op: 'add_node', id: 'Web' }, { op: 'add_node', id: 'API' }, { op: 'add_node', id: 'DB' },
    { op: 'connect', from: 'Web', to: 'API', label: 'HTTPS' }, { op: 'connect', from: 'API', to: 'DB' },
  ]);
  if (!applied.ok) throw new Error(applied.error.message);
  const model = applied.model;

  it('finds direct and multi-hop neighbors and directed paths', () => {
    expect(graphNeighbors(model, 'Web').nodes).toEqual(['Web', 'API']);
    expect(graphNeighbors(model, 'Web', 2).nodes).toEqual(['Web', 'API', 'DB']);
    expect(graphPath(model, 'Web', 'DB')?.map((edge) => edge.from)).toEqual(['Web', 'API']);
    expect(graphPath(model, 'DB', 'Web')).toBeNull();
  });

  it('scopes component identity and context to a diagram', () => {
    const data = addItem(newWorkspace('Loja'), 'diagram', 'Principal', { model, layout: { nodes: {}, edges: {} } }).data;
    expect(diagramElement(data, 'principal', 'API')?.id).toBe('API');
    expect(diagramElement(data, 'outro', 'API')).toBeUndefined();
    expect(focusedContext(data, 'principal', 'Web')).toContain('Web > API — HTTPS');
    expect(focusedContext(data, 'principal', 'Sem nó')).toBeNull();
  });

  it('indexes shared identities once across views and reports upstream impact', () => {
    let data = addItem(newWorkspace('Loja'), 'diagram', 'Principal', { model, layout: { nodes: {}, edges: {} } }).data;
    data = addItem(data, 'diagram', 'Detalhe', { model, layout: { nodes: {}, edges: {} } }).data;
    data.shared = {
      version: 1,
      entities: { api: { id: 'api', label: 'API', tags: ['risk:high'] }, db: { id: 'db', label: 'DB' } },
      views: { principal: { API: 'api', DB: 'db' }, detalhe: { API: 'api', DB: 'db' } },
      relations: { sql: { id: 'sql', from: 'api', to: 'db', connector: '>' } },
      viewRelations: { principal: { 'API→DB': 'sql' }, detalhe: { 'API→DB': 'sql' } },
    };
    const index = modelIndex(data);
    expect(index.find((item) => item.key === 'api')?.views).toEqual([{ diagram: 'principal', localId: 'API' }, { diagram: 'detalhe', localId: 'API' }]);
    expect(index.find((item) => item.key === 'api')?.outgoing.filter((edge) => edge.key === 'db')).toHaveLength(1);
    expect(impactedBy(index, 'db')).toContain('api');
  });
});

describe('searchModel', () => {
  const applied = applyOps(emptyModel(), [
    { op: 'add_node', id: 'API', label: 'API de Pagamentos', tech: 'Fastify' }, { op: 'add_node', id: 'DB', label: 'Banco' }, { op: 'update', id: 'DB', set: { description: 'Guarda pedidos' } },
    { op: 'add_node', id: 'constructor' }, { op: 'connect', from: 'API', to: 'DB' },
  ]);
  if (!applied.ok) throw new Error(applied.error.message);
  const data = addItem(newWorkspace('Loja'), 'diagram', 'Principal', { model: applied.model, layout: { nodes: {}, edges: {} } }).data;
  data.shared = { version: 1, entities: { api: { id: 'api', label: 'API', tags: ['risk:high'] } }, views: { principal: { API: 'api' } }, relations: {}, viewRelations: {} };
  const ids = (query: string, extra: { diagram?: string; limit?: number } = {}) => searchModel(data, { query, ...extra }).map((hit) => hit.id);

  it('matches id, label, tech, description and tags without case or accents', () => {
    expect(ids('pagamentós')).toEqual(['API']);
    expect(ids('FASTIFY')).toEqual(['API']);
    expect(ids('pedidos')).toEqual(['DB']);
    expect(ids('risk:high')).toEqual(['API']);
    expect(searchModel(data, { query: 'api' })[0]).toMatchObject({ diagram: 'principal', kind: 'node', degree: 1, evidence: 0 });
  });

  it('fuzzy-matches subsequences for 3+ characters, ranks exact above partial and is deterministic', () => {
    expect(ids('pgt')).toEqual(['API']);
    expect(ids('db')[0]).toBe('DB');
    expect(ids('a')).toEqual(ids('a'));
    expect(ids('a', { limit: 1 })).toHaveLength(1);
  });

  it('is safe with hostile input', () => {
    for (const query of ['.*', '(', '[a-', '__proto__', 'toString', '']) expect(() => searchModel(data, { query })).not.toThrow();
    expect(ids('__proto__')).toEqual([]);
    expect(ids('constructor')).toEqual(['constructor']);
    expect(ids('api', { diagram: '__proto__' })).toEqual([]);
    expect(ids('x'.repeat(10_000))).toEqual([]);
  });
});
