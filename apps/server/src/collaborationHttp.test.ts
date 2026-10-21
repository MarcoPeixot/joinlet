import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyModel } from '@strukt/core';
import { printDiagramJsonSchema } from '@strukt/json';
import { createVersion, loadWorkspace, printManifest, printVersion, serializeDiagram, versionPath } from '@strukt/workspace';
import type { StorageAdapter } from '@strukt/workspace';
import { createFsAdapter } from '@strukt/workspace/fs';
import { createRemoteAdapter } from '../../web/src/workspace/remote';
import { createCollaborationHandler } from './collaborationHttp';
import { createInviteRegistry } from './invites';
import type { InviteRegistry } from './invites';

const TOKEN = 'token-de-teste';
const PORT = 48_790;
const ORIGIN = `http://192.168.0.10:${PORT}`;
const BROKEN = '{\n<<<<<<< HEAD\n  "version": 1,\n=======\n  "version": 2,\n>>>>>>> main\n}';

let root: string;
let arch: string;
let name: string;
let upgrades: Array<{ room: string; refused?: string; readOnly?: boolean }>;
let adapter: () => StorageAdapter;
let invites: InviteRegistry;

function diagram(): string {
  const model = emptyModel();
  model.elements = { API: { kind: 'node', id: 'API' } };
  model.order = ['API'];
  return serializeDiagram({ model, layout: { nodes: {}, edges: {} } }).json;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'strukt-collab-http-'));
  arch = join(root, '.arch');
  name = basename(root);
  await mkdir(join(arch, 'diagrams'), { recursive: true });
  await mkdir(join(root, 'web'), { recursive: true });
  await mkdir(join(root, 'web/app'), { recursive: true });
  await writeFile(join(root, 'web', 'index.html'), '<html><head></head></html>');
  await writeFile(join(root, 'web/app/index.html'), '<html><head></head><body>Editor</body></html>');
  await writeFile(join(arch, 'strukt.json'), printManifest({ version: 1, name: 'x', diagrams: [{ slug: 'mapa', title: 'Mapa' }], docs: [{ slug: 'notas', title: 'Notas' }], sketches: [] }));
  await writeFile(join(arch, 'diagrams', 'mapa.strukt.json'), diagram());
  upgrades = [];
  changed = [];
  invites = createInviteRegistry();
  invites.create({ name: 'Link para editar', role: 'edit', ttl: 'never', token: TOKEN });
  invites.create({ name: 'Link só para ver', role: 'view', ttl: 'never', token: VIEW });
  adapter = () => createFsAdapter(arch);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

let changed: string[] = [];
const VIEW = 'token-so-leitura';
function handler() {
  return createCollaborationHandler({
    root, archDir: arch, adapter: () => adapter(), invites, origin: ORIGIN, port: PORT, dist: join(root, 'web'),
    asset: async () => null, newId: () => 'peer', onRoomFile: (item) => changed.push(item),
  });
}

const cookie = { cookie: `strukt_collab=${TOKEN}` };
async function call(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  const request = new Request(`${ORIGIN}${path}`, { ...init, headers: { ...cookie, host: `192.168.0.10:${PORT}`, ...init.headers } });
  const upgrade = (_request: Request, data: { room: string; id: string; refused?: string; readOnly?: boolean }) => { upgrades.push(data); return true; };
  return handler()(request, upgrade);
}
const post = (body: Record<string, unknown>) => call('/api/remote/workspace', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-strukt-csrf': TOKEN }, body: JSON.stringify({ repo: name, ...body }),
});
const onDisk = (path: string) => readFile(join(arch, path), 'utf8').catch(() => null);

describe('the LAN host session', () => {
  it('maps nested documentation directory URLs to generated HTML', async () => {
    const asset = vi.fn(async (file: string) => file.endsWith('/docs/en/mcp/index.html') ? new Response('<h1>Connect agents</h1>', {headers:{'content-type':'text/html'}}) : null);
    const serve = createCollaborationHandler({root, archDir:arch, adapter:()=>adapter(), invites, origin:ORIGIN, port:PORT, dist:join(root,'web'), asset, newId:()=> 'peer'});
    for (const path of ['/docs/en/mcp', '/docs/en/mcp/', '/docs/en/mcp/index.html']) {
      const response=await serve(new Request(`${ORIGIN}${path}`,{headers:{...cookie,host:`192.168.0.10:${PORT}`}}),()=>false);
      expect(response!.status).toBe(200);
      expect(await response!.text()).toContain('Connect agents');
    }
    expect(asset).toHaveBeenCalledWith(join(root,'web/docs/en/mcp/index.html'));
  });
  it('serves the installation guide from its directory URL', async () => {
    await mkdir(join(root, 'web/setup'), { recursive: true });
    await writeFile(join(root, 'web/setup/index.html'), '<h1>Set up Joinlet</h1>');
    for (const path of ['/setup', '/setup/', '/setup/index.html']) {
      const result = await call(path);
      expect(result!.status).toBe(200);
      expect(await result!.text()).toContain('Set up Joinlet');
    }
  });
  it('opens invitations in the editor and marks its HTML as a shared session', async () => {
    const invite = await call(`/join?token=${TOKEN}`);
    expect(invite!.status).toBe(302);
    expect(invite!.headers.get('location')).toBe('/app/');
    for (const path of ['/app', '/app/', '/app/index.html']) {
      const page = await call(path);
      expect(page!.status).toBe(200);
      expect(await page!.text()).toContain('<meta name="strukt-mode" content="remote">');
    }
  });
  it('names the workspace by its folder only: never the absolute path of the host', async () => {
    const body = await (await call('/api/remote/session'))!.json() as Record<string, unknown>;
    expect(body).toEqual({ repo: name, csrf: TOKEN, mcpUrl: ORIGIN, mode: 'lan', role: 'edit', member: expect.stringMatching(/^i:[0-9a-f-]{36}$/) });
    expect(JSON.stringify(body)).not.toContain(root);
    expect((await call(`/api/remote/workspace?repo=${encodeURIComponent(name)}`))!.status).toBe(200);
    expect((await call(`/api/remote/workspace?repo=${encodeURIComponent(root)}`))!.status).toBe(401);
  });
});

describe('the read-only link', () => {
  const viewer = { cookie: `strukt_collab=${VIEW}` };
  const wsHeaders = { ...viewer, upgrade: 'websocket', origin: ORIGIN };

  it('opens with its own token and rejects a made-up one', async () => {
    const invite = await call(`/join?token=${VIEW}`, { headers: { cookie: '' } });
    expect(invite!.status).toBe(302);
    expect(invite!.headers.get('set-cookie')).toContain(`strukt_collab=${VIEW}`);
    expect((await call('/join?token=outro', { headers: { cookie: '' } }))!.status).toBe(401);
  });

  it('tells the web app the session is read-only, and never hands out the edit token or invite', async () => {
    const body = await (await call('/api/remote/session', { headers: viewer }))!.json() as Record<string, unknown>;
    expect(body).toEqual({ repo: name, csrf: VIEW, mcpUrl: ORIGIN, mode: 'lan', role: 'view', member: expect.stringMatching(/^i:[0-9a-f-]{36}$/), readOnly: true });
    expect((await call('/api/collaboration/invite', { headers: viewer }))!.status).toBe(403);
    const editor = await (await call('/api/collaboration/invite'))!.json() as { url: string };
    expect(editor.url).toContain(TOKEN);
  });

  it('reads the workspace but writes nothing, whatever it sends', async () => {
    expect((await call(`/api/remote/workspace?repo=${encodeURIComponent(name)}&path=diagrams/mapa.strukt.json`, { headers: viewer }))!.status).toBe(200);
    for (const csrf of [VIEW, TOKEN]) {
      const result = await call('/api/remote/workspace', {
        method: 'POST', headers: { ...viewer, 'content-type': 'application/json', 'x-strukt-csrf': csrf },
        body: JSON.stringify({ repo: name, path: 'docs/notas.md', text: '# invadido', expected: await onDisk('docs/notas.md') }),
      });
      expect(result!.status).toBe(403);
    }
    expect(await onDisk('docs/notas.md')).toBeNull();
  });

  it('joins the rooms flagged read-only; the editor is not', async () => {
    await call(`/api/collaboration?repo=${encodeURIComponent(name)}&kind=doc&slug=notas`, { headers: wsHeaders });
    await call(`/api/collaboration?repo=${encodeURIComponent(name)}&kind=doc&slug=notas`, { headers: { ...cookie, upgrade: 'websocket', origin: ORIGIN } });
    expect(upgrades.map((data) => data.readOnly === true)).toEqual([true, false]);
  });
});

describe('guest writes', () => {
  it('writes the workspace files a guest edits, each checked by its own parser', async () => {
    const version = createVersion({ model: emptyModel(), layout: { nodes: {}, edges: {} } }, { id: 'v1', createdAt: '2026-09-29T12:00:00.000Z', message: 'm', author: 'human' });
    const allowed: Record<string, string> = {
      'strukt.json': printManifest({ version: 1, name: 'x', diagrams: [{ slug: 'mapa', title: 'Mapa' }, { slug: 'novo', title: 'Novo' }], docs: [], sketches: [] }),
      'strukt.schema.json': printDiagramJsonSchema(),
      'board.json': '{"cards":[]}',
      'evidence.json': '{}',
      'model.json': '{}',
      'concerns.json': '{}',
      'assistants.json': '{"version":1,"assistants":[{"id":"custo","name":"Revisar custos","instruction":"Aponte custos.","scope":"workspace"}]}',
      'diagrams/novo.strukt.json': diagram(),
      'diagrams/novo.layout.json': '{"version":1,"nodes":{}}',
      'diagrams/novo.flows.json': '[]',
      'diagrams/novo.perspectives.json': '{"version":1,"perspectives":[{"id":"c4-contexto","name":"Contexto","levels":["contexto"]}]}',
      'docs/notas.md': '# Notas',
      'sketches/esboco.excalidraw': '{"elements":[]}',
      [versionPath('mapa', version)]: printVersion(version),
      'versions/mapa/index.json': '[]',
    };
    for (const [path, text] of Object.entries(allowed)) {
      const result = await post({ path, text, expected: await onDisk(path) });
      expect([path, result!.status]).toEqual([path, 200]);
      expect(await onDisk(path)).toBe(text);
    }
    const removed = await post({ path: 'diagrams/novo.flows.json', remove: true, expected: '[]' });
    expect(removed!.status).toBe(200);
    expect(await onDisk('diagrams/novo.flows.json')).toBeNull();
    const perspectives = await post({ path: 'diagrams/novo.perspectives.json', remove: true, expected: await onDisk('diagrams/novo.perspectives.json') });
    expect(perspectives!.status).toBe(200);
    expect(await onDisk('diagrams/novo.perspectives.json')).toBeNull();
  });

  it('tells the host which room\'s files a guest wrote or removed (a deleted item\'s room tells its peers right away)', async () => {
    await post({ path: 'board.json', text: '{"cards":[]}', expected: null });
    await post({ path: 'docs/notas.md', text: 'x', expected: null });
    await post({ path: 'diagrams/mapa.layout.json', text: '{"nodes":{}}', expected: null });
    await post({ path: 'diagrams/mapa.strukt.json', remove: true, expected: await onDisk('diagrams/mapa.strukt.json') });
    await post({ path: 'docs/notas.md', remove: true, expected: 'errado' }); // refused: nothing changed
    expect(changed).toEqual(['doc:notas', 'diagram:mapa', 'diagram:mapa']);
  });

  it('refuses any other path: context/, agent.json, other names, extensions and folders; nothing is written', async () => {
    const denied = [
      'context/ARCHITECTURE.md', 'context/agent.json', 'agent.json', 'hack.sh', 'diagrams/mapa.txt', 'diagrams/.x.strukt.json',
      'diagrams/a/b.strukt.json', 'docs/notas.txt', 'docs/sub/notas.md', 'versions/mapa/../../hack.json', 'versions/mapa/x/y.json',
      'versions/-x/index.json', 'sketches/a.excalidraw.js', '../fora.md', 'strukt.json.tmp', 'diagrams/__proto__.strukt.json',
      'diagrams/__proto__.perspectives.json', 'diagrams/a/b.perspectives.json', 'diagrams/mapa.perspectives.json.bak',
    ];
    for (const path of denied) {
      const result = await post({ path, text: '{}', expected: null });
      expect([path, result!.status]).toEqual([path, 403]);
    }
    const files = await adapter().list();
    expect(files.sort()).toEqual(['diagrams/mapa.strukt.json', 'strukt.json']);
    // The manifest and the schema are never removed by a guest.
    expect((await post({ path: 'strukt.json', remove: true, expected: await onDisk('strukt.json') }))!.status).toBe(403);
  });

  it('answers 422 for content its parser refuses, and writes nothing', async () => {
    const cases: Array<[string, string]> = [
      ['diagrams/mapa.strukt.json', BROKEN],
      ['diagrams/mapa.layout.json', '{nope'],
      ['diagrams/mapa.perspectives.json', '{nope'],
      ['diagrams/mapa.perspectives.json', '{"version":1,"perspectives":"x"}'],
      ['board.json', 'not json'],
      ['assistants.json', 'not json'],
      ['strukt.json', '{"version":1}'],
      ['strukt.schema.json', '{}'],
      ['sketches/esboco.excalidraw', '<svg/>'],
      ['versions/mapa/index.json', '{}'],
      ['versions/mapa/20260929T120000000Z-v1.json', '{"id":"v2","createdAt":"2026-09-29T12:00:00.000Z","json":"{}"}'],
    ];
    for (const [path, text] of cases) {
      const before = await onDisk(path);
      const result = await post({ path, text, expected: before });
      expect([path, result!.status]).toEqual([path, 422]);
      expect(typeof (await result!.json() as { error: unknown }).error).toBe('string');
      expect(await onDisk(path)).toBe(before);
    }
  });

  it('requires `expected` on every write and refuses a stale one', async () => {
    expect((await post({ path: 'docs/notas.md', text: 'sem expected' }))!.status).toBe(428);
    expect(await onDisk('docs/notas.md')).toBeNull();
    expect((await post({ path: 'diagrams/mapa.strukt.json', text: diagram(), expected: null }))!.status).toBe(409);
    expect((await post({ path: 'docs/notas.md', text: 'um', expected: null }))!.status).toBe(200);
    expect((await post({ path: 'docs/notas.md', text: 'dois', expected: 'outro' }))!.status).toBe(409);
    expect(await onDisk('docs/notas.md')).toBe('um');
  });

  it('refuses a body past 1 MB while it streams, chunked (no Content-Length) or declared', async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode('x'.repeat(64 * 1024));
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (pulled === 1) controller.enqueue(new TextEncoder().encode(`{"repo":${JSON.stringify(name)},"path":"docs/notas.md","expected":null,"text":"`));
        else if (pulled < 200) controller.enqueue(chunk);
        else { controller.enqueue(new TextEncoder().encode('"}')); controller.close(); }
      },
    });
    const chunked = await call('/api/remote/workspace', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-strukt-csrf': TOKEN }, body, duplex: 'half',
    } as RequestInit & { headers: Record<string, string>; duplex: 'half' });
    expect(chunked!.status).toBe(413);
    expect(pulled).toBeLessThan(40);
    expect(await onDisk('docs/notas.md')).toBeNull();
    const declared = await call('/api/remote/workspace', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-strukt-csrf': TOKEN, 'content-length': '5000000' }, body: '{}',
    });
    expect(declared!.status).toBe(413);
  });
});

describe('collaboration rooms (WebSocket)', () => {
  const join = (kind: string, slug: string, headers: Record<string, string> = { origin: ORIGIN }) =>
    call(`/api/collaboration?repo=${encodeURIComponent(name)}&kind=${kind}&slug=${encodeURIComponent(slug)}`, { headers: { upgrade: 'websocket', ...headers } });

  it('opens rooms only for the items the manifest lists', async () => {
    expect(await join('diagram', 'mapa')).toBeUndefined();
    expect(await join('doc', 'notas')).toBeUndefined();
    expect(upgrades.map((data) => JSON.parse(data.room)[1])).toEqual(['diagram:mapa', 'doc:notas']);
    // Any other item: the socket opens only to be closed (4404, see collaborationHost), never with a room.
    for (const [kind, slug] of [['diagram', 'fantasma'], ['doc', 'mapa'], ['diagram', 'notas'], ['sketch', 'mapa'], ['diagram', '__proto__'], ['diagram', '../x']]) {
      expect(await join(kind!, slug!), `${kind}:${slug}`).toBeUndefined();
    }
    expect(upgrades).toHaveLength(8);
    expect(upgrades.slice(2).every((data) => data.room === '' && typeof data.refused === 'string')).toBe(true);
    expect(await adapter().list()).toEqual(['diagrams/mapa.strukt.json', 'strukt.json']);
  });

  it('takes a loopback alias of the origin only when both Origin and Host are loopback names, same port', async () => {
    for (const alias of ['localhost', '127.0.0.1', '[::1]']) {
      expect(await join('diagram', 'mapa', { origin: `http://${alias}:${PORT}`, host: `${alias}:${PORT}` }), alias).toBeUndefined();
    }
    const refused: Array<Record<string, string>> = [
      { origin: `http://localhost:${PORT}`, host: `192.168.0.10:${PORT}` },
      { origin: `http://localhost:${PORT + 1}`, host: `localhost:${PORT + 1}` },
      { origin: `http://localhost:${PORT}`, host: `localhost:${PORT + 1}` },
      { origin: `https://localhost:${PORT}`, host: `localhost:${PORT}` },
      { origin: `http://evil.test:${PORT}`, host: `localhost:${PORT}` },
      { origin: `http://localhost.evil.test:${PORT}`, host: `localhost:${PORT}` },
      { origin: 'null', host: `localhost:${PORT}` },
    ];
    for (const headers of refused) expect((await join('diagram', 'mapa', headers))!.status, JSON.stringify(headers)).toBe(403);
    expect(upgrades).toHaveLength(3);
  });
});

describe('errors', () => {
  it('answers a malformed URL with a plain 400 and a thrown error with a plain 500: no stack, no host path', async () => {
    const malformed = await call('/%E0%A4%A');
    expect(malformed!.status).toBe(400);
    expect(await malformed!.json()).toEqual({ error: 'Caminho inválido.' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    adapter = () => { throw new Error(`EACCES: permission denied, open '${arch}/strukt.json'`); };
    const failed = await call(`/api/remote/revision?repo=${encodeURIComponent(name)}`);
    expect(failed!.status).toBe(500);
    const text = await failed!.text();
    expect(JSON.parse(text)).toEqual({ error: 'Erro interno.' });
    expect(text).not.toContain(root);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('a guest opening a workspace whose diagram file has merge markers', () => {
  it('opens it (the host already backed the file up), with the warning and what could be read', async () => {
    await writeFile(join(arch, 'diagrams', 'mapa.strukt.json'), BROKEN);
    // The host's own open writes the backup first (openWorkspaceAt).
    await loadWorkspace(createFsAdapter(arch));
    const backup = await stat(join(arch, 'diagrams', 'mapa.strukt.json.bak'));
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) => call(input, init as RequestInit & { headers?: Record<string, string> }));
    const session = await (await call('/api/remote/session'))!.json() as { repo: string; csrf: string; mcpUrl: string; mode: 'lan' };
    const loaded = await loadWorkspace(createRemoteAdapter(session));
    expect(loaded!.data.diagrams.mapa!.model.order).toEqual([]);
    expect(loaded!.warnings[0]).toContain('o original foi copiado para diagrams/mapa.strukt.json.bak');
    expect(await onDisk('diagrams/mapa.strukt.json')).toBe(BROKEN);
    expect(await onDisk('diagrams/mapa.strukt.json.bak')).toBe(BROKEN);
    expect((await stat(join(arch, 'diagrams', 'mapa.strukt.json.bak'))).mtimeMs).toBe(backup.mtimeMs);
    // Without the host's backup, the guest's copy of the file as it is now is accepted, and only that.
    await rm(join(arch, 'diagrams', 'mapa.strukt.json.bak'));
    expect((await post({ path: 'diagrams/mapa.strukt.json.bak', text: 'outra coisa', expected: null }))!.status).toBe(422);
    const again = await loadWorkspace(createRemoteAdapter(session));
    expect(again!.warnings[0]).toContain('o original foi copiado para');
    expect(await onDisk('diagrams/mapa.strukt.json.bak')).toBe(BROKEN);
  });

  it('a guest may write the backup only of a file with errors, and never replace a different backup', async () => {
    const bak = 'diagrams/mapa.strukt.json.bak';
    const valid = (await onDisk('diagrams/mapa.strukt.json'))!;
    // The backup of the broken original; the diagram was fixed since. A copy of the valid file must not replace it.
    await writeFile(join(arch, bak), BROKEN);
    expect((await post({ path: bak, text: valid, expected: BROKEN }))!.status).toBe(422);
    expect(await onDisk(bak)).toBe(BROKEN);
    await rm(join(arch, bak));
    expect((await post({ path: bak, text: valid, expected: null }))!.status).toBe(422);
    expect(await onDisk(bak)).toBeNull();
    // A file with errors: its backup is written once, the same text again is fine, another text never replaces it.
    await writeFile(join(arch, 'diagrams', 'mapa.strukt.json'), BROKEN);
    expect((await post({ path: bak, text: BROKEN, expected: null }))!.status).toBe(200);
    expect((await post({ path: bak, text: BROKEN, expected: BROKEN }))!.status).toBe(200);
    await writeFile(join(arch, 'diagrams', 'mapa.strukt.json'), `${BROKEN}\n<<<<<<< outro`);
    expect((await post({ path: bak, text: `${BROKEN}\n<<<<<<< outro`, expected: BROKEN }))!.status).toBe(422);
    expect(await onDisk(bak)).toBe(BROKEN);
  });
});
