import { describe, expect, it, vi } from 'vitest';
import type { AiClient, CreateParams, StreamEvent } from './anthropic';
import { createApp } from './app';
import { withWebSearch } from './chatWeb';
import { fakeClient, message } from './testing';
import { MAX_WEB_SEARCHES } from './webSearch';
import { createOpenCodeGoClient } from './opencode';

const query = 'site:postgresql.org documentation';
const found = [{ title: 'PostgreSQL docs', url: 'https://www.postgresql.org/docs/', snippet: 'Official documentation.' }];
const searchCall = (id = 'search1', input: unknown = { query }) => message([{ type: 'tool_use', id, name: 'web_search', input }]);
const answer = message([{ type: 'text', text: 'Veja a [documentação](https://www.postgresql.org/docs/).' }], { stop_reason: 'end_turn' });
const params: CreateParams = { model: 'test', max_tokens: 1000, messages: [{ role: 'user', content: 'Pesquise PostgreSQL' }] };
const signal = () => new AbortController().signal;
const body = (target?: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: params.messages, context: '', ...(target ? { target } : {}) }) });
const text = (value: string): StreamEvent => ({ type: 'content_block_delta', delta: { type: 'text_delta', text: value } });
const tool = (name: string, input: unknown, id: string): StreamEvent[] => [
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', name, id, input: {} } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
];
function streaming(turns: StreamEvent[][]) {
  const seen: CreateParams[] = [];
  const client: AiClient = { beta: { messages: {
    create: async () => { throw new Error('expected stream'); },
    async *stream(params) { seen.push(structuredClone(params)); for (const event of turns.shift() ?? []) yield event; },
  } } };
  return { client, seen };
}

describe('request-scoped web tool loop', () => {
  it('executes a provider batch sequentially and returns a matching result for every call', async () => {
    const calls = Array.from({ length: 3 }, (_, i) => ({ type: 'tool_use', id: `s${i}`, name: 'web_search', input: { query: `meeting transcription reference ${i}` } }));
    const fake = fakeClient(message(calls), answer);
    const order: string[] = [];
    let running = false;
    const client = withWebSearch(fake.client, async q => {
      expect(running).toBe(false); running = true; order.push(q);
      await Promise.resolve(); running = false;
      if (q.endsWith('1')) throw new Error('provider unavailable');
      return found;
    });
    expect(await client.beta.messages.create(params)).toEqual(answer);
    expect(order).toEqual(calls.map(c => c.input.query));
    const results = fake.calls[1]?.messages.at(-1)?.content;
    expect(results).toEqual([
      expect.objectContaining({ tool_use_id: 's0', content: expect.stringContaining('https://www.postgresql.org/docs/') }),
      expect.objectContaining({ tool_use_id: 's1', is_error: true }),
      expect.objectContaining({ tool_use_id: 's2', content: expect.stringContaining('https://www.postgresql.org/docs/') }),
    ]);
  });
  it('keeps successful references when a batch exceeds the remaining search budget', async () => {
    const calls = Array.from({ length: MAX_WEB_SEARCHES + 1 }, (_, i) => ({ type: 'tool_use', id: `s${i}`, name: 'web_search', input: { query: `reference ${i}` } }));
    const fake = fakeClient(message(calls), answer), search = vi.fn().mockResolvedValue(found);
    expect(await withWebSearch(fake.client, search).beta.messages.create(params)).toEqual(answer);
    expect(search).toHaveBeenCalledTimes(MAX_WEB_SEARCHES);
    const results = fake.calls[1]?.messages.at(-1)?.content;
    expect(results).toHaveLength(calls.length);
    expect(Array.isArray(results) && results.at(-1)).toMatchObject({ tool_use_id: `s${MAX_WEB_SEARCHES}`, is_error: true, content: expect.stringContaining('limite') });
    expect(fake.calls[1]?.tools).not.toContainEqual(expect.objectContaining({ name: 'web_search' }));
  });
  it('handles interleaved parallel search calls from the OpenCode Go transport even with parallel tools disabled', async () => {
    const queries = ['live meeting transcription blogs', 'speaker diarization repositories', 'async multi participant transcription architecture'];
    const bodies: Record<string, unknown>[] = [];
    const sse = (...events: unknown[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    const transport = async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      if (bodies.length > 1) return sse({ choices: [{ delta: { content: '[Docs](https://www.postgresql.org/docs/)' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] });
      return sse(
        ...queries.map((_query, i) => ({ choices: [{ delta: { tool_calls: [{ index: i, id: `go${i}`, function: { name: 'web_search', arguments: '{"query":' } }] } }] })),
        ...queries.map((query, i) => ({ choices: [{ delta: { tool_calls: [{ index: i, function: { arguments: `${JSON.stringify(query)}}` } }] } }] })),
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      );
    };
    const go = createOpenCodeGoClient({ apiKey: 'test-go', sessionId: 'parallel-search', fetch: transport as typeof globalThis.fetch });
    const search = vi.fn().mockResolvedValue(found), events: StreamEvent[] = [];
    for await (const event of withWebSearch(go, search).beta.messages.stream!({ ...params, model: 'deepseek-v4.1-flash' }, { signal: signal() })) events.push(event);
    expect(bodies[0]?.parallel_tool_calls).toBe(false);
    expect(search.mock.calls.map(c => c[0])).toEqual(queries);
    expect(events.filter(e => e.type === 'web_search').map(e => e.search?.status)).toEqual(['searching', 'complete', 'searching', 'complete', 'searching', 'complete']);
    expect((bodies[1]?.messages as { role: string; tool_call_id?: string }[]).filter(m => m.role === 'tool').map(m => m.tool_call_id)).toEqual(['go0', 'go1', 'go2']);
    expect(events.some(e => e.content_block?.name === 'web_search')).toBe(false);
    expect(events.at(-1)?.delta?.stop_reason).toBe('end_turn');
  });
  it('completes a streamed workspace research request with multiple searches and preserves cancellation inside a batch', async () => {
    const queries = ['live transcription blogs', 'diarization repositories', 'async transcription architecture'];
    const batch: StreamEvent[] = queries.flatMap((query, index) => tool('web_search', { query }, `s${index}`).slice(0, -1).map(event => ({ ...event, index })));
    batch.push({ type: 'message_delta', delta: { stop_reason: 'tool_use' } });
    const fake = streaming([batch, [text('[Docs](https://www.postgresql.org/docs/)'), { type: 'message_delta', delta: { stop_reason: 'end_turn' } }]]);
    const manifest = JSON.stringify({ version: 1, name: 'Research', diagrams: [], docs: [], sketches: [] });
    const init = body({ kind: 'workspace', slug: 'workspace', content: manifest, workspace: manifest });
    init.body = JSON.stringify({ ...JSON.parse(init.body), stream: true });
    const response = await createApp({ ai: fake.client, webSearch: async () => found }).request('/api/ai/chat', init);
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    expect(response.status).toBe(200);
    expect(events.filter(e => e.search?.status === 'complete')).toHaveLength(3);
    expect(events.some(e => e.error || e.edit)).toBe(false);
    expect(events.at(-1)).toEqual({ done: true });
    const controller = new AbortController(), search = vi.fn(async () => { controller.abort(); return found; });
    const interrupted = fakeClient(message(queries.map((query, i) => ({ type: 'tool_use', id: `s${i}`, name: 'web_search', input: { query } }))));
    await expect(withWebSearch(interrupted.client, search).beta.messages.create(params, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(search).toHaveBeenCalledTimes(1);
    expect(interrupted.calls).toHaveLength(1);
  });
  it('returns actual search tool results to the selected model before answering, preserving other tools', async () => {
    const fake = fakeClient(searchCall(), answer), search = vi.fn().mockResolvedValue(found);
    const abort = signal();
    expect(await withWebSearch(fake.client, search).beta.messages.create(params, { signal: abort })).toEqual(answer);
    expect(search).toHaveBeenCalledWith(query, abort);
    expect(fake.calls[0]?.tools).toContainEqual(expect.objectContaining({ name: 'web_search' }));
    expect(fake.calls[1]?.messages.slice(-2)).toEqual([{ role: 'assistant', content: searchCall().content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'search1', content: expect.stringContaining('https://www.postgresql.org/docs/') }] }]);
    expect(fake.calls[0]?.system).toContain('dados não confiáveis');
  });
  it('does no searching when the model answers normally and bounds repeated calls', async () => {
    const search = vi.fn().mockResolvedValue(found), fake = fakeClient(answer);
    await withWebSearch(fake.client, search).beta.messages.create(params);
    expect(search).not.toHaveBeenCalled();
    const repeated = fakeClient(...Array.from({ length: MAX_WEB_SEARCHES + 1 }, (_, i) => searchCall(`s${i}`)));
    await expect(withWebSearch(repeated.client, search).beta.messages.create(params)).rejects.toThrow('limite');
    expect(search).toHaveBeenCalledTimes(MAX_WEB_SEARCHES);
    expect(repeated.calls.at(-1)?.tools).not.toContainEqual(expect.objectContaining({ name: 'web_search' }));
  });
  it('returns recoverable errors with the matching tool id, without exposing transport errors or secrets', async () => {
    const fake = fakeClient(searchCall(), answer);
    await withWebSearch(fake.client, async () => { throw new Error('network key=secret'); }).beta.messages.create(params);
    const result = fake.calls[1]!.messages.at(-1)!;
    expect(result).toMatchObject({ content: [{ type: 'tool_result', tool_use_id: 'search1', is_error: true }] });
    expect(JSON.stringify(result)).not.toContain('secret');
    const invalid = fakeClient(searchCall('bad', { query: '' }), answer), search = vi.fn();
    await withWebSearch(invalid.client, search).beta.messages.create(params);
    expect(search).not.toHaveBeenCalled();
  });
  it('cancels without another model call and rejects mixed search/mutation or unfinished calls', async () => {
    const controller = new AbortController(), fake = fakeClient(searchCall(), answer);
    await expect(withWebSearch(fake.client, async () => { controller.abort(); controller.signal.throwIfAborted(); return []; }).beta.messages.create(params, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fake.calls).toHaveLength(1);
    const mixed = fakeClient(message([...searchCall().content, { type: 'tool_use', id: 'edit', name: 'edit_document', input: {} }]));
    await expect(withWebSearch(mixed.client, vi.fn()).beta.messages.create(params)).rejects.toThrow('não foi concluída');
  });
  it('supports HTTP search followed by a validated document edit, and read-only answers', async () => {
    const edit = message([{ type: 'tool_use', id: 'edit', name: 'edit_document', input: { summary: 'Referências adicionadas', markdown: '# PostgreSQL\n[Docs](https://www.postgresql.org/docs/)' } }]);
    const fake = fakeClient(searchCall(), edit), search = vi.fn().mockResolvedValue(found);
    const response = await createApp({ ai: fake.client, webSearch: search }).request('/api/ai/chat', body({ kind: 'doc', slug: 'arquitetura', content: '# Antes' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ edit: { kind: 'doc', summary: 'Referências adicionadas', markdown: expect.stringContaining('[Docs]') } });
    expect(fake.calls[1]?.tools).toContainEqual(expect.objectContaining({ name: 'edit_document' }));
    const read = fakeClient(searchCall(), answer);
    const readResponse = await createApp({ ai: read.client, webSearch: search }).request('/api/ai/chat', body());
    expect(await readResponse.json()).toMatchObject({ reply: expect.stringContaining('https://www.postgresql.org/docs/') });
  });
  it('streams progress and final text without exposing internal tool calls, including a following edit', async () => {
    const { client, seen } = streaming([tool('web_search', { query }, 'search-stream'), [text('Fontes verificadas.'), ...tool('edit_document', { summary: 'Documento atualizado', markdown: '# Docs' }, 'edit-stream')]]);
    const app = createApp({ ai: client, webSearch: async () => found });
    const init = body({ kind: 'doc', slug: 'doc', content: '# Antes' });
    init.body = JSON.stringify({ ...JSON.parse(init.body), stream: true });
    const res = await app.request('/api/ai/chat', init);
    const events = (await res.text()).trim().split('\n').map(line => JSON.parse(line));
    expect(events).toEqual([{ search: { query, status: 'searching' } }, { search: { query, status: 'complete', count: 1 } }, { t: 'Fontes verificadas.' }, { edit: { kind: 'doc', summary: 'Documento atualizado', markdown: '# Docs' } }, { done: true }]);
    expect(seen[1]?.messages.at(-1)).toMatchObject({ content: [{ tool_use_id: 'search-stream' }] });
  });
  it('streams search and citation links for read-only chat and never searches truncated streamed JSON', async () => {
    const { client } = streaming([tool('web_search', { query }, 's'), [text('[Docs](https://www.postgresql.org/docs/)'), { type: 'message_delta', delta: { stop_reason: 'end_turn' } }]]);
    const app = createApp({ ai: client, webSearch: async () => found });
    const init = body(); init.body = JSON.stringify({ ...JSON.parse(init.body), stream: true });
    const events = (await (await app.request('/api/ai/chat', init)).text()).trim().split('\n').map(line => JSON.parse(line));
    expect(events.at(-2)).toEqual({ t: '[Docs](https://www.postgresql.org/docs/)' });
    expect(events.filter(e => e.search)).toHaveLength(2);
    const incomplete = streaming([tool('web_search', { query }, 's').slice(0, 2)]), search = vi.fn();
    const stream = withWebSearch(incomplete.client, search).beta.messages.stream!(params, { signal: signal() });
    await expect(async () => { for await (const _ of stream) { /* drain */ } }).rejects.toThrow('não foi concluída');
    expect(search).not.toHaveBeenCalled();
  });
});
