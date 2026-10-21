import Anthropic from '@anthropic-ai/sdk';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ADMIN_PLAN, newWorkspace, workspaceFiles } from '@strukt/workspace';
import { createFsAdapter, writeWorkspace } from '@strukt/workspace/fs';
import { describe, expect, it } from 'vitest';
import type { AiClient } from './anthropic';
import { fakeRunner } from '@strukt/git/testing';
import { NO_KEY, createApp, describeError } from './app';
import { setupAgents } from './agentSetup';
import { allowedOrigins } from './origin';
import { ProviderError } from './openrouter';
import { createSettings } from './settings';
import { createShare } from './share';
import { UserError } from './userError';
import { DOC_SYSTEM_PROMPT } from './doc';
import type { GithubAuth } from './githubAuth';
import { fakeClient, message, toolUse } from './testing';

const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

const valid = { instruction: 'remova DB', json: '{"version": 1, "nodes": [{"id": "API"}, {"id": "DB"}], "connections": [{"from": "API", "to": "DB"}]}', mode: 'edit' };

describe('HTTP API', () => {
  it('reports trusted local entitlement and ignores forged account fields', async () => {
    const regular = createApp({});
    const admin = createApp({ accessPlan: ADMIN_PLAN });
    expect(await (await regular.request('/api/plan?admin=true', { headers: { 'x-joinlet-admin': '1' } })).json()).toMatchObject({ plan: { id: 'self-hosted', limits: { diagrams: null } } });
    expect(await (await admin.request('/api/plan')).json()).toMatchObject({ plan: { id: 'administrator', limits: { diagrams: null } } });
    expect((await admin.request('http://evil.example/api/plan')).status).toBe(403);
  });

  it('clears only the selected repository and disables its workspace access', async () => {
    let selected: string | null = '/repo-a';
    const app = createApp({ selectedRepo: { get: () => selected, set: async (path) => { selected = path; } } });
    expect((await post(app, '/api/git/disconnect', { dir: '/repo-b' })).status).toBe(409);
    expect(selected).toBe('/repo-a');
    expect((await post(app, '/api/git/disconnect', { dir: '/repo-a' })).status).toBe(200);
    expect(selected).toBeNull();
    expect((await app.request('/api/workspace?dir=/repo-a')).status).not.toBe(200);
  });
  it('offers to initialize a git repo without .arch and connects after receiving browser files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'strukt-connect-'));
    let selected: string | null = null;
    const runner = fakeRunner({ responses: [
      { when: (cmd, args) => cmd === 'git' && args[0] === 'rev-parse' && args[1] === '--show-toplevel', result: { code: 0, stdout: `${root}\n`, stderr: '' } },
      { when: (cmd, args) => cmd === 'git' && args[0] === 'rev-parse', result: { code: 0, stdout: 'true\n', stderr: '' } },
      { when: (cmd, args) => cmd === 'git' && args[0] === 'branch', result: { code: 0, stdout: 'main\n', stderr: '' } },
      { when: (cmd, args) => cmd === 'gh' && args[0] === 'auth', result: { code: 1, stdout: '', stderr: '' } },
      { when: (cmd, args) => cmd === 'git' && args[0] === 'status', result: { code: 0, stdout: '', stderr: '' } },
    ] });
    const app = createApp({ runner, selectedRepo: { get: () => selected, set: async (path) => { selected = path; } } });
    try {
      const probe = await post(app, '/api/git/connect', { dir: root });
      expect(probe.status).toBe(409);
      expect(await probe.json()).toEqual({ needsInit: true, root });
      const connected = await post(app, '/api/git/connect', { dir: root, files: workspaceFiles(newWorkspace('Loja')) });
      expect(connected.status).toBe(200);
      expect(await connected.json()).toMatchObject({ initialized: true, repo: { root } });
      expect(selected).toBe(root);
      expect(await readFile(join(root, '.arch', 'strukt.json'), 'utf8')).toContain('Loja');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('serves MCP over HTTP against the selected repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'strukt-http-mcp-'));
    const arch = join(root, '.arch');
    await mkdir(arch);
    await writeWorkspace(createFsAdapter(arch), newWorkspace('HTTP'));
    const setup = await setupAgents(root);
    const app = createApp({ selectedRepo: { get: () => root, set: async () => {} } });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:8787/mcp/${setup.id}`), {
      fetch: async (input, init) => app.fetch(new Request(input, init)),
    });
    const client = new Client({ name: 'test', version: '1.0.0' });
    try {
      const wrong = await post(app, '/mcp/another-project', {});
      expect(wrong.status).toBe(409);
      await client.connect(transport);
      const result = await client.callTool({ name: 'write_doc', arguments: { title: 'Decisões', markdown: '# Decisões\n' } });
      expect(result.isError).not.toBe(true);
      const listed = await client.callTool({ name: 'list_diagrams', arguments: {} });
      expect(JSON.stringify(listed)).toContain('Decisões');
      const file = await app.request(`/api/workspace?dir=${encodeURIComponent(root)}&path=docs%2Fdecisoes.md`);
      expect(await file.json()).toEqual({ text: '# Decisões\n' });
      const edited = await post(app, '/api/workspace', { dir: root, path: 'docs/decisoes.md', text: '# Atualizado no editor\n' });
      expect(edited.status).toBe(200);
      const nothing = await post(app, '/api/workspace', { dir: root, path: 'docs/decisoes.md' });
      expect(nothing.status).toBe(400);
      expect(await nothing.json()).toEqual({ error: 'Envie o texto do arquivo ("text") ou "remove": true.' });
      const stale = await post(app, '/api/workspace', { dir: root, path: 'docs/decisoes.md', text: '# Antigo\n', expected: '# Decisões\n' });
      expect(stale.status).toBe(409);
      const refreshed = await client.callTool({ name: 'get_doc', arguments: { slug: 'decisoes' } });
      expect(JSON.stringify(refreshed)).toContain('Atualizado no editor');
    } finally {
      await client.close();
      await rm(root, { recursive: true, force: true });
    }
  });
  it('reports whether AI is configured', async () => {
    expect(await (await createApp({ ai: null }).request('/api/health')).json()).toEqual({ ok: true, ai: false });
    expect(await (await createApp({ ai: fakeClient().client }).request('/api/health')).json()).toEqual({ ok: true, ai: true });
  });

  it('exposes the GitHub device code but never the OAuth tokens', async () => {
    const auth = {
      view: () => ({ configured: true, connected: true, login: 'marco' }),
      startDeviceFlow: async () => ({ ok: true as const, flow: { id: 'flow', userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device', intervalSeconds: 5, expiresAt: 123 } }),
      pollDeviceFlow: async () => ({ state: 'connected' as const, login: 'marco' }),
      disconnect: async () => {},
      token: async () => 'secret-access-token',
    } as unknown as GithubAuth;
    const app = createApp({ ai: null, githubAuth: auth });

    expect(await (await app.request('/api/git/auth')).json()).toEqual({ configured: true, connected: true, login: 'marco' });
    const start = await post(app, '/api/git/auth/device', {});
    const startBody = await start.json();
    expect(startBody).toEqual({ id: 'flow', userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device', intervalSeconds: 5, expiresAt: 123 });
    const poll = await app.request('/api/git/auth/device/flow');
    const pollBody = await poll.json();
    expect(pollBody).toEqual({ state: 'connected', login: 'marco' });
    expect(JSON.stringify({ startBody, pollBody })).not.toContain('secret-access-token');
  });

  it('answers 503 with a pt-BR message when there is no API key', async () => {
    const app = createApp({ ai: null });
    for (const [path, body] of [['/api/ai/diagram', valid], ['/api/ai/doc', { json: '{"version": 1, "nodes": [{"id": "A"}]}' }]] as const) {
      const res = await post(app, path, body);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: NO_KEY });
    }
  });

  it('answers 400 for invalid bodies without calling Claude', async () => {
    const { client, calls } = fakeClient();
    const app = createApp({ ai: client });
    const cases: [string, unknown, string][] = [
      ['/api/ai/diagram', '{nope', 'Corpo inválido: envie um objeto JSON.'],
      ['/api/ai/diagram', { ...valid, instruction: '  ' }, 'Corpo inválido: "instruction" é obrigatório.'],
      ['/api/ai/diagram', { ...valid, json: 3 }, 'Corpo inválido: "json" precisa ser texto.'],
      ['/api/ai/diagram', { ...valid, mode: 'magic' }, 'Corpo inválido: "mode" precisa ser "edit" ou "generate".'],
      ['/api/ai/diagram', { ...valid, selection: 'DB' }, 'Corpo inválido: "selection" precisa ser uma lista de nomes.'],
      ['/api/ai/diagram', { ...valid, json: '{"version": 1, "nodes": [}' }, 'O diagrama tem erro na linha 1: JSON inválido: Caractere inesperado "}".'],
      ['/api/ai/doc', {}, 'Corpo inválido: "json" precisa ser texto.'],
      ['/api/ai/doc', { json: '{"version": 1, "nodes": []}' }, 'O diagrama está vazio.'],
    ];
    for (const [path, body, error] of cases) {
      const res = await post(app, path, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toEqual({ error });
    }
    expect(calls).toHaveLength(0);
  });

  it('returns validated ops, the summary and the model that answered', async () => {
    const { client } = fakeClient(message([toolUse({ ops: [{ op: 'remove', id: 'DB' }], summary: 'Removi o DB.' })]));
    const res = await post(createApp({ ai: client }), '/api/ai/diagram', { ...valid, selection: ['DB'] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ops: [{ op: 'remove', id: 'DB' }], summary: 'Removi o DB.', model: 'claude-sonnet-5' });
  });

  it('maps Anthropic SDK errors to pt-BR messages', async () => {
    const limited = fakeClient(new Anthropic.RateLimitError(429, undefined, 'rate limited', new Headers()));
    const res = await post(createApp({ ai: limited.client }), '/api/ai/diagram', valid);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'Limite de uso da API da Anthropic atingido. Tente de novo em instantes.' });
    const offline = fakeClient(new Anthropic.APIConnectionError({ message: 'down' }));
    const down = await post(createApp({ ai: offline.client }), '/api/ai/doc', { json: '{"version": 1, "nodes": [{"id": "A"}, {"id": "B"}]}' });
    expect(down.status).toBe(502);
    expect(await down.json()).toEqual({ error: 'Não foi possível falar com a API da Anthropic.' });
  });

  it('answers a chat turn, and refuses a bad body or a missing key', async () => {
    const { client, calls } = fakeClient(message([{ type: 'text', text: 'A API fala com o banco.' }], { stop_reason: 'end_turn' }));
    const res = await post(createApp({ ai: client }), '/api/ai/chat', { messages: [{ role: 'user', content: 'E a API?' }], context: '{"version":1}' });
    expect(await res.json()).toEqual({ reply: 'A API fala com o banco.' });
    expect(calls[0]!.messages).toEqual([{ role: 'user', content: 'E a API?' }]);
    const bad = await post(createApp({ ai: client }), '/api/ai/chat', { messages: [] });
    expect(bad.status).toBe(400);
    const down = await post(createApp({}), '/api/ai/chat', { messages: [{ role: 'user', content: 'oi' }] });
    expect(down.status).toBe(503);
  });

  it('streams a chat answer as one JSON line per piece, then a done line', async () => {
    const { client } = fakeClient();
    const streaming: AiClient = {
      beta: { messages: { create: client.beta.messages.create, stream: () => (async function* () {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Olá, ' } };
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'mundo.' } };
        yield { type: 'message_delta', delta: { stop_reason: 'end_turn' } };
      })() } },
    };
    const res = await post(createApp({ ai: streaming }), '/api/ai/chat', { messages: [{ role: 'user', content: 'oi' }], stream: true });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const lines = (await res.text()).trim().split('\n').map((line) => JSON.parse(line));
    expect(lines).toEqual([{ t: 'Olá, ' }, { t: 'mundo.' }, { done: true }]);
  });

  it('a stream that fails before the first piece answers with the error status; later it ends with an error line', async () => {
    const { client } = fakeClient();
    const early: AiClient = { beta: { messages: { create: client.beta.messages.create, stream: () => (async function* () { throw new Anthropic.RateLimitError(429, undefined, 'rate', new Headers()); yield { type: 'x' }; })() } } };
    const res = await post(createApp({ ai: early }), '/api/ai/chat', { messages: [{ role: 'user', content: 'oi' }], stream: true });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'Limite de uso da API da Anthropic atingido. Tente de novo em instantes.' });
    const late: AiClient = { beta: { messages: { create: client.beta.messages.create, stream: () => (async function* () {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'meio' } };
      throw new Anthropic.APIConnectionError({ message: 'down' });
    })() } } };
    const second = await post(createApp({ ai: late }), '/api/ai/chat', { messages: [{ role: 'user', content: 'oi' }], stream: true });
    const lines = (await second.text()).trim().split('\n').map((line) => JSON.parse(line));
    expect(lines).toEqual([{ t: 'meio' }, { error: 'Não foi possível falar com a API da Anthropic.' }]);
  });

  it('writes the architecture document with Sonnet 5', async () => {
    const { client, calls } = fakeClient(message([{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: '# Loja\n\n## Visão geral\n…' }], { stop_reason: 'end_turn' }));
    const res = await post(createApp({ ai: client }), '/api/ai/doc', { json: '{"version": 1, "nodes": [{"id": "Web"}, {"id": "API"}]}' });
    expect(await res.json()).toEqual({ markdown: '# Loja\n\n## Visão geral\n…' });
    expect(calls[0]).toMatchObject({
      model: 'claude-sonnet-5',
      system: DOC_SYSTEM_PROMPT,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      messages: [{ role: 'user', content: '<diagrama>\n{"version": 1, "nodes": [{"id": "Web"}, {"id": "API"}]}\n</diagrama>' }],
    });
  });

  it('serves the local git endpoints for the GitHub panel', async () => {
    const runner = fakeRunner({
      responses: [
        { when: (cmd, args) => cmd === 'git' && args[0] === 'rev-parse', result: { code: 0, stdout: 'true\n', stderr: '' } },
        { when: (cmd, args) => cmd === 'git' && args[0] === 'branch', result: { code: 0, stdout: 'main\n', stderr: '' } },
        { when: (cmd, args) => cmd === 'gh' && args[0] === 'auth', result: { code: 0, stdout: 'ok', stderr: '' } },
        { when: (cmd, args) => cmd === 'gh' && args[0] === 'repo', result: { code: 0, stdout: 'x/y\nmain\n', stderr: '' } },
        { when: (cmd, args) => cmd === 'git' && args[0] === 'status', result: { code: 0, stdout: ' M .arch/strukt.json\n', stderr: '' } },
      ],
    });
    const app = createApp({ ai: null, runner });
    const status = await app.request('/api/git/status?dir=%2Ftmp%2Fnao-existe');
    expect(status.status).toBe(400);
    expect(await status.json()).toEqual({ ok: false, error: 'A pasta não tem um workspace do Joinlet (.arch/strukt.json).' });

    expect((await app.request('/api/git/status')).status).toBe(400);
    expect((await app.request('/api/git/changes')).status).toBe(400);
    const light = await app.request('/api/git/changes?dir=%2Ftmp%2Fnao-existe');
    expect(light.status).toBe(400);
    expect(await light.json()).toEqual({ ok: false, error: 'A pasta não tem um workspace do Joinlet (.arch/strukt.json).' });
    const foreign = await app.request('http://evil.example/api/git/changes?dir=%2Ftmp%2Fx', { headers: { host: 'evil.example' } });
    expect(foreign.status).toBe(403);
    const relative = await post(app, '/api/git/diff', { dir: 'relativo' });
    expect(relative.status).toBe(400);
    expect(await relative.json()).toEqual({ ok: false, error: 'Informe o caminho absoluto da pasta do repositório.' });

    const noTitle = await post(app, '/api/git/publish', { dir: '/tmp/x' });
    expect(noTitle.status).toBe(400);
    expect(await noTitle.json()).toEqual({ error: 'Corpo inválido: "title" é obrigatório.' });
  });

  it('rejects bodies over 1 MB', async () => {
    const res = await post(createApp({ ai: fakeClient().client }), '/api/ai/doc', { json: 'x'.repeat(1_100_000) });
    expect(res.status).toBe(413);
  });

  it('rejects a POST without a JSON content-type (415), without calling Claude', async () => {
    const { client, calls } = fakeClient();
    const app = createApp({ ai: client });
    const res = await app.request('/api/ai/diagram', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(valid) });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: 'Envie o corpo como JSON (Content-Type: application/json).' });
    expect(calls).toHaveLength(0);
  });

  it('rejects a non-local Host (403 on any /api/* route), without calling Claude', async () => {
    const { client, calls } = fakeClient();
    const app = createApp({ ai: client });
    const diagram = await app.request('http://evil.example/api/ai/diagram', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(valid),
    });
    expect(diagram.status).toBe(403);
    expect(await diagram.json()).toEqual({ error: 'O servidor de IA só aceita pedidos desta máquina (localhost).' });
    expect(calls).toHaveLength(0);
    const health = await app.request('http://evil.example/api/health');
    expect(health.status).toBe(403);
  });

  describe('Origin (a page on another origin must not drive the owner API)', () => {
    const evil = ['http://evil.localhost:3000', 'http://localhost:3000', 'http://127.0.0.1:9', 'https://localhost:5178', 'null', 'http://localhost.evil.example:5178', 'not a url'];
    const call = (app: ReturnType<typeof createApp>, path: string, origin: string, method = 'GET') =>
      app.request(`http://localhost:5178${path}`, { method, headers: { origin, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: '{}' } : {}) });

    it('refuses a foreign Origin on every /api route and never reaches the handler', async () => {
      let started = 0;
      const share = createShare({ start: async () => { started += 1; throw new Error('não deveria iniciar'); }, freePort: async () => 8790 });
      const app = createApp({ share, selectedRepo: { get: () => '/repo', set: async () => {} } });
      for (const origin of evil) {
        for (const path of ['/api/health', '/api/share', '/api/settings', '/api/integrations', '/api/share/audit']) expect((await call(app, path, origin)).status, `${origin} ${path}`).toBe(403);
        for (const path of ['/api/share/start', '/api/share/tunnel/start', '/api/share/invites']) expect((await call(app, path, origin, 'POST')).status, `${origin} ${path}`).toBe(403);
      }
      expect(started).toBe(0);
    });

    it('gives a pt-BR reason that names the knob', async () => {
      const res = await call(createApp({}), '/api/health', 'http://evil.localhost:3000');
      expect((await res.json() as { error: string }).error).toContain('STRUKT_ALLOWED_ORIGINS');
    });

    it('still serves the real app: dev (5178), preview (4173), this server, no Origin at all', async () => {
      const app = createApp({ allowedOrigins: allowedOrigins({}, 8787) });
      for (const origin of ['http://localhost:5178', 'http://127.0.0.1:5178', 'http://[::1]:5178', 'http://localhost:4173', 'http://localhost:8787']) {
        expect((await call(app, '/api/health', origin)).status, origin).toBe(200);
      }
      expect((await app.request('http://localhost:5178/api/health')).status).toBe(200);
    });

    it('takes extra origins from STRUKT_ALLOWED_ORIGINS (Vite on another port)', async () => {
      const app = createApp({ allowedOrigins: allowedOrigins({ STRUKT_ALLOWED_ORIGINS: 'http://localhost:5199, junk' }) });
      expect((await call(app, '/api/health', 'http://localhost:5199')).status).toBe(200);
      expect((await call(app, '/api/health', 'http://localhost:5200')).status).toBe(403);
    });

    it('refuses a cross-site fetch even when it carries no Origin (a no-cors GET)', async () => {
      const app = createApp({});
      expect((await app.request('http://localhost:5178/api/health', { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
      expect((await app.request('http://localhost:5178/api/health', { headers: { 'sec-fetch-site': 'same-origin' } })).status).toBe(200);
    });

    it('applies the same rule to /mcp (a page on another localhost port cannot write .arch)', async () => {
      const app = createApp({});
      expect((await call(app, '/mcp', 'http://localhost:3000', 'POST')).status).toBe(403);
      expect((await call(app, '/mcp', 'http://evil.localhost:3000', 'POST')).status).toBe(403);
    });
  });

  it('answers 504 with a pt-BR message when the request deadline is reached', async () => {
    const stuck: AiClient = {
      beta: {
        messages: {
          create: (_params, options) =>
            new Promise((_resolve, reject) => {
              const fail = () => reject(new Anthropic.APIUserAbortError());
              if (options?.signal?.aborted) fail();
              else options?.signal?.addEventListener('abort', fail);
            }),
        },
      },
    };
    const app = createApp({ ai: stuck, deadlineMs: 20 });
    const diagram = await post(app, '/api/ai/diagram', valid);
    expect(diagram.status).toBe(504);
    expect(await diagram.json()).toEqual({ error: 'A IA demorou demais para responder. Tente um pedido menor ou tente de novo.' });
    const doc = await post(app, '/api/ai/doc', { json: '{"version": 1, "nodes": [{"id": "A"}, {"id": "B"}]}' });
    expect(doc.status).toBe(504);
    expect(await doc.json()).toEqual({ error: 'A IA demorou demais para responder. Tente um pedido menor ou tente de novo.' });
  });

  it('accepts the Vite-proxied Host (localhost:5178)', async () => {
    const { client } = fakeClient(message([toolUse({ ops: [{ op: 'remove', id: 'DB' }], summary: 'Removi o DB.' })]));
    const app = createApp({ ai: client });
    const res = await app.request('http://localhost:5178/api/ai/diagram', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(valid),
    });
    expect(res.status).toBe(200);
  });
});

describe('Configurações (/api/settings)', () => {
  function withSettings(env: Record<string, string> = {}) {
    const files = new Map<string, string>();
    const made: string[] = [];
    const { client } = fakeClient(message([toolUse({ ops: [{ op: 'remove', id: 'DB' }], summary: 'Removi o DB.' })]));
    const settings = createSettings({
      file: '/cfg/settings.json',
      env,
      fs: { read: async (p) => files.get(p) ?? null, write: async (p, t) => void files.set(p, t) },
      fetch: (async (url: string | URL | Request) =>
        String(url).endsWith('/api/v1/key') ? new Response('{"data":{}}') : new Response('{"data":[]}')) as typeof fetch,
      anthropic: (key) => (made.push(`anthropic:${key}`), client),
      openrouter: (key) => (made.push(`openrouter:${key}`), client),
    });
    return { app: createApp({ settings }), settings, files, made };
  }

  it('starts offline, turns AI on when a key is saved (no restart) and never answers with the key', async () => {
    const { app, settings, made } = withSettings();
    await settings.load();
    expect(await (await app.request('/api/health')).json()).toEqual({ ok: true, ai: false, provider: null });
    expect((await post(app, '/api/ai/diagram', valid)).status).toBe(503);

    const saved = await post(app, '/api/settings', { provider: 'openrouter', keys: { openrouter: 'sk-or-secret-4321' } });
    expect(saved.status).toBe(200);
    const text = await saved.text();
    expect(text).not.toContain('sk-or-secret');
    expect(JSON.parse(text)).toMatchObject({ active: 'openrouter', providers: { openrouter: { configured: true, source: 'file', hint: '…4321' } } });
    expect(made).toEqual(['openrouter:sk-or-secret-4321']);
    expect(await (await app.request('/api/health')).json()).toEqual({ ok: true, ai: true, provider: 'openrouter' });

    const res = await post(app, '/api/ai/diagram', valid);
    expect(await res.json()).toMatchObject({ ops: [{ op: 'remove', id: 'DB' }] });
    expect(await (await app.request('/api/settings')).text()).not.toContain('sk-or-secret');
  });

  it('refuses bad bodies and unknown providers with pt-BR reasons', async () => {
    const { app, settings } = withSettings();
    await settings.load();
    expect(await (await post(app, '/api/settings', { keys: { anthropic: 'a b' } })).json()).toEqual({ error: 'A chave não pode ter espaços.' });
    expect((await post(app, '/api/settings/test', { provider: 'magic' })).status).toBe(400);
    expect(await (await post(app, '/api/settings/test', { provider: 'openrouter' })).json()).toEqual({ ok: false, detail: 'Nenhuma chave configurada.' });
    expect(await (await app.request('/api/settings/openrouter-models')).json()).toEqual({ models: [] });
  });

  it('maps OpenRouter HTTP errors to pt-BR messages', () => {
    expect(describeError(new ProviderError(401, 'nope'))).toEqual({ status: 502, error: 'O OpenRouter recusou a chave.' });
    expect(describeError(new ProviderError(402, 'credits'))).toEqual({ status: 502, error: 'Sem créditos no OpenRouter.' });
    expect(describeError(new ProviderError(429, 'slow'))).toEqual({ status: 429, error: 'Limite de uso do OpenRouter atingido. Tente de novo em instantes.' });
  });

  it('names the provider in HTTP error messages (OpenAI-compatible server)', () => {
    const compat = 'servidor compatível com OpenAI';
    expect(describeError(new ProviderError(401, 'nope', compat))).toEqual({ status: 502, error: `O ${compat} recusou a chave.` });
    expect(describeError(new ProviderError(429, 'slow', compat))).toEqual({ status: 429, error: `Limite de uso do ${compat} atingido. Tente de novo em instantes.` });
    expect(describeError(new ProviderError(500, 'boom', compat))).toEqual({ status: 502, error: `O ${compat} respondeu com erro 500: boom` });
  });

  it('configures an OpenAI-compatible server end to end (no key), tests it and lists its models', async () => {
    const files = new Map<string, string>();
    const requests: { url: string; body?: unknown; auth: string | null }[] = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), auth: new Headers(init?.headers).get('authorization'), ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'llama3.1' }] }));
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'apply_diagram_ops', arguments: JSON.stringify({ ops: [{ op: 'remove', id: 'DB' }], summary: 'Removi o DB.' }) } }] }, finish_reason: 'tool_calls' }] }));
    }) as typeof globalThis.fetch;
    const settings = createSettings({
      file: '/cfg/settings.json',
      env: {},
      fs: { read: async (p) => files.get(p) ?? null, write: async (p, t) => void files.set(p, t) },
      fetch,
      anthropic: () => fakeClient(message([])).client,
      openrouter: () => fakeClient(message([])).client,
    });
    const app = createApp({ settings });
    await settings.load();
    const saved = await post(app, '/api/settings', { provider: 'openai', openai: { baseUrl: 'http://localhost:11434/v1' }, models: { openai: { edit: 'llama3.1' } } });
    expect(JSON.parse(await saved.text())).toMatchObject({ active: 'openai', openai: { baseUrl: 'http://localhost:11434/v1' } });
    expect(await (await app.request('/api/health')).json()).toEqual({ ok: true, ai: true, provider: 'openai' });
    expect(await (await post(app, '/api/settings/test', { provider: 'openai' })).json()).toEqual({ ok: true, detail: 'Conectado a http://localhost:11434/v1 (1 modelo).' });
    expect(await (await app.request('/api/settings/openai-models')).json()).toEqual({ models: ['llama3.1'] });
    const res = await post(app, '/api/ai/diagram', valid);
    expect(await res.json()).toMatchObject({ ops: [{ op: 'remove', id: 'DB' }] });
    const call = requests.find((r) => r.url.endsWith('/chat/completions'))!;
    expect(call).toMatchObject({ url: 'http://localhost:11434/v1/chat/completions', auth: null, body: { model: 'llama3.1' } });
  });

  it('answers a readable error when the OpenAI-compatible server cannot list models', async () => {
    const files = new Map<string, string>();
    const settings = createSettings({
      file: '/cfg/settings.json', env: {},
      fs: { read: async (p) => files.get(p) ?? null, write: async (p, t) => void files.set(p, t) },
      fetch: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof globalThis.fetch,
      anthropic: () => fakeClient(message([])).client, openrouter: () => fakeClient(message([])).client,
    });
    const app = createApp({ settings });
    await settings.load();
    expect(await (await app.request('/api/settings/openai-models')).json()).toEqual({ error: 'Informe o endereço do servidor.' });
    await post(app, '/api/settings', { openai: { baseUrl: 'http://localhost:1/v1' } });
    const res = await app.request('/api/settings/openai-models');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Não foi possível falar com o servidor em http://localhost:1/v1.' });
  });

  describe('share routes', () => {
    const invite = (id: string, name: string, role: 'edit' | 'comment' | 'view' = 'view') => ({ id, name, role, createdAt: 1, expiresAt: null, url: `http://192.168.0.5:8790/join?token=${id}`, publicUrl: null });
    const host = () => {
      let list = [invite('e', 'Link para editar', 'edit'), invite('v', 'Link só para ver')];
      return {
        invites: {
          list: () => list,
          create: (input: { name: unknown; role: unknown; ttl: unknown }) => { if (!input.name) throw new UserError('Informe o nome do convite.'); const made = invite('n', String(input.name), input.role as 'edit' | 'comment' | 'view'); list = [...list, made]; return made; },
          revoke: (id: string) => { const had = list.some((entry) => entry.id === id); list = list.filter((entry) => entry.id !== id); return had; },
        },
        setPublicOrigin: () => {}, people: async () => [{ name: 'Ana', color: '#3972dc' }], stop: async () => {},
      };
    };
    const make = (selected: string | null = '/repo') => {
      const started: string[] = [];
      const share = createShare({
        start: async ({ root }) => { started.push(root); return host(); }, freePort: async () => 8790,
        audit: () => ({ hashIp: () => 'unknown', record: () => {}, flush: async () => {}, recent: async () => [{ t: '2026-10-03T12:00:00.000Z', type: 'join', invite: 'Ana', role: 'view' }] }),
        tunnel: async () => ({ url: 'https://demo-demo.trycloudflare.com', stop: async () => {} }),
      });
      const app = createApp({ share, selectedRepo: { get: () => selected, set: async () => {} } });
      return { app, started };
    };

    it('reports no sharing, shares the connected repository and stops', async () => {
      const { app, started } = make();
      expect(await (await app.request('/api/share')).json()).toEqual({ active: false });
      const response = await post(app, '/api/share/start', { dir: '/repo' });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ active: true, root: '/repo', people: [{ name: 'Ana', color: '#3972dc' }], tunnel: { active: false }, invites: [{ name: 'Link para editar', role: 'edit' }, { name: 'Link só para ver', role: 'view' }] });
      expect(started).toEqual(['/repo']);
      expect(await (await app.request('/api/share')).json()).toMatchObject({ active: true });
      expect(await (await post(app, '/api/share/stop', {})).json()).toEqual({ active: false });
      expect(await (await app.request('/api/share')).json()).toEqual({ active: false });
    });

    it('creates and revokes invites, opens and closes public access, and lists the activity', async () => {
      const { app } = make();
      expect((await post(app, '/api/share/invites', { name: 'Ana', role: 'edit', ttl: '1h' })).status).toBe(400); // nothing shared yet
      await post(app, '/api/share/start', { dir: '/repo' });
      const created = await post(app, '/api/share/invites', { name: 'Bia', role: 'comment', ttl: '24h' });
      expect(created.status).toBe(200);
      expect((await created.json() as { invites: Array<{ name: string }> }).invites.map((entry) => entry.name)).toEqual(['Link para editar', 'Link só para ver', 'Bia']);
      const refused = await post(app, '/api/share/invites', { name: '', role: 'edit', ttl: '1h' });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toEqual({ error: 'Informe o nome do convite.' });
      const revoked = await post(app, '/api/share/invites/revoke', { id: 'n' });
      expect((await revoked.json() as { invites: unknown[] }).invites).toHaveLength(2);
      expect((await post(app, '/api/share/invites/revoke', { id: 'n' })).status).toBe(400);
      expect((await post(app, '/api/share/invites/revoke', {})).status).toBe(400);

      expect((await post(app, '/api/share/tunnel/start', { ttl: '2h' })).status).toBe(400); // not acknowledged
      const opened = await post(app, '/api/share/tunnel/start', { ttl: '2h', acknowledged: true });
      expect(await opened.json()).toMatchObject({ tunnel: { active: true, provider: 'cloudflared', url: 'https://demo-demo.trycloudflare.com' } });
      expect(await (await post(app, '/api/share/tunnel/stop', {})).json()).toMatchObject({ tunnel: { active: false } });

      const audit = await app.request('/api/share/audit');
      expect(audit.status).toBe(200);
      expect(await audit.json()).toEqual({ entries: [{ t: '2026-10-03T12:00:00.000Z', type: 'join', invite: 'Ana', role: 'view' }] });
      expect((await make(null).app.request('/api/share/audit')).status).toBe(409);
    });

    it('only shares the repository the server has connected', async () => {
      const none = make(null);
      expect((await post(none.app, '/api/share/start', { dir: '/repo' })).status).toBe(409);
      const other = make('/repo');
      expect((await post(other.app, '/api/share/start', { dir: '/outro' })).status).toBe(409);
      expect((await post(other.app, '/api/share/start', {})).status).toBe(409);
      expect(other.started).toEqual([]);
    });

    it('is local-only like the rest of /api: a foreign Host and a non-JSON POST are refused', async () => {
      const { app } = make();
      expect((await app.request('/api/share', { headers: { host: 'evil.example' } })).status).toBe(403);
      expect((await app.request('/api/share/start', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"dir":"/repo"}' })).status).toBe(415);
      for (const path of ['/api/share/invites', '/api/share/invites/revoke', '/api/share/tunnel/start', '/api/share/tunnel/stop']) {
        expect((await app.request(path, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, path).toBe(415);
        expect((await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', host: 'evil.example' }, body: '{}' })).status, path).toBe(403);
      }
      expect((await app.request('/api/share/audit', { headers: { host: 'evil.example' } })).status).toBe(403);
    });

    it('says why a share could not start', async () => {
      const app = createApp({ share: createShare({ start: async () => { throw new Error('Frontend não compilado. Rode bun run build antes de iniciar a colaboração.'); }, freePort: async () => 8790 }), selectedRepo: { get: () => '/repo', set: async () => {} } });
      const response = await post(app, '/api/share/start', { dir: '/repo' });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Frontend não compilado. Rode bun run build antes de iniciar a colaboração.' });
    });
  });
});

it('allows only one concurrent local write for the same expected file content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'joinlet-write-race-'));
  await mkdir(join(root, '.arch'));
  const storage = createFsAdapter(join(root, '.arch'));
  try {
    await writeWorkspace(storage, newWorkspace('Concurrent'));
    await storage.write('docs/concurrent.md', 'original');
    const app = createApp({ selectedRepo: { get: () => root, set: async () => {} } });
    const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => post(app, '/api/workspace', {
      dir: root, path: 'docs/concurrent.md', expected: 'original', text: `edit-${i}`,
    })));
    expect(responses.filter(r => r.status === 200)).toHaveLength(1);
    expect(responses.filter(r => r.status === 409)).toHaveLength(11);
  } finally { await rm(root, { recursive: true, force: true }); }
});
