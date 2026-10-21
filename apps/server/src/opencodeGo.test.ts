import { describe, expect, it, vi } from 'vitest';
import { createOpenCodeGoClient, OPENCODE_GO_API, OPENCODE_GO_MODELS } from './opencode';
import { createSettings } from './settings';
import { createApp } from './app';
import type { AiClient } from './anthropic';

const completion = { id: 'r', choices: [{ message: { content: 'Pronto' }, finish_reason: 'stop' }] };
const textMessage = { id: 'msg1', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Pronto' }], model: 'qwen3.8-flash', stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 2 } };
const params = { model: 'glm-5.3-flash', max_tokens: 100, messages: [{ role: 'user' as const, content: 'Revise o código da arquitetura.' }] };

describe('OpenCode Go', () => {
  it('uses the subscription endpoint and identifies the client and conversation', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(completion)));
    const client = createOpenCodeGoClient({ apiKey: 'test-go', sessionId: 'conversation-1', fetch: fetch as unknown as typeof globalThis.fetch });
    await client.beta.messages.create(params);
    await client.beta.messages.create(params);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([`${OPENCODE_GO_API}/chat/completions`, `${OPENCODE_GO_API}/chat/completions`]);
    const headers = new Headers(fetch.mock.calls[0]![1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer test-go');
    expect(headers.get('user-agent')).toBe('Joinlet/0.1');
    expect(headers.get('x-opencode-session')).toBe('conversation-1');
    expect(new Headers(fetch.mock.calls[1]![1]?.headers).get('x-opencode-session')).toBe('conversation-1');
  });
  it('routes Qwen and MiniMax M3 through Messages with the same session headers', async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.url).toContain('/inference/go/anthropic/v1/messages');
      expect(request.headers.get('x-opencode-session')).toBe('qwen-session');
      expect(request.headers.get('user-agent')).toBe('Joinlet/0.1');
      return new Response(JSON.stringify(textMessage), { headers: { 'content-type': 'application/json' } });
    });
    const client = createOpenCodeGoClient({ apiKey: 'test-go', sessionId: 'qwen-session', fetch: fetch as unknown as typeof globalThis.fetch });
    for (const model of ['qwen3.8-flash', 'minimax-m3', 'claude-haiku-5-5']) expect((await client.beta.messages.create({ ...params, model })).content).toEqual(textMessage.content);
  });
  it('keeps Go keys/models independent from Zen and forwards conversation ids from HTTP requests', async () => {
    const calls: { url: string; session: string | null }[] = [];
    const fake = {} as AiClient;
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), session: new Headers(init?.headers).get('x-opencode-session') });
      return new Response(JSON.stringify(String(input).endsWith('/models') ? { data: [{ id: 'glm-5.3-flash' }, { id: 'qwen3.8-flash' }, { id: 'gpt-6-luna' }, { id: 'big-pickle' }] } : completion));
    };
    const settings = createSettings({ file: '/fake', env: {}, fs: { read: async () => null, write: async () => {} }, anthropic: () => fake, openrouter: () => fake, fetch: fetch as typeof globalThis.fetch });
    await settings.load();
    await settings.update({ provider: 'opencodego', keys: { opencode: 'test-zen', opencodego: 'test-go' } });
    expect(settings.view()).toMatchObject({ active: 'opencodego', models: { opencode: { edit: 'big-pickle' }, opencodego: { edit: 'glm-5.3-flash' } } });
    expect((await settings.openCodeModels(true)).map((model) => model.id)).toEqual(['glm-5.3-flash', 'qwen3.8-flash']);
    expect(calls[0]!.url).toBe(OPENCODE_GO_MODELS);
    const app = createApp({ settings });
    for (const session of ['chat-1', 'chat-1', 'chat-2']) {
      const response = await app.request('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-strukt-session': session }, body: JSON.stringify({ messages: params.messages, context: 'System design' }) });
      expect(response.status).toBe(200);
    }
    expect(calls.slice(1).map((call) => call.session)).toEqual(['chat-1', 'chat-1', 'chat-2']);
    expect(calls.slice(1).every((call) => call.url === `${OPENCODE_GO_API}/chat/completions`)).toBe(true);
  });
});
