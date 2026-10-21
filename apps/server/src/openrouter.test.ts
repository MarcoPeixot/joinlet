import { describe, expect, it, vi } from 'vitest';
import { proposeOps } from './diagram';
import { ProviderError, createOpenRouterClient } from './openrouter';

type Json = Record<string, unknown>;

/** Fake OpenRouter: records request bodies and replies in order (no network). */
function fakeFetch(...replies: (Json | Response)[]) {
  const bodies: Json[] = [];
  const requests: RequestInit[] = [];
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push(init ?? {});
    bodies.push(JSON.parse(String(init?.body)));
    const next = replies.shift();
    if (!next) throw new Error('no reply left');
    return next instanceof Response ? next : new Response(JSON.stringify(next), { status: 200 });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, bodies, requests, mock: fetch };
}

const choice = (message: Json, finish_reason = 'stop') => ({ id: 'gen-1', model: 'anthropic/claude-sonnet', choices: [{ message, finish_reason }], usage: { prompt_tokens: 12, completion_tokens: 7 } });

describe('createOpenRouterClient (the Anthropic-shaped client over OpenRouter chat completions)', () => {
  it('translates system, tools, tool calls and tool results; drops Anthropic-only parameters', async () => {
    const { fetch, bodies, requests, mock } = fakeFetch(choice({ role: 'assistant', content: 'ok' }));
    const client = createOpenRouterClient({ apiKey: 'sk-or-1', fetch });
    await client.beta.messages.create({
      model: 'anthropic/claude-sonnet',
      max_tokens: 900,
      thinking: { type: 'adaptive' },
      betas: ['x'],
      system: [{ type: 'text', text: 'Você é o Joinlet.', cache_control: { type: 'ephemeral' } }],
      tools: [{ name: 'apply_diagram_ops', description: 'Aplica', strict: true, input_schema: { type: 'object', properties: {} } }],
      tool_choice: { type: 'auto', disable_parallel_tool_use: true },
      messages: [
        { role: 'user', content: 'adicione um Redis' },
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm', signature: 's' }, { type: 'text', text: 'Vou chamar.' }, { type: 'tool_use', id: 'call_1', name: 'apply_diagram_ops', input: { ops: [] } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', is_error: true, content: 'Operação 1 inválida.' }] },
      ],
    } as never);
    expect(String(mock.mock.calls[0]![0])).toBe('https://openrouter.ai/api/v1/chat/completions');
    const headers = new Headers(requests[0]!.headers);
    expect(headers.get('authorization')).toBe('Bearer sk-or-1');
    expect(headers.get('x-title')).toBe('Joinlet');
    expect(bodies[0]).toEqual({
      model: 'anthropic/claude-sonnet',
      max_tokens: 900,
      messages: [
        { role: 'system', content: 'Você é o Joinlet.' },
        { role: 'user', content: 'adicione um Redis' },
        { role: 'assistant', content: 'Vou chamar.', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'apply_diagram_ops', arguments: '{"ops":[]}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: 'Erro: Operação 1 inválida.' },
      ],
      tools: [{ type: 'function', function: { name: 'apply_diagram_ops', description: 'Aplica', parameters: { type: 'object', properties: {} }, strict: true } }],
      tool_choice: 'auto',
      parallel_tool_calls: false,
    });
  });

  it('turns the reply into an Anthropic message: text, tool_use with parsed input, stop reasons', async () => {
    const { fetch } = fakeFetch(
      choice({ role: 'assistant', content: 'Pronto.', tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'apply_diagram_ops', arguments: '{"ops":[{"op":"remove","id":"DB"}],"summary":"x"}' } }] }, 'tool_calls'),
      choice({ role: 'assistant', content: 'cortado' }, 'length'),
      choice({ role: 'assistant', content: null }, 'content_filter'),
    );
    const client = createOpenRouterClient({ apiKey: 'k', fetch });
    const params = { model: 'm', max_tokens: 10, messages: [{ role: 'user', content: 'oi' }] } as never;
    const first = await client.beta.messages.create(params);
    expect(first).toMatchObject({
      model: 'anthropic/claude-sonnet',
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'Pronto.' },
        { type: 'tool_use', id: 'call_9', name: 'apply_diagram_ops', input: { ops: [{ op: 'remove', id: 'DB' }], summary: 'x' } },
      ],
      usage: { input_tokens: 12, output_tokens: 7 },
    });
    expect((await client.beta.messages.create(params)).stop_reason).toBe('max_tokens');
    expect((await client.beta.messages.create(params)).stop_reason).toBe('refusal');
  });

  it('reports HTTP errors as ProviderError and forwards the abort signal', async () => {
    const { fetch, requests } = fakeFetch(new Response(JSON.stringify({ error: { message: 'User not found.' } }), { status: 401 }));
    const client = createOpenRouterClient({ apiKey: 'bad', fetch });
    const controller = new AbortController();
    const failure = client.beta.messages.create({ model: 'm', max_tokens: 10, messages: [{ role: 'user', content: 'oi' }] } as never, { signal: controller.signal });
    await expect(failure).rejects.toEqual(new ProviderError(401, 'User not found.'));
    expect(requests[0]!.signal).toBe(controller.signal);
  });

  it('drives the whole diagram repair loop unchanged', async () => {
    const call = (args: unknown) => choice({ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'apply_diagram_ops', arguments: JSON.stringify(args) } }] }, 'tool_calls');
    const { fetch, bodies } = fakeFetch(call({ ops: [{ op: 'remove', id: 'Nope' }], summary: 'x' }), call({ ops: [{ op: 'remove', id: 'DB' }], summary: 'Removi o DB.' }));
    const client = createOpenRouterClient({ apiKey: 'k', fetch });
    const models = { edit: 'anthropic/claude-sonnet', generate: 'anthropic/claude-opus', doc: 'anthropic/claude-sonnet' };
    const result = await proposeOps(client, { instruction: 'remova o DB', json: '{"version":1,"nodes":[{"id":"API"},{"id":"DB"}],"connections":[{"from":"API","to":"DB"}]}', selection: [], mode: 'edit' }, undefined, models);
    expect(result).toEqual({ ok: true, ops: [{ op: 'remove', id: 'DB' }], summary: 'Removi o DB.', model: 'anthropic/claude-sonnet' });
    expect(bodies[0]!.model).toBe('anthropic/claude-sonnet');
    // The repair turn carries the tool error back as a `tool` message.
    expect((bodies[1]!.messages as Json[]).at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
  });
});


describe('createOpenRouterClient stream', () => {
  const sse = (...events: (Json | '[DONE]')[]) => new Response(
    new ReadableStream({ start(controller) {
      for (const event of events) controller.enqueue(new TextEncoder().encode(`data: ${event === '[DONE]' ? event : JSON.stringify(event)}\n\n`));
      controller.close();
    } }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
  const delta = (content: string, finish_reason: string | null = null) => ({ choices: [{ delta: { content }, finish_reason }] });
  const params = { model: 'm', max_tokens: 10, messages: [{ role: 'user', content: 'oi' }] } as never;
  const collect = async (events: AsyncIterable<unknown>) => { const out: unknown[] = []; for await (const event of events) out.push(event); return out; };

  it('asks for a stream and turns each delta into a text_delta event, then the stop reason', async () => {
    const { fetch, bodies } = fakeFetch(sse(delta('Olá'), delta(', mundo'), { choices: [{ delta: {}, finish_reason: 'stop' }] }, '[DONE]'));
    const client = createOpenRouterClient({ apiKey: 'k', fetch });
    const events = await collect(client.beta.messages.stream!(params));
    expect(bodies[0]).toMatchObject({ stream: true, model: 'm' });
    expect(events).toEqual([
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Olá' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: ', mundo' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    ]);
  });

  it('maps a content filter to a refusal and keeps a line split across chunks whole', async () => {
    const body = new ReadableStream({ start(controller) {
      const line = `data: ${JSON.stringify(delta('inteiro', 'content_filter'))}\n\n`;
      controller.enqueue(new TextEncoder().encode(line.slice(0, 15)));
      controller.enqueue(new TextEncoder().encode(line.slice(15)));
      controller.close();
    } });
    const { fetch } = fakeFetch(new Response(body, { status: 200 }));
    const events = await collect(createOpenRouterClient({ apiKey: 'k', fetch }).beta.messages.stream!(params));
    expect(events).toEqual([
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'inteiro' } },
      { type: 'message_delta', delta: { stop_reason: 'refusal' } },
    ]);
  });

  it('throws a ProviderError for a non-2xx answer', async () => {
    const { fetch } = fakeFetch(new Response(JSON.stringify({ error: { message: 'sem créditos' } }), { status: 402 }));
    await expect(collect(createOpenRouterClient({ apiKey: 'k', fetch }).beta.messages.stream!(params))).rejects.toMatchObject({ status: 402, message: 'sem créditos' });
  });
});
