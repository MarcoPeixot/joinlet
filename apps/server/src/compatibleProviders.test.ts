import { describe, expect, it } from 'vitest';
import { COMPATIBLE_PROVIDERS, COMPATIBLE_PROVIDER_IDS, readChatModel } from '@strukt/core';
import { createSettings, parseSettingsFile, applyPatch } from './settings';
import { createApp } from './app';
import { fakeClient, message } from './testing';

function setup(status = 200) {
  let stored: string | null = null;
  const calls: { url: string; init?: RequestInit }[] = [];
  const fallback = fakeClient(message([{ type: 'text', text: 'fallback' }]));
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (status !== 200) return new Response('{}', { status });
    return Response.json(String(url).endsWith('/models') ? { data: [{ id: 'test-tools' }, { id: 'test-tools' }] } : { choices: [{ message: { role: 'assistant', content: 'Olá' }, finish_reason: 'stop' }] });
  }) as typeof globalThis.fetch;
  const settings = createSettings({ file: '/settings', env: {}, fs: { read: async () => stored, write: async (_, value) => { stored = value; } }, fetch, anthropic: () => fallback.client, openrouter: () => fallback.client });
  return { settings, calls, stored: () => stored };
}

describe('named compatible connections', () => {
  it.each(COMPATIBLE_PROVIDER_IDS)('%s uses its own endpoint, secret, models and chat override', async id => {
    const { settings, calls, stored } = setup();
    await settings.load();
    await settings.update({ provider: id, keys: { [id]: `secret-${id}-abcd`, openai: 'unrelated-key' }, models: { [id]: { edit: 'test-tools', doc: 'docs-model' } } });
    expect(settings.view().providers[id]).toEqual({ configured: true, source: 'file', hint: '…abcd' });
    expect(JSON.stringify(settings.view())).not.toContain(`secret-${id}`);
    expect(await settings.openAiModels(id)).toEqual(['test-tools']);
    expect(await settings.test(id)).toMatchObject({ ok: true });
    const selected = settings.current()!;
    expect(selected.models).toEqual({ edit: 'test-tools', generate: 'test-tools', doc: 'docs-model' });
    await selected.client.beta.messages.create({ model: selected.models.edit, max_tokens: 20, messages: [{ role: 'user', content: 'Olá' }] });
    expect(calls.every(c => c.url.startsWith(COMPATIBLE_PROVIDERS[id].baseUrl + '/'))).toBe(true);
    expect(calls.every(c => new Headers(c.init?.headers).get('authorization') === `Bearer secret-${id}-abcd` && c.init?.redirect === 'error')).toBe(true);
    const before = stored();
    expect(settings.forChat({ provider: id, model: 'other-model' })).toMatchObject({ id, models: { edit: 'other-model' } });
    expect(stored()).toBe(before);
    expect(readChatModel({ provider: id, model: 'other-model' })).toEqual({ provider: id, model: 'other-model' });
    await settings.load();
    expect(settings.current()?.id).toBe(id);
    await settings.update({ keys: { [id]: null } });
    expect(settings.current()).toBeNull();
    expect(settings.forChat({ provider: id, model: 'other-model' })).toMatch(/Conecte/);
  });

  it('does not send another connection’s key when a named provider is not configured', async () => {
    const { settings, calls } = setup();
    await settings.load();
    await settings.update({ keys: { openai: 'old-key', groq: 'groq-key' } });
    expect(await settings.test('gemini')).toEqual({ ok: false, detail: 'Nenhuma chave configurada.' });
    expect(calls).toHaveLength(0);
    expect(await settings.update({ models: { groq: { edit: '' } } })).toMatch(/Modelo inválido/);
    const result = applyPatch(parseSettingsFile(null), JSON.parse('{"models":{"__proto__":{"edit":"bad"}},"keys":{"__proto__":"bad"}}'));
    expect(typeof result).not.toBe('string');
    expect(Object.prototype).not.toHaveProperty('edit');
  });

  it('exposes model discovery and key testing through the settings routes', async () => {
    const { settings } = setup();
    await settings.load();
    await settings.update({ keys: { gemini: 'gemini-key' } });
    const app = createApp({ settings });
    expect(await (await app.request('/api/settings/openai-models?provider=gemini')).json()).toEqual({ models: ['test-tools'] });
    expect((await app.request('/api/settings/openai-models?provider=https://attacker.test')).status).toBe(400);
    const test = await app.request('/api/settings/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'gemini' }) });
    expect(await test.json()).toMatchObject({ ok: true });
  });

  it('reports refused credentials without marking the test as successful', async () => {
    const { settings } = setup(401);
    await settings.load();
    await settings.update({ keys: { deepseek: 'invalid' } });
    expect(await settings.test('deepseek')).toEqual({ ok: false, detail: 'O DeepSeek recusou a chave.' });
  });
});
