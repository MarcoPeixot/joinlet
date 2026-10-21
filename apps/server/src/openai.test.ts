import { describe, expect, it, vi } from 'vitest';
import { ProviderError, createChatCompletionsClient, normalizeBaseUrl } from './openai';

type Json = Record<string, unknown>;

function fakeFetch(...replies: (Json | Response)[]) {
  const bodies: Json[] = [];
  const requests: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    bodies.push(JSON.parse(String(init?.body)));
    const next = replies.shift();
    if (!next) throw new Error('no reply left');
    return next instanceof Response ? next : new Response(JSON.stringify(next), { status: 200 });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, bodies, requests };
}

const reply = (message: Json, finish_reason = 'stop') => ({ id: 'x', model: 'llama3.1', choices: [{ message, finish_reason }], usage: { prompt_tokens: 3, completion_tokens: 2 } });
const params = { model: 'llama3.1', max_tokens: 100, messages: [{ role: 'user', content: 'oi' }] } as never;
const tool = { name: 'apply_diagram_ops', description: 'Aplica', strict: true, input_schema: { type: 'object', properties: {} } };

describe('normalizeBaseUrl', () => {
  it.each([
    ['http://localhost:11434/v1', 'http://localhost:11434/v1'],
    ['  https://api.groq.com/openai/v1/  ', 'https://api.groq.com/openai/v1'],
    ['https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1'],
    ['http://127.0.0.1:1234', 'http://127.0.0.1:1234'],
  ])('accepts %s', (raw, expected) => {
    expect(normalizeBaseUrl(raw)).toBe(expected);
  });

  it.each([
    'ftp://example.com/v1',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'localhost:11434',
    'https://user:secret@example.com/v1',
    'https://example.com/v1?key=abc',
    'https://example.com/v1#frag',
    'https://exa mple.com',
    '',
    'x'.repeat(400),
  ])('refuses %j with a pt-BR reason', (raw) => {
    const result = normalizeBaseUrl(raw);
    expect(result).toEqual({ error: expect.stringMatching(/endereço|URL|http/i) });
  });

  it('refuses non-text', () => {
    expect(normalizeBaseUrl(42)).toEqual({ error: expect.any(String) });
  });
});

describe('createChatCompletionsClient', () => {
  it('posts to <baseUrl>/chat/completions with the optional key, no OpenRouter headers and no strict tools', async () => {
    const { fetch, bodies, requests } = fakeFetch(reply({ role: 'assistant', content: 'ok' }));
    const client = createChatCompletionsClient({ baseUrl: 'http://localhost:11434/v1', apiKey: 'sk-1', fetch, label: 'servidor' });
    await client.beta.messages.create({ ...(params as object), tools: [tool], tool_choice: { type: 'tool', name: 'apply_diagram_ops' } } as never);
    expect(requests[0]!.url).toBe('http://localhost:11434/v1/chat/completions');
    const headers = new Headers(requests[0]!.init.headers);
    expect(headers.get('authorization')).toBe('Bearer sk-1');
    expect(headers.get('x-title')).toBeNull();
    expect(requests[0]!.init.redirect).toBe('error');
    expect(bodies[0]!.tools).toEqual([{ type: 'function', function: { name: 'apply_diagram_ops', description: 'Aplica', parameters: { type: 'object', properties: {} } } }]);
    expect(bodies[0]!.tool_choice).toEqual({ type: 'function', function: { name: 'apply_diagram_ops' } });
  });

  it('works without a key (local servers): no authorization header at all', async () => {
    const { fetch, requests } = fakeFetch(reply({ role: 'assistant', content: 'ok' }));
    await createChatCompletionsClient({ baseUrl: 'http://localhost:11434/v1', fetch, label: 'servidor' }).beta.messages.create(params);
    expect(new Headers(requests[0]!.init.headers).has('authorization')).toBe(false);
  });

  it('can keep strict tools and extra headers (the OpenRouter configuration)', async () => {
    const { fetch, bodies, requests } = fakeFetch(reply({ role: 'assistant', content: 'ok' }));
    const client = createChatCompletionsClient({ baseUrl: 'https://x.test/api/v1', apiKey: 'k', fetch, label: 'x', strictTools: true, headers: { 'x-title': 'Joinlet' } });
    await client.beta.messages.create({ ...(params as object), tools: [tool] } as never);
    expect(new Headers(requests[0]!.init.headers).get('x-title')).toBe('Joinlet');
    expect((bodies[0]!.tools as Json[])[0]).toMatchObject({ function: { strict: true } });
  });

  it('turns the answer into an Anthropic message, tool calls included', async () => {
    const { fetch } = fakeFetch(reply({ role: 'assistant', content: 'Pronto.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'apply_diagram_ops', arguments: '{"ops":[]}' } }] }, 'tool_calls'));
    const message = await createChatCompletionsClient({ baseUrl: 'http://h/v1', fetch, label: 'x' }).beta.messages.create(params);
    expect(message).toMatchObject({ stop_reason: 'tool_use', content: [{ type: 'text', text: 'Pronto.' }, { type: 'tool_use', id: 'c1', input: { ops: [] } }] });
  });

  it('names the provider in ProviderError and falls back to the HTTP status without a body', async () => {
    const { fetch } = fakeFetch(new Response('<html>', { status: 502 }), new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 }));
    const client = createChatCompletionsClient({ baseUrl: 'http://h/v1', fetch, label: 'servidor compatível com OpenAI' });
    await expect(client.beta.messages.create(params)).rejects.toEqual(new ProviderError(502, 'HTTP 502', 'servidor compatível com OpenAI'));
    const error = await client.beta.messages.create(params).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 401, message: 'bad key', provider: 'servidor compatível com OpenAI' });
  });

  it('accepts a plain-string error body (Ollama style)', async () => {
    const { fetch } = fakeFetch(new Response(JSON.stringify({ error: 'model "x" not found' }), { status: 404 }));
    const client = createChatCompletionsClient({ baseUrl: 'http://h/v1', fetch, label: 'x' });
    await expect(client.beta.messages.create(params)).rejects.toMatchObject({ status: 404, message: 'model "x" not found' });
  });

  it('retries once with max_completion_tokens when the server refuses max_tokens, and remembers it', async () => {
    const refusal = () => new Response(JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } }), { status: 400 });
    const { fetch, bodies } = fakeFetch(refusal(), reply({ role: 'assistant', content: 'um' }), reply({ role: 'assistant', content: 'dois' }));
    const client = createChatCompletionsClient({ baseUrl: 'https://api.openai.com/v1', apiKey: 'k', fetch, label: 'x' });
    expect((await client.beta.messages.create(params)).content).toEqual([{ type: 'text', text: 'um' }]);
    expect(bodies[0]).toMatchObject({ max_tokens: 100 });
    expect(bodies[1]).toMatchObject({ max_completion_tokens: 100 });
    expect(bodies[1]).not.toHaveProperty('max_tokens');
    await client.beta.messages.create(params);
    expect(bodies[2]).toMatchObject({ max_completion_tokens: 100 });
  });

  it('does not retry other 400s, nor more than once', async () => {
    const other = new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400 });
    const { fetch, bodies } = fakeFetch(other);
    await expect(createChatCompletionsClient({ baseUrl: 'http://h/v1', fetch, label: 'x' }).beta.messages.create(params)).rejects.toMatchObject({ status: 400 });
    expect(bodies).toHaveLength(1);
    const again = () => new Response(JSON.stringify({ error: { message: 'use max_completion_tokens' } }), { status: 400 });
    const twice = fakeFetch(again(), again());
    await expect(createChatCompletionsClient({ baseUrl: 'http://h/v1', fetch: twice.fetch, label: 'x' }).beta.messages.create(params)).rejects.toMatchObject({ status: 400 });
    expect(twice.bodies).toHaveLength(2);
  });

  it('streams text deltas through the same endpoint (also with the retry)', async () => {
    const sse = (...events: Json[]) => new Response(new ReadableStream({ start(controller) {
      for (const event of events) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
      controller.close();
    } }), { status: 200 });
    const refusal = new Response(JSON.stringify({ error: { message: "use 'max_completion_tokens'" } }), { status: 400 });
    const { fetch, bodies, requests } = fakeFetch(refusal, sse({ choices: [{ delta: { content: 'Olá' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }));
    const client = createChatCompletionsClient({ baseUrl: 'http://h/v1', fetch, label: 'x' });
    const events: unknown[] = [];
    for await (const event of client.beta.messages.stream!(params)) events.push(event);
    expect(requests.every((r) => r.url === 'http://h/v1/chat/completions')).toBe(true);
    expect(bodies[1]).toMatchObject({ stream: true, max_completion_tokens: 100 });
    expect(events).toEqual([
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Olá' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    ]);
  });
});

describe('streamed tool arguments', () => {
  it('normalizes fragmented tool calls for editable chat across compatible providers', async () => {
    const chunks = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'edit_document', arguments: '{"markdown":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"novo","summary":"Atualizado"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ];
    const response = new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n');
    const client = createChatCompletionsClient({ baseUrl: 'http://h/v1', label: 'teste', fetch: fakeFetch(response).fetch });
    const events: unknown[] = [];
    for await (const event of client.beta.messages.stream!({ model: 'modelo', max_tokens: 100, messages: [] })) events.push(event);
    expect(events).toEqual([
      { type: 'content_block_start', index: 1000, content_block: { type: 'tool_use', id: 'c1', name: 'edit_document', input: {} } },
      { type: 'content_block_delta', index: 1000, delta: { type: 'input_json_delta', partial_json: '{"markdown":' } },
      { type: 'content_block_delta', index: 1000, delta: { type: 'input_json_delta', partial_json: '"novo","summary":"Atualizado"}' } },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
    ]);
  });
});

it('replays Gemini signatures and provider reasoning only inside the same tool continuation', async () => {
  const extra = { google: { thought_signature: 'opaque-signature' } };
  const first = reply({ content: null, reasoning_content: 'provider-private-continuation', tool_calls: [{ id: 'signed-1', extra_content: extra, function: { name: 'lookup', arguments: '{}' } }] }, 'tool_calls');
  const { fetch, bodies } = fakeFetch(first, reply({ content: 'done' }));
  const client = createChatCompletionsClient({ baseUrl: 'https://provider.test/v1', label: 'Provider', fetch });
  const answer = await client.beta.messages.create(params);
  expect(JSON.stringify(answer)).not.toContain('opaque-signature');
  await client.beta.messages.create({ model: 'model', max_tokens: 100, messages: [{ role: 'assistant', content: answer.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'signed-1', content: 'found' }] }] });
  expect((bodies[1]!.messages as Json[])[0]).toMatchObject({ reasoning_content: 'provider-private-continuation', tool_calls: [{ extra_content: extra }] });
});

it('keeps signatures arriving after the first streamed tool fragment for a repair turn', async () => {
  const chunks = [
    { choices: [{ delta: { reasoning_content: 'reason' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'signed-stream', function: { name: 'lookup', arguments: '{' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, extra_content: { google: { thought_signature: 'late' } }, function: { arguments: '}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ];
  const stream = new Response(chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n');
  const { fetch, bodies } = fakeFetch(stream, reply({ content: 'done' }));
  const client = createChatCompletionsClient({ baseUrl: 'https://provider.test/v1', label: 'Provider', fetch });
  for await (const _ of client.beta.messages.stream!(params)) { /* consume */ }
  await client.beta.messages.create({ model: 'model', max_tokens: 100, messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'signed-stream', name: 'lookup', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'signed-stream', content: 'ok' }] }] });
  expect((bodies[1]!.messages as Json[])[0]).toMatchObject({ reasoning_content: 'reason', tool_calls: [{ extra_content: { google: { thought_signature: 'late' } } }] });
});

describe('provider response integrity', () => {
  async function collect(response: Response) {
    const client = createChatCompletionsClient({ baseUrl: 'http://h/v1', label: 'Provider', fetch: fakeFetch(response).fetch });
    const events = [];
    for await (const event of client.beta.messages.stream!(params)) events.push(event);
    return events;
  }
  const chunk = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

  it.each(['', 'data: [DONE]\n\n'])('rejects a cut-off answer even with a transport terminator %j', async end => {
    await expect(collect(new Response(chunk('partial') + end))).rejects.toMatchObject({ status: 502 });
  });
  it('does not hide an error sent after HTTP 200 or after partial text', async () => {
    await expect(collect(new Response(chunk('partial') + 'data: {"error":{"message":"upstream failed"}}\n\n'))).rejects.toMatchObject({ status: 502, message: 'upstream failed' });
  });
  it.each(['data: {invalid}\n\n', 'data: null\n\n', ''])('rejects invalid/empty streams %j', async body => {
    await expect(collect(new Response(body))).rejects.toMatchObject({ status: 502 });
  });
  it('accepts an explicit finish reason without a transport terminator', async () => {
    expect(await collect(new Response(chunk('complete') + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'))).toHaveLength(2);
  });
  it('cancels the upstream reader when the consumer stops', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(chunk('partial'))); }, cancel });
    const client = createChatCompletionsClient({ baseUrl: 'http://h/v1', label: 'Provider', fetch: fakeFetch(new Response(body)).fetch });
    for await (const _ of client.beta.messages.stream!(params)) break;
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([{ error: { message: 'provider failed' } }, { choices: [] }, { choices: [{ message: { content: 'partial' }, finish_reason: null }] }])('rejects unsuccessful JSON replies with HTTP 200', async body => {
    const client = createChatCompletionsClient({ baseUrl: 'http://h/v1', label: 'Provider', fetch: fakeFetch(body).fetch });
    await expect(client.beta.messages.create(params)).rejects.toMatchObject({ status: 502 });
  });
});
