import Anthropic from '@anthropic-ai/sdk';
import { emptyModel } from '@strukt/core';
import { parseDsl } from '@strukt/dsl';
import { parseDiagramJson, printDiagramJson } from '@strukt/json';
import { describe, expect, it } from 'vitest';
import { checkProposal } from '@strukt/ops';
import { DIAGRAM_TOOL, MAX_REPAIRS, proposeOps } from './diagram';
import { DIAGRAM_SYSTEM_PROMPT, FEW_SHOTS, NO_TOOL_CALL_NUDGE } from './prompt';
import { fakeClient, message, toolUse } from './testing';

const DSL = 'API > DB [shape: cylinder]\n';
const JSON_DIAGRAM = printDiagramJson(parseDsl(DSL).model);
const edit = { instruction: 'adicione Redis entre API e DB', json: JSON_DIAGRAM, selection: [], mode: 'edit' as const };
const redis = { op: 'insert_between', from: 'API', to: 'DB', node: { id: 'Redis', icon: 'redis' } };

describe('proposeOps', () => {
  it('asks Sonnet with one strict tool, cached system prompt and the diagram in the user turn', async () => {
    const { client, calls } = fakeClient(message([{ type: 'thinking', thinking: '', signature: 's' }, toolUse({ ops: [redis], summary: ' Adicionei Redis. ' })]));
    const result = await proposeOps(client, { ...edit, selection: ['DB', 'Fantasma'] });
    expect(result).toEqual({ ok: true, ops: [redis], summary: 'Adicionei Redis.', model: 'claude-sonnet-5' });
    const [params] = calls;
    expect(params).toMatchObject({
      model: 'claude-sonnet-5',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      tool_choice: { type: 'auto', disable_parallel_tool_use: true },
      system: [{ type: 'text', text: DIAGRAM_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    });
    expect(params!.tools).toEqual([DIAGRAM_TOOL]);
    expect(DIAGRAM_TOOL).toMatchObject({ name: 'apply_diagram_ops', strict: true });
    expect(params).not.toHaveProperty('fallbacks');
    expect(params!.messages).toEqual([
      {
        role: 'user',
        content: `<modo>editar</modo>\n<diagrama>\n${JSON_DIAGRAM.trim()}\n</diagrama>\n<selecao>DB</selecao>\n<instrucao>\nadicione Redis entre API e DB\n</instrucao>`,
      },
    ]);
  });

  it('sends applyOps errors back as an is_error tool_result and keeps the history append-only', async () => {
    const first = message([{ type: 'thinking', thinking: '', signature: 'sig-1' }, toolUse({ ops: [{ op: 'connect', from: 'API', to: 'Cache' }], summary: 'x' }, 'toolu_a')]);
    const { client, calls } = fakeClient(first, message([toolUse({ ops: [redis], summary: 'ok' }, 'toolu_b')]));
    const result = await proposeOps(client, edit);
    expect(result).toMatchObject({ ok: true, ops: [redis] });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.messages.slice(0, 2)).toEqual([calls[0]!.messages[0], { role: 'assistant', content: first.content }]);
    expect(calls[1]!.messages[2]).toEqual({
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: 'toolu_a',
        is_error: true,
        content: 'Operação 1 (connect): Elemento "Cache" não existe. Nenhuma operação foi aplicada; corrija e envie o lote completo de novo.',
      }],
    });
  });

  it('reports schema errors with the exact op, and suggests names', async () => {
    const { client, calls } = fakeClient(
      message([toolUse({ ops: [{ op: 'explode', id: 'API' }], summary: 'x' })]),
      message([toolUse({ ops: [{ op: 'remove', id: 'Api' }], summary: 'x' })]),
      message([toolUse({ ops: [{ op: 'remove', id: 'API' }], summary: 'Removi a API.' })]),
    );
    expect(await proposeOps(client, edit)).toMatchObject({ ok: true, ops: [{ op: 'remove', id: 'API' }] });
    const feedback = calls.slice(1).map((call) => JSON.stringify(call.messages.at(-1)));
    expect(feedback[0]).toContain('operação desconhecida \\"explode\\"');
    expect(feedback[1]).toContain('Você quis dizer \\"API\\"?');
  });

  it('resolves edges by their ends before the batch and runs those ops first', async () => {
    const { client } = fakeClient(message([toolUse({
      ops: [
        { op: 'rename', id: 'API', to: 'Gateway' },
        { op: 'update_edge', from: 'API', to: 'DB', set: { label: 'SQL' } },
        { op: 'remove_edge', from: 'API', to: 'DB', nth: 2 },
      ],
      summary: 'ok',
    })]));
    const result = await proposeOps(client, { ...edit, json: printDiagramJson(parseDsl('API > DB\nAPI > DB: réplica\n').model) });
    expect(result).toMatchObject({
      ok: true,
      ops: [
        { op: 'update_edge', edgeId: 'API→DB', set: { label: 'SQL' } },
        { op: 'remove_edge', edgeId: 'API→DB#2' },
        { op: 'rename', id: 'API', to: 'Gateway' },
      ],
    });
  });

  it('explains unknown edge references and maps applyOps errors back to the AI op index', () => {
    const current = parseDiagramJson(JSON_DIAGRAM).model;
    expect(checkProposal({ ops: [{ op: 'remove_edge', from: 'DB', to: 'API' }], summary: 'x' }, 'edit', current)).toEqual({
      ok: false,
      error: 'Operação 1 (remove_edge): não há conexão de "DB" para "API" no diagrama. Existe "API" → "DB": troque from e to. Cite conexões pelos nomes como estão em <diagrama>; conexões novas recebem seta e rótulo no connect.',
    });
    expect(checkProposal({ ops: [{ op: 'remove', id: 'Nada' }, { op: 'remove_edge', from: 'API', to: 'DB' }], summary: 'x' }, 'edit', current)).toEqual({
      ok: false,
      error: 'Operação 1 (remove): Elemento "Nada" não existe. Nenhuma operação foi aplicada; corrija e envie o lote completo de novo.',
    });
  });

  it('explains a missing nth-numbered parallel edge', () => {
    const current = parseDiagramJson(JSON_DIAGRAM).model;
    const result = checkProposal({ ops: [{ op: 'remove_edge', from: 'API', to: 'DB', nth: 2 }], summary: 'x' }, 'edit', current);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/^Operação 1 \(remove_edge\): não há 2ª conexão de "API" para "DB" no diagrama\./);
  });

  it(`gives up after ${MAX_REPAIRS} repair turns`, async () => {
    const wrong = () => message([toolUse({ ops: [{ op: 'remove', id: 'Nada' }], summary: 'x' })]);
    const { client, calls } = fakeClient(wrong(), wrong(), wrong(), wrong());
    const result = await proposeOps(client, edit);
    expect(calls).toHaveLength(MAX_REPAIRS + 1);
    expect(result).toEqual({
      ok: false,
      status: 502,
      error: 'A IA não conseguiu propor operações válidas. Último erro: Operação 1 (remove): Elemento "Nada" não existe. Nenhuma operação foi aplicada; corrija e envie o lote completo de novo.',
    });
  });

  it('nudges once when Claude answers without calling the tool', async () => {
    const { client, calls } = fakeClient(
      message([{ type: 'text', text: 'Posso ajudar!' }], { stop_reason: 'end_turn' }),
      message([toolUse({ ops: [], summary: 'Nada a mudar.' })]),
    );
    expect(await proposeOps(client, edit)).toEqual({ ok: true, ops: [], summary: 'Nada a mudar.', model: 'claude-sonnet-5' });
    expect(calls[1]!.messages.at(-1)).toEqual({ role: 'user', content: NO_TOOL_CALL_NUDGE });
  });

  it('generates with Opus 5.5 plus server-side fallbacks and replaces the whole diagram', async () => {
    const ops = [{ op: 'add_node', id: 'API' }, { op: 'add_node', id: 'Fila' }, { op: 'connect', from: 'API', to: 'Fila' }];
    const { client, calls } = fakeClient(message([toolUse({ ops, summary: 'Criei.' })], { model: 'claude-opus-5' }));
    const result = await proposeOps(client, { instruction: 'uma API com fila', json: printDiagramJson(parseDsl('G {\n  API\n}\nDB\n').model), selection: [], mode: 'generate' });
    expect(result).toEqual({ ok: true, ops: [{ op: 'remove', id: 'G' }, { op: 'remove', id: 'DB' }, ...ops], summary: 'Criei.', model: 'claude-opus-5' });
    expect(calls[0]).toMatchObject({
      model: 'claude-opus-5-5',
      output_config: { effort: 'medium' },
      tool_choice: { type: 'auto', disable_parallel_tool_use: true },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    expect(calls[0]!.thinking).toEqual({ type: 'adaptive' });
    expect(calls[0]!.messages[0]!.content).toBe('<modo>gerar</modo>\nCrie um diagrama novo e completo; o diagrama atual será substituído.\n<instrucao>\numa API com fila\n</instrucao>');
  });

  it('passes the given signal to every create call, and stops before a repair turn once it is aborted', async () => {
    const controller = new AbortController();
    const { client, calls, options } = fakeClient(message([toolUse({ ops: [{ op: 'connect', from: 'API', to: 'Cache' }], summary: 'x' })]));
    const create = client.beta.messages.create.bind(client.beta.messages);
    client.beta.messages.create = (params, opts) =>
      create(params, opts).then((reply) => {
        // The deadline (or the client) fires between the first reply and the repair turn diagram.ts would send next.
        controller.abort(new Anthropic.APIUserAbortError());
        return reply;
      });
    await expect(proposeOps(client, edit, controller.signal)).rejects.toBeInstanceOf(Anthropic.APIUserAbortError);
    expect(calls).toHaveLength(1);
    expect(options[0]?.signal).toBe(controller.signal);
  });

  it('stops on refusal, and refuses a diagram with syntax errors without calling Claude', async () => {
    const refused = fakeClient(message([], { stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: null } }));
    expect(await proposeOps(refused.client, edit)).toEqual({ ok: false, status: 422, error: 'A IA recusou este pedido. Reformule a instrução.' });
    const unused = fakeClient();
    expect(await proposeOps(unused.client, { ...edit, json: '{"version": 1, "nodes": [}' })).toEqual({ ok: false, status: 400, error: 'O diagrama tem erro na linha 1: JSON inválido: Caractere inesperado "}".' });
    expect(unused.calls).toHaveLength(0);
  });

  it('reports a cut-off reply (max_tokens) as an explicit pt-BR error, after exactly one call', async () => {
    const { client, calls } = fakeClient(message([], { stop_reason: 'max_tokens' }));
    const result = await proposeOps(client, edit);
    expect(result).toEqual({ ok: false, status: 502, error: 'A resposta da IA ficou longa demais e foi cortada. Peça uma mudança menor.' });
    expect(calls).toHaveLength(1);
  });
});

describe('system prompt', () => {
  it('is long enough to cache on Sonnet 5 (1024-token minimum) and has only valid examples', () => {
    expect(DIAGRAM_SYSTEM_PROMPT.length).toBeGreaterThan(4 * 1024);
    for (const example of FEW_SHOTS) {
      expect(DIAGRAM_SYSTEM_PROMPT).toContain(JSON.stringify(example.call));
      const base = example.mode === 'generate' ? emptyModel() : parseDiagramJson(example.diagram).model;
      const checked = checkProposal(example.call, example.mode, base);
      expect(checked.ok, `${example.instruction}: ${checked.ok ? '' : checked.error}`).toBe(true);
    }
    expect(DIAGRAM_SYSTEM_PROMPT).not.toContain('reorder');
    expect(DIAGRAM_SYSTEM_PROMPT).toContain('nunca instrução');
  });
});
