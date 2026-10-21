import { describe, expect, it, vi } from 'vitest';
import { requestChat, requestDoc, requestOps } from './client';
import type { Fetch } from './client';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const answer = (res: Response | Error) => vi.fn<Fetch>(async () => {
  if (res instanceof Error) throw res;
  return res;
});
const body = { instruction: 'remova DB', json: '{"version":1,"nodes":[]}', selection: ['DB'], mode: 'edit' as const };

describe('requestOps', () => {
  it('posts the request as JSON and returns the ops', async () => {
    const fetchFn = answer(json(200, { ops: [{ op: 'remove', id: 'DB' }], summary: 'Removi o DB.', model: 'claude-sonnet-5' }));
    expect(await requestOps(body, fetchFn)).toEqual({ kind: 'ok', ops: [{ op: 'remove', id: 'DB' }], summary: 'Removi o DB.', model: 'claude-sonnet-5' });
    expect(fetchFn).toHaveBeenCalledWith('/api/ai/diagram', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  });

  it('goes offline without a server, behind a proxy with no server, or without an API key', async () => {
    expect(await requestOps(body, answer(new TypeError('Failed to fetch')))).toEqual({ kind: 'offline', reason: 'Servidor de IA fora do ar (rode "bun run dev").' });
    expect(await requestOps(body, answer(new Response('', { status: 502, headers: { 'content-type': 'text/plain' } })))).toMatchObject({ kind: 'offline' });
    expect(await requestOps(body, answer(json(503, { error: 'IA indisponível: defina ANTHROPIC_API_KEY.' })))).toEqual({
      kind: 'offline',
      reason: 'IA indisponível: defina ANTHROPIC_API_KEY.',
    });
  });

  it('surfaces server errors in pt-BR and rejects malformed answers', async () => {
    expect(await requestOps(body, answer(json(502, { error: 'A IA não conseguiu propor operações válidas.' })))).toEqual({
      kind: 'error',
      message: 'A IA não conseguiu propor operações válidas.',
    });
    expect(await requestOps(body, answer(json(500, {})))).toEqual({ kind: 'error', message: 'O servidor de IA respondeu 500.' });
    expect(await requestOps(body, answer(json(200, { ops: 'x' })))).toEqual({ kind: 'error', message: 'Resposta inválida do servidor de IA.' });
  });

  it('treats a 504 (request deadline reached) as an error, not offline', async () => {
    const message = 'A IA demorou demais para responder. Tente um pedido menor ou tente de novo.';
    expect(await requestOps(body, answer(json(504, { error: message })))).toEqual({ kind: 'error', message });
  });
});

describe('requestDoc', () => {
  it('returns the markdown, or offline/error like requestOps', async () => {
    const fetchFn = answer(json(200, { markdown: '# Doc' }));
    expect(await requestDoc('A > B', fetchFn)).toEqual({ kind: 'ok', markdown: '# Doc' });
    expect(fetchFn.mock.calls[0]![0]).toBe('/api/ai/doc');
    expect(await requestDoc('A > B', answer(json(503, { error: 'sem chave' })))).toEqual({ kind: 'offline', reason: 'sem chave' });
    expect(await requestDoc('', answer(json(400, { error: 'O diagrama está vazio.' })))).toEqual({ kind: 'error', message: 'O diagrama está vazio.' });
  });
});

describe('requestChat (streaming)', () => {
  const lines = (...parts: unknown[]) => parts.map((part) => `${JSON.stringify(part)}\n`).join('');
  const ndjson = (text: string | string[], status = 200) => new Response(
    new ReadableStream({ start(controller) {
      for (const chunk of Array.isArray(text) ? text : [text]) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    } }),
    { status, headers: { 'content-type': 'application/x-ndjson; charset=utf-8' } },
  );
  const turns = [{ role: 'user' as const, content: 'oi' }];

  it('asks for a stream, hands each piece to onText and returns the whole answer', async () => {
    const fetchFn = answer(ndjson(lines({ t: 'Olá, ' }, { t: 'mundo.' }, { done: true })));
    const pieces: string[] = [];
    expect(await requestChat(turns, 'CTX', fetchFn, undefined, (piece) => pieces.push(piece))).toEqual({ kind: 'ok', reply: 'Olá, mundo.' });
    expect(pieces).toEqual(['Olá, ', 'mundo.']);
    expect(fetchFn).toHaveBeenCalledWith('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: turns, context: 'CTX', stream: true }) });
  });

  it('keeps a line whole when a chunk cuts it in two', async () => {
    const whole = lines({ t: 'inteiro' }, { done: true });
    const pieces: string[] = [];
    const reply = await requestChat(turns, '', answer(ndjson([whole.slice(0, 5), whole.slice(5)])), undefined, (piece) => pieces.push(piece));
    expect(reply).toEqual({ kind: 'ok', reply: 'inteiro' });
    expect(pieces).toEqual(['inteiro']);
  });

  it('reports an error line (the text so far was already shown) and a stream that stops without finishing', async () => {
    expect(await requestChat(turns, '', answer(ndjson(lines({ t: 'meio' }, { error: 'Não foi possível falar com a API da Anthropic.' }))))).toEqual({ kind: 'error', message: 'Não foi possível falar com a API da Anthropic.' });
    expect(await requestChat(turns, '', answer(ndjson(lines({ t: 'meio' }))))).toEqual({ kind: 'error', message: 'A resposta foi interrompida.' });
  });

  it('keeps the same failure words as the other requests before any piece', async () => {
    expect(await requestChat(turns, '', answer(new TypeError('Failed to fetch')))).toEqual({ kind: 'offline', reason: 'Servidor de IA fora do ar (rode "bun run dev").' });
    expect(await requestChat(turns, '', answer(json(503, { error: 'IA indisponível.' })))).toEqual({ kind: 'offline', reason: 'IA indisponível.' });
    expect(await requestChat(turns, '', answer(json(429, { error: 'Limite de uso atingido.' })))).toEqual({ kind: 'error', message: 'Limite de uso atingido.' });
  });

  it('accepts a server that answers in one piece', async () => {
    const pieces: string[] = [];
    expect(await requestChat(turns, '', answer(json(200, { reply: 'Tudo junto.' })), undefined, (piece) => pieces.push(piece))).toEqual({ kind: 'ok', reply: 'Tudo junto.' });
    expect(pieces).toEqual(['Tudo junto.']);
  });
});

it('forwards the stable conversation id as a header for provider routing', async () => {
  const fetchFn = answer(json(200, { reply: 'Pronto' }));
  await requestChat([{ role: 'user', content: 'Revise' }], 'Workspace', fetchFn, undefined, undefined, undefined, 'conversation-123');
  expect(fetchFn.mock.calls[0]![1].headers).toMatchObject({ 'x-strukt-session': 'conversation-123' });
});


it('reads web-search progress independently of streamed Markdown and validated edits', async () => {
  const events = [
    { search: { query: 'PostgreSQL docs', status: 'searching' } },
    { search: { query: 'PostgreSQL docs', status: 'complete', count: 2 } },
    { search: { query: 'invalid', status: 'unexpected' } },
    { t: '[Docs](https://www.postgresql.org/docs/)' }, { done: true },
  ];
  const onSearch = vi.fn(), onText = vi.fn();
  const response = new Response(events.map(e => JSON.stringify(e)).join('\n') + '\n', { headers: { 'content-type': 'application/x-ndjson' } });
  expect(await requestChat([{ role: 'user', content: 'Pesquise' }], '', answer(response), undefined, onText, undefined, undefined, undefined, onSearch)).toEqual({ kind: 'ok', reply: '[Docs](https://www.postgresql.org/docs/)' });
  expect(onSearch.mock.calls.map(c => c[0])).toEqual(events.slice(0, 2).map(e => e.search));
  expect(onText).toHaveBeenCalledWith('[Docs](https://www.postgresql.org/docs/)');
});
