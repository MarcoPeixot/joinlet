import { describe, expect, it, vi } from 'vitest';
import type { AiClient } from './anthropic';
import { applyPatch, createSettings, keyHint, parseSettingsFile, resolveProviders } from './settings';
import type { SettingsFile } from './settings';

const empty: SettingsFile = parseSettingsFile(null);
const client = (tag: string) => ({ tag, beta: { messages: { create: vi.fn() } } }) as unknown as AiClient;

describe('parseSettingsFile (untrusted JSON from disk)', () => {
  it('falls back to defaults on missing or broken files', () => {
    expect(parseSettingsFile(null)).toEqual({ version: 1, provider: 'anthropic', keys: {}, models: { gemini: { edit: 'gemini-3.8-flash', generate: '', doc: '' }, deepseek: { edit: 'deepseek-flash', generate: '', doc: '' }, groq: { edit: 'openai/gpt-oss-20b', generate: '', doc: '' }, mistral: { edit: 'mistral-small-latest', generate: '', doc: '' }, openrouter: { edit: 'openrouter/auto', generate: 'openrouter/auto', doc: 'openrouter/auto' }, openai: { edit: '', generate: '', doc: '' }, opencode: { edit: 'big-pickle', generate: 'big-pickle', doc: 'big-pickle' }, opencodego: { edit: 'glm-5.3-flash', generate: 'glm-5.3-flash', doc: 'glm-5.3-flash' } }, openai: { baseUrl: null } });
    expect(parseSettingsFile('{nope')).toEqual(empty);
    expect(parseSettingsFile('[1,2]')).toEqual(empty);
  });

  it('keeps only known, well-formed values', () => {
    // Raw JSON, as a hostile file would arrive: "__proto__" is an own key here.
    const text = `{"provider":"openrouter","keys":{"anthropic":" sk-ant-1 ","openrouter":"${'x'.repeat(500)}","__proto__":{"polluted":true},"other":"k"},"models":{"openrouter":{"edit":"anthropic/claude-sonnet","generate":42,"doc":""}}}`;
    const parsed = parseSettingsFile(text);
    expect(parsed.provider).toBe('openrouter');
    expect(parsed.keys).toEqual({ anthropic: 'sk-ant-1' });
    expect(parsed.models.openrouter).toEqual({ edit: 'anthropic/claude-sonnet', generate: 'openrouter/auto', doc: 'openrouter/auto' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(parseSettingsFile(JSON.stringify({ provider: 'magic' })).provider).toBe('anthropic');
  });
});

describe('resolveProviders (environment wins over the file)', () => {
  it('reports each key and where it comes from', () => {
    const file = { ...empty, keys: { anthropic: 'sk-ant-file', openrouter: 'sk-or-file' } };
    const r = resolveProviders(file, { ANTHROPIC_API_KEY: ' sk-ant-env ' });
    expect(r.anthropic).toEqual({ key: 'sk-ant-env', source: 'env' });
    expect(r.openrouter).toEqual({ key: 'sk-or-file', source: 'file' });
    expect(resolveProviders(empty, {}).anthropic).toEqual({ key: null, source: null });
  });

  it('uses the chosen provider when it has a key, else the other one, else none', () => {
    expect(resolveProviders({ ...empty, provider: 'openrouter', keys: { openrouter: 'k' } }, {}).active).toBe('openrouter');
    expect(resolveProviders({ ...empty, provider: 'openrouter' }, { ANTHROPIC_API_KEY: 'k' }).active).toBe('anthropic');
    expect(resolveProviders(empty, {}).active).toBeNull();
  });
});

describe('keyHint', () => {
  it('shows only the last four characters', () => {
    expect(keyHint('sk-or-v1-abcdef1234')).toBe('…1234');
    expect(keyHint(null)).toBeNull();
  });
});

describe('applyPatch (POST /api/settings)', () => {
  it('sets and removes keys, the provider and OpenRouter models', () => {
    const next = applyPatch(empty, { provider: 'openrouter', keys: { openrouter: '  sk-or-1  ' }, models: { openrouter: { edit: 'openai/gpt-x' } } });
    expect(next).toMatchObject({ provider: 'openrouter', keys: { openrouter: 'sk-or-1' }, models: { openrouter: { edit: 'openai/gpt-x', generate: 'openrouter/auto' } } });
    expect(applyPatch(next as SettingsFile, { keys: { openrouter: null } })).toMatchObject({ keys: {} });
  });

  it('refuses malformed input with a pt-BR reason', () => {
    expect(applyPatch(empty, 'x')).toBe('Corpo inválido: envie um objeto JSON.');
    expect(applyPatch(empty, { provider: 'magic' })).toBe('Corpo inválido: selecione um provedor de IA disponível.');
    expect(applyPatch(empty, { keys: { anthropic: 'has space' } })).toBe('A chave não pode ter espaços.');
    expect(applyPatch(empty, { keys: { anthropic: 'k'.repeat(401) } })).toBe('A chave é longa demais.');
    expect(applyPatch(empty, { models: { openrouter: { edit: 'a b' } } })).toBe('Modelo inválido para "edit".');
  });
});

describe('createSettings (the service behind the routes)', () => {
  function setup(env: Record<string, string> = {}, initial: string | null = null) {
    const files = new Map<string, string>();
    if (initial) files.set('/cfg/settings.json', initial);
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith('/api/v1/key')) {
        const auth = new Headers(init?.headers).get('authorization');
        return new Response(JSON.stringify(auth === 'Bearer sk-or-good' ? { data: { label: 'minha chave' } } : { error: { message: 'No auth' } }), { status: auth === 'Bearer sk-or-good' ? 200 : 401 });
      }
      if (href.endsWith('/api/v1/models')) {
        return new Response(JSON.stringify({ data: [
          { id: 'anthropic/claude-sonnet', name: 'Claude Sonnet', context_length: 200000, supported_parameters: ['tools', 'max_tokens'] },
          { id: 'some/text-only', name: 'Text only', context_length: 8000, supported_parameters: ['max_tokens'] },
        ] }));
      }
      if (href.endsWith('/v1/models')) return new Response('{}', { status: new Headers(init?.headers).get('x-api-key') === 'sk-ant-good' ? 200 : 401 });
      throw new Error(`unexpected ${href}`);
    });
    const made: [string, string][] = [];
    const settings = createSettings({
      file: '/cfg/settings.json',
      env,
      fs: { read: async (path) => files.get(path) ?? null, write: async (path, text) => void files.set(path, text) },
      fetch: fetch as unknown as typeof globalThis.fetch,
      anthropic: (key) => (made.push(['anthropic', key]), client('anthropic')),
      openrouter: (key) => (made.push(['openrouter', key]), client('openrouter')),
    });
    return { settings, files, fetch, made };
  }

  it('starts without AI when nothing is configured, then switches on when a key is saved', async () => {
    const { settings, files, made } = setup();
    await settings.load();
    expect(settings.current()).toBeNull();
    const view = await settings.update({ provider: 'openrouter', keys: { openrouter: 'sk-or-secret-9876' } });
    expect(typeof view).toBe('object');
    expect(settings.current()).toMatchObject({ id: 'openrouter', models: { edit: 'openrouter/auto' } });
    expect(made).toEqual([['openrouter', 'sk-or-secret-9876']]);
    expect(JSON.parse(files.get('/cfg/settings.json')!)).toMatchObject({ provider: 'openrouter', keys: { openrouter: 'sk-or-secret-9876' } });
  });

  it('never puts a key in the public view', async () => {
    const { settings } = setup({ ANTHROPIC_API_KEY: 'sk-ant-env-1111' }, JSON.stringify({ keys: { openrouter: 'sk-or-file-2222' } }));
    await settings.load();
    const view = settings.view();
    expect(JSON.stringify(view)).not.toMatch(/sk-ant-env|sk-or-file/);
    expect(view.providers.anthropic).toEqual({ configured: true, source: 'env', hint: '…1111' });
    expect(view.providers.openrouter).toEqual({ configured: true, source: 'file', hint: '…2222' });
    expect(view.active).toBe('anthropic');
  });

  it('checks a key without spending tokens', async () => {
    const good = setup({}, JSON.stringify({ keys: { openrouter: 'sk-or-good', anthropic: 'sk-ant-bad' } }));
    await good.settings.load();
    expect(await good.settings.test('openrouter')).toEqual({ ok: true, detail: 'Chave aceita pelo OpenRouter (minha chave).' });
    expect(await good.settings.test('anthropic')).toEqual({ ok: false, detail: 'A Anthropic recusou a chave.' });
    const none = setup();
    await none.settings.load();
    expect(await none.settings.test('openrouter')).toEqual({ ok: false, detail: 'Nenhuma chave configurada.' });
  });

  it('lists only OpenRouter models that can call tools, cached', async () => {
    const { settings, fetch } = setup();
    await settings.load();
    expect(await settings.openRouterModels()).toEqual([{ id: 'anthropic/claude-sonnet', name: 'Claude Sonnet', context: 200000 }]);
    await settings.openRouterModels();
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/api/v1/models'))).toHaveLength(1);
  });
});

describe('OpenAI-compatible provider (settings file)', () => {
  const ready: SettingsFile = { ...empty, provider: 'openai', openai: { baseUrl: 'http://localhost:11434/v1' }, models: { ...empty.models, openai: { edit: 'llama3.1', generate: '', doc: '' } } };

  it('keeps a valid base URL and models, drops hostile ones', () => {
    const parsed = parseSettingsFile(JSON.stringify({ provider: 'openai', keys: { openai: ' sk-x ' }, openai: { baseUrl: 'http://localhost:11434/v1/' }, models: { openai: { edit: 'llama3.1', generate: 7, doc: 'a b' } } }));
    expect(parsed).toMatchObject({ provider: 'openai', keys: { openai: 'sk-x' }, openai: { baseUrl: 'http://localhost:11434/v1' }, models: { openai: { edit: 'llama3.1', generate: '', doc: '' } } });
    expect(parseSettingsFile(JSON.stringify({ openai: { baseUrl: 'javascript:alert(1)' } })).openai).toEqual({ baseUrl: null });
    expect(parseSettingsFile(JSON.stringify({ openai: { baseUrl: 'https://u:p@h.test/v1' } })).openai).toEqual({ baseUrl: null });
    expect(parseSettingsFile('{"openai":{"__proto__":{"baseUrl":"http://x.test"}}}').openai).toEqual({ baseUrl: null });
  });

  it('is usable with a URL and a model, without any key', () => {
    expect(resolveProviders(ready, {}).active).toBe('openai');
    expect(resolveProviders({ ...ready, openai: { baseUrl: null } }, {}).active).toBeNull();
    expect(resolveProviders({ ...ready, models: empty.models }, {}).active).toBeNull();
  });

  it('prefers the chosen provider, then the others in order', () => {
    expect(resolveProviders({ ...ready, provider: 'anthropic' }, {}).active).toBe('openai');
    expect(resolveProviders({ ...ready, provider: 'anthropic', keys: { openrouter: 'k' } }, {}).active).toBe('openrouter');
    expect(resolveProviders({ ...ready, provider: 'openai' }, { ANTHROPIC_API_KEY: 'k' }).active).toBe('openai');
    expect(resolveProviders(ready, { OPENAI_API_KEY: ' sk-env ' }).openai).toEqual({ key: 'sk-env', source: 'env' });
  });

  it('applyPatch sets and clears the URL, the key and the models', () => {
    const next = applyPatch(empty, { provider: 'openai', keys: { openai: ' sk-1 ' }, openai: { baseUrl: 'https://api.groq.com/openai/v1/' }, models: { openai: { edit: 'llama-3.3-70b', doc: 'x-y' } } }) as SettingsFile;
    expect(next).toMatchObject({ provider: 'openai', keys: { openai: 'sk-1' }, openai: { baseUrl: 'https://api.groq.com/openai/v1' }, models: { openai: { edit: 'llama-3.3-70b', generate: '', doc: 'x-y' } } });
    const cleared = applyPatch(next, { keys: { openai: null }, openai: { baseUrl: null }, models: { openai: { doc: null } } }) as SettingsFile;
    expect(cleared).toMatchObject({ keys: {}, openai: { baseUrl: null }, models: { openai: { edit: 'llama-3.3-70b', doc: '' } } });
    // The OpenRouter models stay untouched by an OpenAI-only patch.
    expect(next.models.openrouter).toEqual(empty.models.openrouter);
  });

  it('refuses a bad URL or model with a pt-BR reason', () => {
    expect(applyPatch(empty, { openai: { baseUrl: 'ftp://x' } })).toBe('O endereço precisa começar com http:// ou https://.');
    expect(applyPatch(empty, { openai: 'x' })).toBe('Corpo inválido: "openai" precisa ser um objeto.');
    expect(applyPatch(empty, { models: { openai: { edit: 'a b' } } })).toBe('Modelo inválido para "edit".');
    expect(applyPatch(empty, { models: { openai: 'x' } })).toBe('Corpo inválido: "models.openai" precisa ser um objeto.');
    expect(applyPatch(empty, { provider: 'magic' })).toBe('Corpo inválido: selecione um provedor de IA disponível.');
  });
});

describe('createSettings with the OpenAI-compatible provider', () => {
  function setup(models: unknown = { data: [{ id: 'llama3.1' }, { id: 'qwen2.5' }] }, status = 200) {
    const files = new Map<string, string>();
    const calls: { url: string; headers: Headers }[] = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers) });
      if (String(url) === 'http://llm.local/v1/models') return new Response(JSON.stringify(models), { status });
      throw new Error(`unexpected ${String(url)}`);
    });
    const made: unknown[] = [];
    const settings = createSettings({
      file: '/cfg/settings.json',
      env: {},
      fs: { read: async (path) => files.get(path) ?? null, write: async (path, text) => void files.set(path, text) },
      fetch: fetch as unknown as typeof globalThis.fetch,
      anthropic: () => client('anthropic'),
      openrouter: () => client('openrouter'),
      openai: (config) => (made.push(config), client('openai')),
    });
    return { settings, files, calls, made };
  }

  it('switches on with a URL and a model (no key) and gives the roles the edit model by default', async () => {
    const { settings, made } = setup();
    await settings.load();
    expect(settings.current()).toBeNull();
    await settings.update({ provider: 'openai', openai: { baseUrl: 'http://llm.local/v1' }, models: { openai: { edit: 'llama3.1' } } });
    expect(settings.current()).toMatchObject({ id: 'openai', models: { edit: 'llama3.1', generate: 'llama3.1', doc: 'llama3.1' } });
    expect(made).toEqual([{ baseUrl: 'http://llm.local/v1' }]);
    await settings.update({ keys: { openai: 'sk-secret-4321' }, models: { openai: { doc: 'qwen2.5' } } });
    expect(made.at(-1)).toEqual({ baseUrl: 'http://llm.local/v1', apiKey: 'sk-secret-4321' });
    expect(settings.current()!.models).toEqual({ edit: 'llama3.1', generate: 'llama3.1', doc: 'qwen2.5' });
  });

  it('never puts the key in the public view, and shows the URL', async () => {
    const { settings } = setup();
    await settings.load();
    await settings.update({ provider: 'openai', keys: { openai: 'sk-secret-4321' }, openai: { baseUrl: 'http://llm.local/v1' }, models: { openai: { edit: 'm' } } });
    const view = settings.view();
    expect(JSON.stringify(view)).not.toContain('sk-secret');
    expect(view).toMatchObject({ active: 'openai', openai: { baseUrl: 'http://llm.local/v1' }, providers: { openai: { configured: true, source: 'file', hint: '…4321' } } });
  });

  it('tests the connection on /models, with the key only when there is one', async () => {
    const { settings, calls } = setup();
    await settings.load();
    expect(await settings.test('openai')).toEqual({ ok: false, detail: 'Informe o endereço do servidor.' });
    await settings.update({ openai: { baseUrl: 'http://llm.local/v1' }, models: { openai: { edit: 'llama3.1' } } });
    expect(await settings.test('openai')).toEqual({ ok: true, detail: 'Conectado a http://llm.local/v1 (2 modelos).' });
    expect(calls[0]!.headers.has('authorization')).toBe(false);
    await settings.update({ keys: { openai: 'sk-1' } });
    await settings.test('openai');
    expect(calls[1]!.headers.get('authorization')).toBe('Bearer sk-1');
  });

  it('warns when the chosen model is not in the server list, and words refusals and failures', async () => {
    const warn = setup();
    await warn.settings.load();
    await warn.settings.update({ openai: { baseUrl: 'http://llm.local/v1' }, models: { openai: { edit: 'gpt-x' } } });
    expect(await warn.settings.test('openai')).toEqual({ ok: true, detail: 'Conectado a http://llm.local/v1 (2 modelos), mas o modelo "gpt-x" não aparece na lista do servidor.' });
    const denied = setup({}, 401);
    await denied.settings.load();
    await denied.settings.update({ openai: { baseUrl: 'http://llm.local/v1' }, models: { openai: { edit: 'm' } } });
    expect(await denied.settings.test('openai')).toEqual({ ok: false, detail: 'O servidor compatível com OpenAI recusou a chave.' });
    const missing = setup({}, 404);
    await missing.settings.load();
    await missing.settings.update({ openai: { baseUrl: 'http://llm.local/v1' }, models: { openai: { edit: 'm' } } });
    expect((await missing.settings.test('openai')).detail).toMatch(/404.*\/v1/);
    const down = setup();
    await down.settings.load();
    await down.settings.update({ openai: { baseUrl: 'http://other.local/v1' }, models: { openai: { edit: 'm' } } });
    expect(await down.settings.test('openai')).toEqual({ ok: false, detail: 'Não foi possível falar com o servidor em http://other.local/v1.' });
  });

  it('warns that a key goes in the clear to a remote http server, but not to a local one or over https', async () => {
    const run = async (baseUrl: string, key?: string) => {
      const files = new Map<string, string>();
      const settings = createSettings({
        file: '/cfg/settings.json', env: {},
        fs: { read: async (path) => files.get(path) ?? null, write: async (path, text) => void files.set(path, text) },
        fetch: (async () => new Response(JSON.stringify({ data: [{ id: 'm' }] }))) as unknown as typeof globalThis.fetch,
        anthropic: () => client('a'), openrouter: () => client('o'),
      });
      await settings.load();
      await settings.update({ openai: { baseUrl }, models: { openai: { edit: 'm' } }, ...(key ? { keys: { openai: key } } : {}) });
      return (await settings.test('openai')).detail;
    };
    const warning = /sem criptografia/;
    expect(await run('http://llm.example.com/v1', 'sk-1')).toMatch(warning);
    expect(await run('http://llm.example.com/v1')).not.toMatch(warning);
    expect(await run('https://llm.example.com/v1', 'sk-1')).not.toMatch(warning);
    for (const local of ['http://localhost:11434/v1', 'http://127.0.0.1:1234/v1', 'http://[::1]:8080/v1', 'http://192.168.0.7/v1', 'http://10.0.0.2/v1', 'http://172.20.1.1/v1', 'http://minha-maquina.local/v1']) {
      expect(await run(local, 'sk-1')).not.toMatch(warning);
    }
    expect(await run('http://172.32.0.1/v1', 'sk-1')).toMatch(warning);
  });

  it('does not carry the saved key to another host when only the URL changes (leak chain)', async () => {
    const files = new Map<string, string>();
    const sent: { url: string; auth: string | null }[] = [];
    const settings = createSettings({
      file: '/cfg/settings.json', env: {},
      fs: { read: async (path) => files.get(path) ?? null, write: async (path, text) => void files.set(path, text) },
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        sent.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
        return new Response(JSON.stringify({ data: [{ id: 'm' }] }));
      }) as unknown as typeof globalThis.fetch,
      anthropic: () => client('a'), openrouter: () => client('o'),
    });
    await settings.load();
    await settings.update({ provider: 'openai', keys: { openai: 'sk-secret-4321' }, openai: { baseUrl: 'https://api.groq.com/openai/v1' }, models: { openai: { edit: 'm' } } });
    // Same host, other path: the key stays.
    await settings.update({ openai: { baseUrl: 'https://api.groq.com/other/v1' } });
    expect(settings.view().providers.openai.hint).toBe('…4321');
    // Another host, no key in the same request: the saved key is dropped before anything is sent there.
    await settings.update({ openai: { baseUrl: 'https://attacker.example/v1' } });
    await settings.test('openai');
    expect(sent.at(-1)).toEqual({ url: 'https://attacker.example/v1/models', auth: null });
    expect(JSON.stringify([...files.values()])).not.toContain('sk-secret-4321');
    expect(settings.view().providers.openai.hint).toBeNull();
  });

  it('keeps a key typed in the same request as the new host, and also drops it when the first URL arrives later', () => {
    const withKey = { ...empty, keys: { openai: 'sk-old' }, openai: { baseUrl: 'https://a.example/v1' } };
    expect((applyPatch(withKey, { openai: { baseUrl: 'https://b.example/v1' }, keys: { openai: 'sk-new' } }) as SettingsFile).keys.openai).toBe('sk-new');
    expect((applyPatch(withKey, { openai: { baseUrl: 'https://b.example/v1' } }) as SettingsFile).keys.openai).toBeUndefined();
    expect((applyPatch(withKey, { openai: { baseUrl: 'http://a.example/v1' } }) as SettingsFile).keys.openai).toBeUndefined();
    expect((applyPatch(withKey, { openai: { baseUrl: 'https://a.example:8443/v1' } }) as SettingsFile).keys.openai).toBeUndefined();
    // Clearing the URL sends nothing anywhere; the next URL (any) still has to bring its own key.
    const cleared = applyPatch(withKey, { openai: { baseUrl: null } }) as SettingsFile;
    expect(cleared.keys.openai).toBe('sk-old');
    expect((applyPatch(cleared, { openai: { baseUrl: 'https://a.example/v1' } }) as SettingsFile).keys.openai).toBeUndefined();
    // A key saved before any URL existed must not follow the first URL either.
    expect((applyPatch({ ...empty, keys: { openai: 'sk-old' } }, { openai: { baseUrl: 'https://b.example/v1' } }) as SettingsFile).keys.openai).toBeUndefined();
    // Unrelated patches leave it alone, and so does re-saving the same URL.
    expect((applyPatch(withKey, { models: { openai: { edit: 'x' } } }) as SettingsFile).keys.openai).toBe('sk-old');
    expect((applyPatch(withKey, { openai: { baseUrl: 'https://a.example/v1/' } }) as SettingsFile).keys.openai).toBe('sk-old');
  });

  it('lists the server models for the picker', async () => {
    const { settings } = setup({ data: [{ id: 'b' }, { id: 'a' }, { nope: 1 }, { id: 3 }] });
    await settings.load();
    await expect(settings.openAiModels()).rejects.toThrow('Informe o endereço do servidor.');
    await settings.update({ openai: { baseUrl: 'http://llm.local/v1' } });
    expect(await settings.openAiModels()).toEqual(['a', 'b']);
  });
});
