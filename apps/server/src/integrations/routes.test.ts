import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fakeRunner } from '@strukt/git/testing';
import { newWorkspace } from '@strukt/workspace';
import { createFsAdapter, writeWorkspace } from '@strukt/workspace/fs';
import { afterEach, describe, expect, it } from 'vitest';
import { setupAgents } from '../agentSetup';
import { createApp } from '../app';
import { createIntegrations } from './index';
import { fakeFetch, json } from './testing';
import type { Handler } from './testing';

const SLACK = 'https://hooks.slack.com/services/T000/B000/XXXXXXXXabcd';
const NOTION_TOKEN = 'ntn_supersecret9876';

const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

async function setup(handler: Handler = () => new Response(null, { status: 204 }), extra: Partial<Parameters<typeof createApp>[0]> = {}) {
  const files = new Map<string, string>();
  const net = fakeFetch(handler);
  const integrations = createIntegrations({ file: '/cfg/integrations.json', fs: { read: async (p) => files.get(p) ?? null, write: async (p, t) => void files.set(p, t) }, fetch: net.fetch });
  await integrations.load();
  const app = createApp({ integrations, ...extra });
  return { app, net, files, integrations };
}

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('/api/integrations', () => {
  it('saves credentials and never gives them back', async () => {
    const { app, files } = await setup();
    const saved = await post(app, '/api/integrations', { notion: { token: NOTION_TOKEN, parentPageId: 'a'.repeat(32) }, webhooks: { slack: { url: SLACK } } });
    expect(saved.status).toBe(200);
    const view = await (await app.request('/api/integrations')).json();
    const everything = JSON.stringify([view, await (await post(app, '/api/integrations', { notion: { parentPageId: 'b'.repeat(32) } })).json()]);
    expect(everything).not.toContain('supersecret');
    expect(everything).not.toContain('XXXXXXXX');
    expect(view.notion).toMatchObject({ configured: true, hint: '…9876' });
    expect(files.get('/cfg/integrations.json')).toContain(NOTION_TOKEN);
  });

  it('answers 400 with a pt-BR reason for an invalid or hostile patch', async () => {
    const { app, files } = await setup();
    for (const body of [{ webhooks: { slack: { url: 'https://evil.com/services/T/B/X' } } }, { atlassian: { site: 'evil.com', email: 'a@b.co', token: 't' } }, { nope: 1 }, '[]', 'not json']) {
      const res = await post(app, '/api/integrations', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(typeof (await res.json()).error).toBe('string');
    }
    expect(files.size).toBe(0);
  });

  it('is loopback-only and JSON-only like every /api route', async () => {
    const { app } = await setup();
    expect((await app.request('http://evil.example/api/integrations')).status).toBe(403);
    expect((await app.request('http://evil.example/api/integrations/notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
    expect((await app.request('/api/integrations', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415);
  });

  it('bounds the body: 1 MB everywhere, 5 MB to publish (a diagram SVG rides along)', async () => {
    const { app } = await setup();
    expect((await post(app, '/api/integrations', { notion: { token: 'x'.repeat(1_100_000) } })).status).toBe(413);
    expect((await post(app, '/api/integrations/publish', { target: 'notion', title: 'T', markdown: 'x'.repeat(1_100_000) })).status).toBe(400);
    expect((await post(app, '/api/integrations/publish', { target: 'notion', title: 'T', markdown: 'x'.repeat(5_300_000) })).status).toBe(413);
  });

  it('tests a webhook and refuses an unknown target', async () => {
    const { app, net } = await setup();
    await post(app, '/api/integrations', { webhooks: { slack: { url: SLACK } } });
    expect(await (await post(app, '/api/integrations/test', { target: 'slack' })).json()).toEqual({ ok: true, detail: expect.stringMatching(/Slack/) });
    expect(net.calls).toHaveLength(1);
    expect((await post(app, '/api/integrations/test', { target: 'whatsapp' })).status).toBe(400);
    expect(await (await post(app, '/api/integrations/test', { target: 'teams' })).json()).toEqual({ ok: false, detail: expect.stringMatching(/configure/i) });
  });

  it('relays an event from the app to the subscribed webhooks', async () => {
    const { app, net } = await setup();
    await post(app, '/api/integrations', { webhooks: { slack: { url: SLACK, events: ['version'] } } });
    const sent = await post(app, '/api/integrations/notify', { event: 'version', diagram: 'checkout', message: 'Adiciona fila', author: 'ai' });
    expect(await sent.json()).toEqual({ sent: 1, failed: 0 });
    expect(String((net.calls[0]!.json as { text: string }).text)).toContain('checkout');
    expect(await (await post(app, '/api/integrations/notify', { event: 'pr', title: 'T', url: 'https://github.com/a/b/pull/1' })).json()).toEqual({ sent: 0, failed: 0 });
    expect((await post(app, '/api/integrations/notify', { event: 'test' })).status).toBe(400);
  });

  it('publishes a doc to Notion and reports warnings', async () => {
    const { app, net } = await setup((call) => (new URL(call.url).pathname === '/v1/pages' ? json({ id: '11111111-2222-3333-4444-555555555555', url: 'https://www.notion.so/x' }) : json({})));
    expect((await post(app, '/api/integrations/publish', { target: 'notion', title: 'T', markdown: '# x' })).status).toBe(400);
    await post(app, '/api/integrations', { notion: { token: NOTION_TOKEN, parentPageId: 'a'.repeat(32) } });
    const res = await post(app, '/api/integrations/publish', { target: 'notion', title: 'Pagamentos', markdown: '# x', svg: '<svg onload="x"/>' });
    expect(res.status).toBe(400);
    const done = await post(app, '/api/integrations/publish', { target: 'notion', title: 'Pagamentos', markdown: '# x' });
    expect(await done.json()).toEqual({ ok: true, url: 'https://www.notion.so/x', warnings: [] });
    expect(net.calls.at(-1)!.headers.authorization).toBe(`Bearer ${NOTION_TOKEN}`);
  });

  it('maps a service failure to 502 with a pt-BR message and no token', async () => {
    const { app } = await setup(() => json({ message: `denied ${NOTION_TOKEN}` }, 401));
    await post(app, '/api/integrations', { notion: { token: NOTION_TOKEN, parentPageId: 'a'.repeat(32) } });
    const res = await post(app, '/api/integrations/publish', { target: 'notion', title: 'T', markdown: 'x' });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/token/i);
    expect(JSON.stringify(body)).not.toContain(NOTION_TOKEN);
  });

  it('creates a Jira task from a concern', async () => {
    const { app } = await setup(() => json({ key: 'ENG-7' }, 201));
    await post(app, '/api/integrations', { atlassian: { site: 'acme', email: 'a@b.co', token: 'tok123' }, jira: { projectKey: 'ENG', issueType: 'Task' } });
    const res = await post(app, '/api/integrations/jira', { concern: { id: 'c1', diagram: 'checkout', element: 'API', message: 'A fila não aparece.' }, diagramTitle: 'Checkout' });
    expect(await res.json()).toEqual({ ok: true, key: 'ENG-7', url: 'https://acme.atlassian.net/browse/ENG-7' });
    expect((await post(app, '/api/integrations/jira', { concern: { id: '../x', diagram: 'd', message: 'm' } })).status).toBe(400);
  });

  it('is absent when the server was built without integrations', async () => {
    expect((await createApp({}).request('/api/integrations')).status).toBe(404);
  });
});

describe('events raised by the server itself', () => {
  async function repo(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'strukt-integrations-'));
    dirs.push(root);
    const files: Record<string, string> = {
      'strukt.json': `${JSON.stringify({ version: 1, name: 'Loja', diagrams: [{ slug: 'a', title: 'A' }], docs: [], sketches: [] }, null, 2)}\n`,
      'diagrams/a.strukt.json': `${JSON.stringify({ version: 1, nodes: [{ id: 'API' }], connections: [] })}\n`,
      'evidence.json': JSON.stringify({ a: { API: [{ path: 'src/missing.ts' }] } }),
    };
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, '.arch', path)), { recursive: true });
      await writeFile(join(root, '.arch', path), text);
    }
    return root;
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

  it('tells the webhooks when a PR is published', async () => {
    const dir = await repo();
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
    const runner = fakeRunner({
      files: { main: { 'strukt.json': '{"version":1,"name":"Loja","diagrams":[],"docs":[],"sketches":[]}\n' } },
      responses: [
        { when: (cmd, args) => cmd === 'git' && args[0] === 'rev-parse' && args.includes('--is-inside-work-tree'), result: ok('true\n') },
        { when: (cmd, args) => cmd === 'git' && args[0] === 'rev-parse', result: { code: 128, stdout: '', stderr: 'no' } },
        { when: (cmd, args) => cmd === 'git' && args[0] === 'status', result: ok(' M .arch/diagrams/a.strukt.json\n') },
        { when: (cmd, args) => cmd === 'gh' && args[0] === 'auth', result: ok('ok') },
        { when: (cmd, args) => cmd === 'gh' && args[0] === 'repo', result: ok('main\n') },
        { when: (cmd, args) => cmd === 'gh' && args[0] === 'pr', result: ok('https://github.com/x/y/pull/3\n') },
        { when: () => true, result: ok() },
      ],
    });
    const { app, net } = await setup(undefined, { runner });
    await post(app, '/api/integrations', { webhooks: { slack: { url: SLACK } } });
    const res = await post(app, '/api/git/publish', { dir, title: 'Cache' });
    expect(res.status).toBe(200);
    await flush();
    const text = String((net.calls[0]!.json as { text: string }).text);
    expect(text).toContain('https://github.com/x/y/pull/3');
    expect(text).toContain('Cache');
  });

  it('does not notify when the publish fails', async () => {
    const dir = await repo();
    const runner = fakeRunner({ responses: [{ when: () => true, result: { code: 1, stdout: '', stderr: 'no' } }] });
    const { app, net } = await setup(undefined, { runner });
    await post(app, '/api/integrations', { webhooks: { slack: { url: SLACK } } });
    expect((await post(app, '/api/git/publish', { dir, title: 'Cache' })).status).toBe(400);
    await flush();
    expect(net.calls).toHaveLength(0);
  });

  it('reports drift found by the health check once, not on every poll', async () => {
    const dir = await repo();
    const { app, net } = await setup();
    await post(app, '/api/integrations', { webhooks: { discord: { url: 'https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-JKLmno1234', events: ['drift'] } } });
    for (let i = 0; i < 3; i++) expect((await post(app, '/api/git/health', { dir })).status).toBe(200);
    await flush();
    expect(net.calls).toHaveLength(1);
    expect(String((net.calls[0]!.json as { content: string }).content)).toContain('a › API');
  });

  it('tells the webhooks when an agent saves a version over MCP', async () => {
    const root = await mkdtemp(join(tmpdir(), 'strukt-integrations-mcp-'));
    dirs.push(root);
    const arch = join(root, '.arch');
    await mkdir(arch);
    await writeWorkspace(createFsAdapter(arch), newWorkspace('Loja'));
    const agent = await setupAgents(root);
    const { app, net } = await setup(undefined, { selectedRepo: { get: () => root, set: async () => {} } });
    await post(app, '/api/integrations', { webhooks: { slack: { url: SLACK, events: ['version'] } } });
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:8787/mcp/${agent.id}`), { fetch: async (input, init) => app.fetch(new Request(input, init)) }));
    try {
      const created = await client.callTool({ name: 'create_diagram', arguments: { title: 'Checkout', json: '{"version":1,"nodes":[{"id":"API"}],"connections":[]}' } });
      expect(created.isError).not.toBe(true);
      const slug = 'checkout';
      const saved = await client.callTool({ name: 'save_version', arguments: { diagram: slug, message: 'Revisão do agente' } });
      expect(saved.isError).not.toBe(true);
      await flush();
      expect(net.calls).toHaveLength(1);
      expect(String((net.calls[0]!.json as { text: string }).text)).toContain('Revisão do agente');
      expect(String((net.calls[0]!.json as { text: string }).text)).toMatch(/agente/);
    } finally {
      await client.close();
    }
  });
});
