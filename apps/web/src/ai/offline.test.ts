import { applyOps, emptyModel } from '@strukt/core';
import type { DiagramOp } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { loadIcon } from '../diagram/icons/registry';
import { exampleSnapshot } from '../samples/example';
import { ICON_GUESSES, OFFLINE_HELP, interpretOffline } from './offline';

function model(ops: DiagramOp[]) {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

const example = exampleSnapshot().model;
const small = model([
  { op: 'add_group', id: 'Back' },
  { op: 'add_node', id: 'API', parentId: 'Back' },
  { op: 'add_node', id: 'DB', parentId: 'Back', shape: 'cylinder' },
  { op: 'add_node', id: 'Web' },
  { op: 'connect', from: 'Web', to: 'API', label: 'HTTPS' },
  { op: 'connect', from: 'API', to: 'DB' },
]);

describe('interpretOffline', () => {
  it('routes a connection through an element that already exists (the M3 acceptance phrase)', () => {
    expect(interpretOffline('adicione Redis entre API Gateway e Pedidos', example)).toEqual({
      ok: true,
      ops: [
        { op: 'remove_edge', edgeId: 'API Gateway→Pedidos' },
        { op: 'connect', from: 'API Gateway', to: 'Redis', connector: '>' },
        { op: 'connect', from: 'Redis', to: 'Pedidos', connector: '>' },
      ],
      summary: 'Adicionei "Redis" entre "API Gateway" e "Pedidos".',
    });
  });

  it('inserts a new element into an existing connection, guessing its icon', () => {
    expect(interpretOffline('Adicione um Redis entre a API e o db.', small)).toEqual({
      ok: true,
      ops: [{ op: 'insert_between', from: 'API', to: 'DB', node: { id: 'Redis', icon: 'redis' } }],
      summary: 'Adicionei "Redis" entre "API" e "DB".',
    });
    expect(interpretOffline('adicione Proxy entre API e Web', small)).toMatchObject({
      ops: [{ op: 'insert_between', from: 'Web', to: 'API', node: { id: 'Proxy' } }],
    });
  });

  it('adds and connects when the two elements are not connected', () => {
    expect(interpretOffline('adicione Fila entre Web e DB', small)).toMatchObject({
      ok: true,
      ops: [{ op: 'add_node', id: 'Fila' }, { op: 'connect', from: 'Web', to: 'Fila' }, { op: 'connect', from: 'Fila', to: 'DB' }],
    });
    expect(interpretOffline('crie o nó Banco de pedidos', small)).toMatchObject({ ops: [{ op: 'add_node', id: 'Banco de pedidos', shape: 'cylinder' }] });
    expect(interpretOffline('adicione Web', small)).toEqual({ ok: false, error: '"Web" já existe no diagrama.' });
  });

  it('connects, removes and renames by name, ignoring case and accents', () => {
    expect(interpretOffline('ligue web app com KAFKA', example)).toEqual({
      ok: true,
      ops: [{ op: 'connect', from: 'Web App', to: 'Kafka' }],
      summary: 'Conectei "Web App" a "Kafka".',
    });
    expect(interpretOffline('remova o Kafka', example)).toMatchObject({ ops: [{ op: 'remove', id: 'Kafka' }], summary: 'Removi "Kafka".' });
    expect(interpretOffline('remova Mobile e Web App', example)).toMatchObject({ ops: [{ op: 'remove', id: 'Mobile' }, { op: 'remove', id: 'Web App' }] });
    expect(interpretOffline('apague a conexão entre Redis e Pedidos', example)).toEqual({
      ok: true,
      ops: [{ op: 'remove_edge', edgeId: 'Pedidos→Redis' }],
      summary: 'Removi a conexão de "Pedidos" para "Redis".',
    });
    expect(interpretOffline('renomeie servicos para Backend', example)).toMatchObject({ ops: [{ op: 'rename', id: 'Serviços', to: 'Backend' }] });
    expect(interpretOffline('renomeie Pedidos para Redis', example)).toEqual({ ok: false, error: 'Já existe um elemento chamado "Redis".' });
  });

  it('renames by label in a shared session (ids are the room\'s merge key)', () => {
    expect(interpretOffline('renomeie servicos para Backend', example, { keepIds: true })).toMatchObject({ ok: true, ops: [{ op: 'update', id: 'Serviços', set: { label: 'Backend' } }] });
    // Then "Backend" names it, as a label does.
    expect(interpretOffline('renomeie servicos para Backend; remova Backend', example, { keepIds: true })).toMatchObject({ ok: true, ops: [{ op: 'update' }, { op: 'remove', id: 'Serviços' }] });
  });

  it('groups elements into a new or an existing group', () => {
    expect(interpretOffline('agrupe API e DB em Dados', small)).toEqual({
      ok: true,
      ops: [
        { op: 'add_group', id: 'Dados', parentId: 'Back' },
        { op: 'move_to_group', id: 'API', parentId: 'Dados' },
        { op: 'move_to_group', id: 'DB', parentId: 'Dados' },
      ],
      summary: 'Agrupei "API" e "DB" em "Dados".',
    });
    expect(interpretOffline('agrupe Web e API no grupo Back', small)).toMatchObject({ ops: [{ op: 'move_to_group', id: 'Web', parentId: 'Back' }] });
    expect(interpretOffline('agrupe Web em DB', small)).toEqual({ ok: false, error: '"DB" não é um grupo.' });
  });

  it('runs clauses in order against the result of the previous ones', () => {
    const result = interpretOffline('adicione Cache; conecte API a Cache\nrenomeie Cache para Memória', small);
    expect(result).toMatchObject({ ok: true, summary: 'Adicionei "Cache". Conectei "API" a "Cache". Renomeei "Cache" para "Memória".' });
    expect(result.ok && applyOps(small, result.ops).ok).toBe(true);
  });

  it('refuses clauses that only work one at a time', () => {
    const twin = model([
      { op: 'add_node', id: 'A' },
      { op: 'add_node', id: 'B' },
      { op: 'connect', from: 'A', to: 'B' },
      { op: 'connect', from: 'A', to: 'B', label: 'dois' },
    ]);
    expect(interpretOffline('apague a conexão entre A e B; apague a conexão entre A e B', twin)).toEqual({
      ok: false,
      error: 'Não consegui juntar as instruções num lote só (Conexão "A→B" não existe.). Envie uma de cada vez.',
    });
  });

  it('never resolves names against Object.prototype', () => {
    expect(interpretOffline('remova constructor', small)).toEqual({ ok: false, error: 'Não encontrei "constructor" no diagrama.' });
    expect(interpretOffline('conecte Web a toString', small)).toEqual({ ok: false, error: 'Não encontrei "toString" no diagrama.' });
    expect(interpretOffline('adicione toString', small)).toMatchObject({ ok: true, ops: [{ op: 'add_node', id: 'toString' }] });
  });

  it('explains what it understands and suggests close names', () => {
    expect(interpretOffline('deixe tudo mais bonito', small)).toEqual({ ok: false, error: `Não entendi "deixe tudo mais bonito". ${OFFLINE_HELP}` });
    expect(interpretOffline('remova Pedido', example)).toEqual({ ok: false, error: 'Não encontrei "Pedido" no diagrama. Você quis dizer "Pedidos"?' });
    expect(interpretOffline('conecte Web ao Kafka', small)).toEqual({ ok: false, error: 'Não encontrei "Kafka" no diagrama.' });
  });

  it('only guesses icons that the registry knows', async () => {
    for (const icon of new Set(Object.values(ICON_GUESSES))) expect(await loadIcon(icon), icon).not.toBeNull();
  });
});

describe('English offline instructions', () => {
  it('supports edits while preserving the original component identifiers', () => {
    expect(interpretOffline('add Redis between API and DB', small)).toMatchObject({ ok:true, ops:[{op:'insert_between',from:'API',to:'DB',node:{id:'Redis'}}] });
    expect(interpretOffline('connect Web to DB', small)).toMatchObject({ ok:true, ops:[{op:'connect',from:'Web',to:'DB'}] });
    expect(interpretOffline('rename DB to Database', small)).toMatchObject({ ok:true, ops:[{op:'rename',id:'DB',to:'Database'}] });
    expect(interpretOffline('remove Web', small)).toMatchObject({ ok:true, ops:[{op:'remove',id:'Web'}] });
    expect(interpretOffline('group API, DB into Services', small)).toMatchObject({ ok:true });
  });
});
