import { describe, expect, it, vi } from 'vitest';
import { applyOps } from '@strukt/core';
import { parseDiagramJson, printDiagramJson } from '@strukt/json';
import { MODELS } from './anthropic';
import type { AiClient, CreateParams, Message, StreamEvent } from './anthropic';
import { MAX_CHAT_REPAIRS, replyToEditableChat, streamEditableChat } from './chatEdit';
import type { ChatEditEvent } from './chatEdit';
import { fakeClient, message } from './testing';

const original = JSON.stringify({ version: 1, nodes: [{ id: 'API' }], connections: [] });
const target = { kind: 'diagram' as const, slug: 'rag', content: original };
const request = { context: 'Arquitetura RAG', messages: [{ role: 'user' as const, content: 'Analise esse diagrama, melhore e coloque mais informações.' }] };
const response = (input: unknown, id = 'tool1'): Message => message([{ type: 'tool_use', id, name: 'edit_diagram', input }]);
const invalid = { summary: 'Proposta inválida', ops: [{ op: 'add_node', id: 'Parcial' }, { op: 'add_node', id: 'Cache', unknown: true }] };
const valid = { summary: 'Cache com responsabilidades', ops: [{ op: 'add_node', id: 'Cache', description: 'Armazena respostas frequentes.', tech: 'Redis' }, { op: 'connect', from: 'API', to: 'Cache' }] };
const collect = async (client: AiClient) => {
  const events: ChatEditEvent[] = [];
  for await (const event of streamEditableChat(client, request, target, new AbortController().signal, MODELS)) events.push(event);
  return events;
};

describe('chat diagram validation and repair', () => {
  it('accepts the screenshot case: many new components with descriptions, and keeps all information in JSON', async () => {
    const ops = Array.from({ length: 10 }, (_, i) => ({ op: 'add_node', id: `Componente ${i}`, description: `Responsabilidade ${i}`, tech: 'Node.js' }));
    const fake = fakeClient(response({ ops, summary: 'Arquitetura detalhada.' }));
    const result = await replyToEditableChat(fake.client, request, target, new AbortController().signal, MODELS);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.tools![0]).toMatchObject({ name: 'edit_diagram', strict: true });
    expect(result.ok).toBe(true);
    if (!result.ok || result.edit?.kind !== 'diagram') throw new Error('Expected diagram edit');
    const applied = applyOps(parseDiagramJson(original).model, result.edit.ops);
    if (!applied.ok) throw new Error(applied.error.message);
    const saved = parseDiagramJson(printDiagramJson(applied.model)).model;
    for (let i = 0; i < 10; i++) expect(saved.elements[`Componente ${i}`]).toMatchObject({ description: `Responsabilidade ${i}`, tech: 'Node.js' });
  });
  it('returns validation errors to the tool and applies only the repaired complete batch to the original', async () => {
    const fake = fakeClient(response(invalid, 'bad1'), response(valid, 'fixed1'));
    const result = await replyToEditableChat(fake.client, request, target, new AbortController().signal, MODELS);
    expect(result).toMatchObject({ ok: true, edit: { ops: valid.ops } });
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.messages.at(-1)).toMatchObject({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'bad1', is_error: true }] });
    expect(JSON.stringify(fake.calls[1]!.messages.at(-1))).toContain('unknown');
    expect(target.content).toBe(original);
  });
  it('bounds failed repairs and gives the user a short error without emitting invalid operations', async () => {
    const fake = fakeClient(...Array.from({ length: MAX_CHAT_REPAIRS + 1 }, () => response(invalid)));
    const result = await replyToEditableChat(fake.client, request, target, new AbortController().signal, MODELS);
    expect(fake.calls).toHaveLength(MAX_CHAT_REPAIRS + 1);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Nenhuma mudança foi aplicada') });
    if (!result.ok) expect(result.error).not.toContain('ops[');
  });
  it('does not treat a text-only repair answer as an applied edit', async () => {
    const fake = fakeClient(response(invalid), message([{ type: 'text', text: 'Atualizei tudo.' }], { stop_reason: 'end_turn' }));
    expect(await replyToEditableChat(fake.client, request, target, new AbortController().signal, MODELS)).toMatchObject({ ok: false });
  });
  it('stops before a repair call when the request was cancelled', async () => {
    const controller = new AbortController();
    const create = vi.fn(async () => { controller.abort(); return response(invalid); });
    const client: AiClient = { beta: { messages: { create } } };
    await expect(replyToEditableChat(client, request, target, controller.signal, MODELS)).rejects.toMatchObject({ name: 'AbortError' });
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('repairs streamed tool inputs with the original tool id, emits one edit and does not repeat prose', async () => {
    const calls: CreateParams[] = [];
    const client: AiClient = { beta: { messages: {
      create: async () => { throw new Error('Expected streaming'); },
      async *stream(params) {
        calls.push(structuredClone(params));
        const index = calls.length;
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Vou detalhar a arquitetura.' } };
        yield { type: 'content_block_start', index: 7, content_block: { type: 'tool_use', id: `stream${index}`, name: 'edit_diagram', input: {} } };
        yield { type: 'content_block_delta', index: 7, delta: { type: 'input_json_delta', partial_json: JSON.stringify(index === 1 ? invalid : valid) } };
        yield { type: 'message_delta', delta: { stop_reason: 'tool_use' } };
      },
    } } };
    expect(await collect(client)).toEqual([{ t: 'Vou detalhar a arquitetura.' }, { edit: { kind: 'diagram', ...valid } }]);
    expect(calls[1]!.messages.at(-1)).toMatchObject({ content: [{ tool_use_id: 'stream1', is_error: true }] });
  });
  it('never emits an edit after the streamed repair budget is exhausted', async () => {
    const events: ChatEditEvent[] = [];
    let calls = 0;
    const client: AiClient = { beta: { messages: {
      create: async () => { throw new Error('Expected streaming'); },
      async *stream(): AsyncGenerator<StreamEvent> {
        calls++;
        yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `bad${calls}`, name: 'edit_diagram', input: invalid } };
        yield { type: 'message_delta', delta: { stop_reason: 'tool_use' } };
      },
    } } };
    await expect(async () => { for await (const event of streamEditableChat(client, request, target, new AbortController().signal, MODELS)) events.push(event); }).rejects.toThrow('Nenhuma mudança foi aplicada');
    expect(events).toEqual([]);
    expect(calls).toBe(MAX_CHAT_REPAIRS + 1);
  });
});

it('repairs a streamed OpenCode Go response through the full chat HTTP route', async () => {
  const { createSettings } = await import('./settings');
  const { createApp } = await import('./app');
  const calls: { body: Record<string, unknown>; session: string | null }[] = [];
  const fetch = async (_input: string | URL | Request, init?: RequestInit) => {
    calls.push({ body: JSON.parse(init?.body as string), session: new Headers(init?.headers).get('x-opencode-session') });
    const input = calls.length === 1 ? invalid : valid;
    const chunks = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: `go${calls.length}`, function: { name: 'edit_diagram', arguments: JSON.stringify(input) } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ];
    return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  const unused = {} as AiClient;
  const settings = createSettings({ file: '/fake', env: {}, fs: { read: async () => null, write: async () => {} }, anthropic: () => unused, openrouter: () => unused, fetch: fetch as typeof globalThis.fetch });
  await settings.load();
  await settings.update({ provider: 'opencodego', keys: { opencodego: 'test-key' } });
  const app = createApp({ settings });
  const res = await app.request('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-strukt-session': 'same-conversation' }, body: JSON.stringify({ ...request, target, stream: true }) });
  expect(res.status).toBe(200);
  const events = (await res.text()).trim().split('\n').map((line) => JSON.parse(line));
  expect(events).toEqual([{ t: 'Alteração preparada.' }, { edit: { kind: 'diagram', ...valid } }, { done: true }]);
  expect(calls).toHaveLength(2);
  expect(calls.map((call) => call.session)).toEqual(['same-conversation', 'same-conversation']);
  expect(JSON.stringify(calls[1]!.body.messages)).toContain('go1');
  expect(JSON.stringify(calls[1]!.body.messages)).toContain('tool_call_id');
});
