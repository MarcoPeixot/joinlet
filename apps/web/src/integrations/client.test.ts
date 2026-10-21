import { afterEach, describe, expect, it, vi } from 'vitest';
import { integrationsApi, notifyAiVersion, safeLink } from './client';

afterEach(() => vi.unstubAllGlobals());

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('integrationsApi', () => {
  it('posts JSON to the local server and returns the typed value', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => reply({ ok: true, detail: 'ok' }));
    vi.stubGlobal('fetch', fetch);
    expect(await integrationsApi.test('slack')).toEqual({ ok: true, value: { ok: true, detail: 'ok' } });
    expect(fetch.mock.calls[0]![0]).toBe('/api/integrations/test');
    expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body))).toEqual({ target: 'slack' });
  });

  it('carries the server error in pt-BR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: 'Configure o token do Notion.' }, 400)));
    expect(await integrationsApi.publish({ target: 'notion', title: 'T', markdown: 'x' })).toEqual({ ok: false, error: 'Configure o token do Notion.', status: 400 });
  });

  it('sends the Jira concern with the diagram title', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => reply({ ok: true, key: 'ENG-1', url: 'https://a.atlassian.net/browse/ENG-1' }));
    vi.stubGlobal('fetch', fetch);
    await integrationsApi.jira({ id: 'c1', diagram: 'd', message: 'm' }, 'Checkout');
    expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body))).toEqual({ concern: { id: 'c1', diagram: 'd', message: 'm' }, diagramTitle: 'Checkout' });
  });

  it('says the server is off when it does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await integrationsApi.get()).toMatchObject({ ok: false, error: expect.stringMatching(/servidor local/i) });
  });
});

describe('notifyAiVersion', () => {
  it('reports an AI version and swallows every failure', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => { throw new TypeError('offline'); });
    vi.stubGlobal('fetch', fetch);
    expect(() => notifyAiVersion('checkout', 'Adiciona fila')).not.toThrow();
    await Promise.resolve();
    expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body))).toEqual({ event: 'version', diagram: 'checkout', message: 'Adiciona fila', author: 'ai' });
  });
});

describe('safeLink', () => {
  it('lets only http(s) through', () => {
    expect(safeLink('https://x.com/a')).toBe('https://x.com/a');
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink('data:text/html,x')).toBeNull();
    expect(safeLink(undefined)).toBeNull();
  });
});
