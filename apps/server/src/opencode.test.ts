import { describe, expect, it, vi } from 'vitest';
import { createOpenCodeClient, isOpenCodeChatModel, OPENCODE_API } from './opencode';
import { applyPatch, createSettings, parseSettingsFile, resolveProviders } from './settings';
import type { AiClient } from './anthropic';

describe('OpenCode connection', () => {
  it('migrates existing settings, keeps separate credentials and prefers the selected connection', () => {
    const file = parseSettingsFile(JSON.stringify({ provider: 'opencode', keys: { anthropic: 'ant', openrouter: 'router', opencode: 'saved' }, models: { opencode: { edit: 'glm-5.3', doc: 'claude-sonnet-5' } } }));
    expect(file.models.opencode).toEqual({ edit: 'glm-5.3', generate: 'big-pickle', doc: 'big-pickle' });
    expect(resolveProviders(file, { OPENCODE_API_KEY: 'environment' })).toMatchObject({ active: 'opencode', opencode: { key: 'environment', source: 'env' } });
    expect(file.keys.openrouter).toBe('router');
    expect(applyPatch(file, { models: { opencode: { edit: 'gpt-6-sol' } } })).toMatch(/incompatível/);
    expect(isOpenCodeChatModel('kimi-k2.5')).toBe(true);
    expect(isOpenCodeChatModel('qwen3.7-plus')).toBe(false);
  });
  it('adapts chat tool calls through the fixed OpenCode endpoint and exposes streaming', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => new Response(JSON.stringify({ id: 'r', choices: [{ message: { content: 'Pronto', tool_calls: [{ id: 'call1', type: 'function', function: { name: 'edit_workspace', arguments: '{"kind":"doc"}' } }] }, finish_reason: 'tool_calls' }] }), { headers: { 'content-type': 'application/json' } }));
    const client = createOpenCodeClient({ apiKey: 'test-only-opencode', fetch: fetch as unknown as typeof globalThis.fetch });
    const response = await client.beta.messages.create({ model: 'big-pickle', max_tokens: 100, messages: [{ role: 'user', content: 'Atualize o documento' }] });
    const [url, options] = fetch.mock.calls[0]!;
    expect(url).toBe(`${OPENCODE_API}/chat/completions`);
    expect(new Headers(options?.headers).get('authorization')).toBe('Bearer test-only-opencode');
    expect(JSON.parse(options?.body as string).model).toBe('big-pickle');
    expect(response.content).toContainEqual({ type: 'tool_use', id: 'call1', name: 'edit_workspace', input: { kind: 'doc' } });
    expect(client.beta.messages.stream).toBeDefined();
  });
  it('saves only on the server, masks keys, filters models and distinguishes catalog access from key validation', async () => {
    let stored: string | null = null;
    const fake = {} as AiClient;
    const settings = createSettings({ file: '/fake/settings.json', env: {}, fs: { read: async () => stored, write: async (_path, text) => { stored = text; } }, anthropic: () => fake, openrouter: () => fake,
      fetch: vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'big-pickle' }, { id: 'glm-5.3' }, { id: 'claude-sonnet-5' }, { id: 'gpt-6-sol' }] }))) as unknown as typeof globalThis.fetch,
    });
    await settings.load();
    await settings.update({ provider: 'opencode', keys: { opencode: 'test-only-secret-4321' }, models: { opencode: { edit: 'glm-5.3' } } });
    expect(settings.current()).toMatchObject({ id: 'opencode', models: { edit: 'glm-5.3' } });
    expect(JSON.stringify(settings.view())).not.toContain('test-only-secret');
    expect(settings.view().providers.opencode).toEqual({ configured: true, source: 'file', hint: '…4321' });
    expect((await settings.openCodeModels()).map((model) => model.id)).toEqual(['big-pickle', 'glm-5.3']);
    expect((await settings.test('opencode')).detail).toContain('validada no primeiro pedido');
    expect(stored).toContain('test-only-secret-4321');
    await settings.update({ keys: { opencode: null } });
    expect(settings.current()).toBeNull();
  });
  it('activates without restart and serves an editable chat action through the HTTP API', async () => {
    const { createApp } = await import('./app');
    const fake = {} as AiClient;
    const completion = vi.fn(async () => new Response(JSON.stringify({ id: 'chat1', choices: [{ message: { content: '', tool_calls: [{ id: 'edit1', type: 'function', function: { name: 'edit_document', arguments: JSON.stringify({ summary: 'Documento atualizado', markdown: '# Novo texto' }) } }] }, finish_reason: 'tool_calls' }] })));
    const settings = createSettings({ file: '/fake/settings.json', env: {}, fs: { read: async () => null, write: async () => {} }, anthropic: () => fake, openrouter: () => fake, fetch: completion as unknown as typeof globalThis.fetch });
    await settings.load();
    const app = createApp({ settings });
    const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const saved = await post('/api/settings', { provider: 'opencode', keys: { opencode: 'test-only-key' } });
    expect(saved.status).toBe(200);
    expect(await (await app.request('/api/health')).json()).toMatchObject({ ai: true, provider: 'opencode' });
    const response = await post('/api/ai/chat', { context: 'Notas do workspace', messages: [{ role: 'user', content: 'Atualize o documento' }], target: { kind: 'doc', slug: 'notas', content: '# Antigo' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ edit: { kind: 'doc', markdown: '# Novo texto' } });
  });

});
