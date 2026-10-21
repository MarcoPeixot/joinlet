import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createSettings } from './settings';
import { fakeClient, message } from './testing';

describe('chat model overrides', () => {
  it('uses the chosen provider and model per request without changing the global settings', async () => {
    const files = new Map<string, string>();
    const ant = fakeClient(message([{ type: 'text', text: 'Anthropic' }], { stop_reason: 'end_turn' }));
    const router = fakeClient(message([{ type: 'text', text: 'Router' }], { stop_reason: 'end_turn' }));
    const settings = createSettings({ file: '/settings', env: {}, fs: { read: async p => files.get(p) ?? null, write: async (p, t) => { files.set(p, t); } }, anthropic: () => ant.client, openrouter: () => router.client, fetch: (async () => { throw Error('No network'); }) as unknown as typeof globalThis.fetch });
    await settings.load();
    await settings.update({ provider: 'anthropic', keys: { anthropic: 'ant-key', openrouter: 'router-key', opencodego: 'go-key' } });
    const original = files.get('/settings');
    const app = createApp({ settings });
    const request = async (selection?: unknown) => app.request('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-strukt-session': 'conversation-1' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Explique' }], ...(selection === undefined ? {} : { selection }) }) });
    const response = await request({ provider: 'openrouter', model: 'test/model-with-tools' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reply: 'Router' });
    expect(router.calls[0]?.model).toBe('test/model-with-tools');
    expect(settings.current()?.id).toBe('anthropic');
    expect(files.get('/settings')).toBe(original);
    expect((await request()).status).toBe(200);
    expect(ant.calls).toHaveLength(1);
    expect((await request({ provider: 'missing', model: 'x' })).status).toBe(400);
    expect((await request({ provider: 'opencode', model: 'big-pickle' })).status).toBe(400);
    expect((await request({ provider: 'opencodego', model: 'not-a-go-model' })).status).toBe(400);
    expect(router.calls).toHaveLength(1);
    const go = settings.forChat({ provider: 'opencodego', model: 'qwen3.8-flash' });
    expect(go).toMatchObject({ id: 'opencodego', models: { edit: 'qwen3.8-flash' }, forSession: expect.any(Function) });
  });
});
