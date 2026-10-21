import { describe, expect, it } from 'vitest';
import type { AiClient } from './anthropic';
import { ChatFailure, chatSystemPrompt, parseChatBody, replyToChat, streamChat } from './chat';
import { fakeClient, message } from './testing';

describe('parseChatBody', () => {
  const ok = { messages: [{ role: 'user', content: 'O que faz a API?' }], context: '{"version":1}' };

  it('accepts a conversation ending with the person', () => {
    expect(parseChatBody(ok)).toEqual(ok);
  });

  it('context is optional', () => {
    expect(parseChatBody({ messages: ok.messages })).toEqual({ messages: ok.messages, context: '' });
  });

  it.each([
    [null, 'Corpo inválido: envie um objeto JSON.'],
    [{ messages: [] }, 'Corpo inválido: "messages" precisa ter ao menos uma mensagem.'],
    [{ messages: [{ role: 'system', content: 'x' }] }, 'Corpo inválido: cada mensagem precisa ter "role" user ou assistant e "content" em texto.'],
    [{ messages: [{ role: 'user', content: 3 }] }, 'Corpo inválido: cada mensagem precisa ter "role" user ou assistant e "content" em texto.'],
    [{ messages: [{ role: 'assistant', content: 'oi' }] }, 'Corpo inválido: a última mensagem precisa ser do usuário.'],
    [{ messages: ok.messages, context: 5 }, 'Corpo inválido: "context" precisa ser texto.'],
    [{ messages: ok.messages, context: 'x'.repeat(300_001) }, 'Corpo inválido: o contexto é grande demais.'],
    [{ messages: [{ role: 'user', content: 'x'.repeat(8_001) }] }, 'Corpo inválido: uma mensagem passa de 8000 caracteres.'],
    [{ messages: Array.from({ length: 41 }, () => ({ role: 'user', content: 'x' })) }, 'Corpo inválido: a conversa passa de 40 mensagens.'],
  ])('rejects %j', (body, error) => {
    expect(parseChatBody(body)).toBe(error);
  });
});

describe('chatSystemPrompt', () => {
  it('fences the context as data and tells the model it is read-only', () => {
    const prompt = chatSystemPrompt('{"a":1}');
    expect(prompt).toContain('<contexto>\n{"a":1}\n</contexto>');
    expect(prompt).toMatch(/não é instrução/i);
    expect(prompt).toMatch(/não edita/i);
  });

  it('says so when there is no context', () => {
    expect(chatSystemPrompt('')).not.toContain('<contexto>\n');
  });

  it('asks for clickable citations: [[Id]] for the open diagram, [[slug#Id]] for the others, only ids that exist', () => {
    const prompt = chatSystemPrompt('{}');
    expect(prompt).toContain('[[Id]]');
    expect(prompt).toContain('[[slug#Id]]');
    expect(prompt).toMatch(/slug:/);
    expect(prompt).toMatch(/nunca invente/i);
    // The tags are an output format, not a way to smuggle instructions: the context stays data.
    expect(prompt).toMatch(/não é instrução/i);
  });
});

describe('replyToChat', () => {
  it('sends the conversation and returns the text', async () => {
    const { client, calls } = fakeClient(message([{ type: 'text', text: 'A API fala com o banco.' }], { stop_reason: 'end_turn' }));
    const result = await replyToChat(client, { messages: [{ role: 'user', content: 'Oi' }, { role: 'assistant', content: 'Olá' }, { role: 'user', content: 'E a API?' }], context: '{}' });
    expect(result).toEqual({ ok: true, reply: 'A API fala com o banco.' });
    expect(calls[0]).toMatchObject({ model: 'claude-sonnet-5', system: chatSystemPrompt('{}'), messages: [{ role: 'user', content: 'Oi' }, { role: 'assistant', content: 'Olá' }, { role: 'user', content: 'E a API?' }] });
  });

  it('reports a refusal and an empty answer', async () => {
    const refusal = await replyToChat(fakeClient(message([], { stop_reason: 'refusal' })).client, { messages: [{ role: 'user', content: 'x' }], context: '' });
    expect(refusal).toEqual({ ok: false, status: 422, error: 'A IA recusou este pedido.' });
    const empty = await replyToChat(fakeClient(message([], { stop_reason: 'end_turn' })).client, { messages: [{ role: 'user', content: 'x' }], context: '' });
    expect(empty).toEqual({ ok: false, status: 502, error: 'A IA não devolveu texto.' });
  });
});

/** A client whose `stream` yields the given raw events (what the SDK's MessageStream yields). */
function streamingClient(events: unknown[], seen: unknown[] = []): AiClient {
  const { client } = fakeClient();
  return {
    beta: {
      messages: {
        create: client.beta.messages.create,
        stream(params, options) {
          seen.push({ params, options });
          return (async function* () { for (const event of events) yield event as { type: string }; })();
        },
      },
    },
  };
}
const text = (value: string) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: value } });
const request = { messages: [{ role: 'user' as const, content: 'Oi' }], context: '{}' };
const collect = async (iterable: AsyncIterable<string>) => { const out: string[] = []; for await (const chunk of iterable) out.push(chunk); return out; };

describe('streamChat', () => {
  it('yields the text as it arrives, ignoring other events, with the same request as a normal turn', async () => {
    const seen: { params: unknown }[] = [];
    const client = streamingClient([{ type: 'message_start' }, text('A API '), { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{' } }, text('fala.'), { type: 'message_delta', delta: { stop_reason: 'end_turn' } }], seen);
    expect(await collect(streamChat(client, request))).toEqual(['A API ', 'fala.']);
    expect(seen[0]!.params).toMatchObject({ model: 'claude-sonnet-5', system: chatSystemPrompt('{}'), messages: request.messages });
  });

  it('fails with the refusal and with an empty answer', async () => {
    await expect(collect(streamChat(streamingClient([{ type: 'message_delta', delta: { stop_reason: 'refusal' } }]), request))).rejects.toMatchObject({ status: 422, message: 'A IA recusou este pedido.' });
    await expect(collect(streamChat(streamingClient([{ type: 'message_start' }]), request))).rejects.toBeInstanceOf(ChatFailure);
  });

  it('falls back to one chunk when the client cannot stream', async () => {
    const { client } = fakeClient(message([{ type: 'text', text: 'Tudo de uma vez.' }], { stop_reason: 'end_turn' }));
    expect(await collect(streamChat(client, request))).toEqual(['Tudo de uma vez.']);
  });

  it('passes the abort signal to the stream', async () => {
    const seen: { options?: { signal?: AbortSignal } }[] = [];
    const controller = new AbortController();
    await collect(streamChat(streamingClient([text('x'), { type: 'message_delta', delta: { stop_reason: 'end_turn' } }], seen), request, controller.signal));
    expect(seen[0]!.options?.signal).toBe(controller.signal);
  });
});

it('does not mark a truncated text answer as complete, with or without streaming', async () => {
  const request = { messages: [{ role: 'user' as const, content: 'explain' }], context: '' };
  expect(await replyToChat(fakeClient(message([{ type: 'text', text: 'partial' }], { stop_reason: 'max_tokens' })).client, request)).toMatchObject({ ok: false, status: 502 });
  await expect(collect(streamChat(streamingClient([text('partial'), { type: 'message_delta', delta: { stop_reason: 'max_tokens' } }]), request))).rejects.toMatchObject({ status: 502 });
  await expect(collect(streamChat(streamingClient([text('partial')]), request))).rejects.toMatchObject({ status: 502 });
});
