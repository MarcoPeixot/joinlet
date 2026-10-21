import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile, realpath } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The real stack: the owner's routes plus a real collaboration host (Bun.serve, bun:sqlite), spawned under Bun.
const hasBun = spawnSync('bun', ['--version']).status === 0;

const freePort = () => new Promise<number>((done) => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close(() => done(typeof address === 'object' && address ? address.port : 0));
  });
});

let child: ChildProcess | null = null;
let dir = '';
afterEach(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
  child = null;
  if (dir) await rm(dir, { recursive: true, force: true });
});

interface Invite { id: string; name: string; role: string; url: string; publicUrl: string | null; expiresAt: number | null }
interface Status { active: boolean; invites: Invite[]; tunnel: { active: boolean; url?: string }; people: unknown[] }

async function startStack() {
  dir = await mkdtemp(join(tmpdir(), 'strukt-stack-'));
  const root = join(dir, 'repo');
  const arch = join(root, '.arch');
  await mkdir(join(arch, 'docs'), { recursive: true });
  await mkdir(join(arch, 'diagrams'), { recursive: true });
  await mkdir(join(dir, 'dist/app'), { recursive: true });
  await writeFile(join(dir, 'dist', 'index.html'), '<html><head></head></html>');
  await writeFile(join(dir, 'dist/app/index.html'), '<html><head></head></html>');
  await writeFile(join(arch, 'strukt.json'), JSON.stringify({ version: 1, name: 'x', diagrams: [], docs: [{ slug: 'notas', title: 'Notas' }], sketches: [] }));
  await writeFile(join(arch, 'docs', 'notas.md'), 'Olá');
  const [ownerPort, collabPort, clockPort] = [await freePort(), await freePort(), await freePort()];
  const config = join(dir, 'config');
  const log: string[] = [];
  child = spawn('bun', ['src/shareStack.ts'], {
    cwd: resolve(import.meta.dirname, '..'),
    env: {
      ...process.env, STRUKT_STACK_ROOT: root, STRUKT_STACK_OWNER_PORT: String(ownerPort), STRUKT_STACK_COLLAB_PORT: String(collabPort),
      STRUKT_STACK_CLOCK_PORT: String(clockPort), STRUKT_STACK_DIST: join(dir, 'dist'), STRUKT_STACK_CONFIG: config,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout!.on('data', (chunk) => log.push(String(chunk)));
  child.stderr!.on('data', (chunk) => log.push(String(chunk)));
  for (let i = 0; i < 150 && !log.join('').includes('stack-ready'); i++) await new Promise((r) => setTimeout(r, 100));
  expect(log.join('')).toContain('stack-ready');

  const owner = `http://127.0.0.1:${ownerPort}`;
  const collab = `http://127.0.0.1:${collabPort}`;
  const api = async <T = unknown>(path: string, body?: unknown): Promise<{ status: number; body: T }> => {
    const response = await fetch(`${owner}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as T };
  };
  const advance = async (ms: number) => { await fetch(`http://127.0.0.1:${clockPort}/advance?ms=${ms}`, { method: 'POST' }); };
  const tokenOf = (invite: Invite) => new URL(invite.url).searchParams.get('token')!;
  const repo = basename(root);
  /** A guest socket on the notes room; resolves with how it ended and when it opened. */
  const socketFor = (token: string, origin = collab) => {
    const socket = new WebSocket(`ws://127.0.0.1:${collabPort}/api/collaboration?repo=${encodeURIComponent(repo)}&kind=doc&slug=notas`, { headers: { cookie: `strukt_collab=${token}`, origin } } as never);
    socket.binaryType = 'arraybuffer';
    const opened = new Promise<boolean>((done) => { socket.onopen = () => done(true); socket.addEventListener('error', () => done(false)); });
    const closed = new Promise<number>((done) => { socket.onclose = (event) => done(event.code); });
    return { socket, opened, closed };
  };
  /** A request with a Host header of our choosing (what cloudflared forwards), which `fetch` will not let us set. */
  const raw = (path: string, headers: Record<string, string>) => new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((done, fail) => {
    const req = httpRequest({ host: '127.0.0.1', port: collabPort, path, headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => done({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on('error', fail);
    req.end();
  });
  return { owner, collab, api, advance, tokenOf, socketFor, raw, repo, config, log };
}

describe.skipIf(!hasBun)('the real share stack', () => {
  let stack: Awaited<ReturnType<typeof startStack>>;
  beforeEach(async () => {
    stack = await startStack();
    expect((await stack.api('/api/share/start', { dir: join(dir, 'repo') })).status).toBe(200);
  });

  it('the owner relay is local-only, hides its credential from invites and rejects unrelated endpoints', async () => {
    const session = await stack.api<{ repo: string; csrf: string }>('/api/share/live/remote/session');
    expect(session.status).toBe(200);
    expect(session.body.repo).toBe(stack.repo);
    const status = await stack.api<Status>('/api/share');
    expect(status.body.invites).toHaveLength(2);
    expect(status.body.invites.every(invite => !invite.url.includes(session.body.csrf))).toBe(true);
    expect((await stack.api('/api/share/live/settings')).status).toBe(409);
    const denied = await fetch(`${stack.owner}/api/share/live/remote/session`, { headers: { origin: 'https://other.example', 'sec-fetch-site': 'cross-site' } });
    expect(denied.status).toBe(403);
    const written = await stack.api('/api/share/live/remote/workspace', { repo: stack.repo, path: 'docs/notas.md', text: 'Owner edit', expected: 'Olá' });
    expect(written.status).toBe(200);
    expect(await readFile(join(dir, 'repo/.arch/docs/notas.md'), 'utf8')).toBe('Owner edit');
  });

  it('prepares a browser workspace without a repository path, preserving its files and refusing traversal', async () => {
    await stack.api('/api/share/stop', {});
    const files = { 'strukt.json': JSON.stringify({ version: 1, name: 'Browser project', diagrams: [], docs: [{ slug: 'notes', title: 'Notes' }], sketches: [] }), 'docs/notes.md': 'From the browser' };
    const bad = await stack.api('/api/share/prepare', { files: { ...files, '../escape.txt': 'no' } });
    expect(bad.status).toBe(400);
    const prepared = await stack.api<Status & { root: string }>('/api/share/prepare', { files });
    expect(prepared.status).toBe(200);
    expect(prepared.body.root.startsWith(await realpath(join(stack.config, 'shared-workspaces')))).toBe(true);
    expect(await readFile(join(prepared.body.root, '.arch/docs/notes.md'), 'utf8')).toBe('From the browser');
    expect((await stat(join(prepared.body.root, '.git'))).isDirectory()).toBe(true);
    const again = await stack.api('/api/share/prepare', { dir: prepared.body.root });
    expect(again.status).toBe(200);
    expect((await stack.api('/api/share/prepare', { files })).status).toBe(409);
  });

  it('revoking an invite drops its open socket (4403) and ends its REST access, while other invites keep working', async () => {
    const created = (await stack.api<Status>('/api/share/invites', { name: 'Ana', role: 'edit', ttl: '24h' })).body;
    const ana = created.invites.find((invite) => invite.name === 'Ana')!;
    const other = created.invites.find((invite) => invite.name === 'Link para editar')!;
    const live = stack.socketFor(stack.tokenOf(ana));
    const bystander = stack.socketFor(stack.tokenOf(other));
    expect(await live.opened).toBe(true);
    expect(await bystander.opened).toBe(true);
    const session = await fetch(`${stack.collab}/api/remote/session`, { headers: { cookie: `strukt_collab=${stack.tokenOf(ana)}` } });
    expect(session.status).toBe(200);
    expect((await stack.api('/api/share/invites/revoke', { id: ana.id })).status).toBe(200);
    expect(await live.closed).toBe(4403);
    const after = await fetch(`${stack.collab}/api/remote/session`, { headers: { cookie: `strukt_collab=${stack.tokenOf(ana)}` } });
    expect(after.status).toBe(401);
    expect(await after.json()).toMatchObject({ code: 'invite_ended' });
    expect((await fetch(`${stack.collab}/join?token=${stack.tokenOf(ana)}`, { redirect: 'manual' })).status).toBe(401);
    expect((await fetch(`${stack.collab}/api/remote/session`, { headers: { cookie: `strukt_collab=${stack.tokenOf(other)}` } })).status).toBe(200);
    bystander.socket.close();
  });

  it('an invite that expires takes its open socket with it, on the clock', async () => {
    const created = (await stack.api<Status>('/api/share/invites', { name: 'Bia', role: 'view', ttl: '1h' })).body;
    const bia = created.invites.find((invite) => invite.name === 'Bia')!;
    const live = stack.socketFor(stack.tokenOf(bia));
    expect(await live.opened).toBe(true);
    await stack.advance(3_600_000 + 1_000);
    expect(await live.closed).toBe(4403);
    const after = await fetch(`${stack.collab}/api/remote/session`, { headers: { cookie: `strukt_collab=${stack.tokenOf(bia)}` } });
    expect(after.status).toBe(401);
    expect(await after.json()).toMatchObject({ code: 'invite_ended' });
    const status = (await stack.api<Status>('/api/share')).body;
    expect(status.invites.map((invite) => invite.name)).toEqual(['Link para editar', 'Link só para ver']);
  });

  it('caps invalid-token attempts per address with a 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await fetch(`${stack.collab}/join?token=chute-${i}-chute-chute-chute-chute-chute`, { redirect: 'manual' })).status);
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses.slice(10)).toEqual([429, 429]);
    const status = (await stack.api<Status>('/api/share')).body;
    // Valid invitations still work behind the same NAT; only invalid attempts are throttled.
    expect((await fetch(`${stack.collab}/join?token=${stack.tokenOf(status.invites[0]!)}`, { redirect: 'manual' })).status).toBe(302);
    expect((await fetch(`${stack.collab}/join?token=another-invalid-token`, { redirect: 'manual' })).status).toBe(429);
    await stack.advance(11 * 60_000);
    expect((await fetch(`${stack.collab}/join?token=${stack.tokenOf(status.invites[0]!)}`, { redirect: 'manual' })).status).toBe(302);
  });

  it('public access: acknowledged and timed, links and cookies follow the tunnel\'s address, and only while it is on', async () => {
    expect((await stack.api('/api/share/tunnel/start', { ttl: '2h' })).status).toBe(400);
    const before = (await stack.api<Status>('/api/share')).body;
    const edit = before.invites[0]!;
    const refused = stack.socketFor(stack.tokenOf(edit), 'https://e2e-demo.trycloudflare.com');
    expect(await refused.opened).toBe(false);

    const on = (await stack.api<Status>('/api/share/tunnel/start', { ttl: '30m', acknowledged: true })).body;
    expect(on.tunnel).toMatchObject({ active: true, url: 'https://e2e-demo.trycloudflare.com' });
    expect(on.invites[0]!.publicUrl).toBe(`https://e2e-demo.trycloudflare.com/join?token=${stack.tokenOf(edit)}`);
    const viaTunnel = await stack.raw(`/join?token=${stack.tokenOf(edit)}`, { host: 'e2e-demo.trycloudflare.com' });
    expect(viaTunnel.status).toBe(302);
    expect(String(viaTunnel.headers['set-cookie'])).toContain('Secure');
    const viaLan = await stack.raw(`/join?token=${stack.tokenOf(edit)}`, { host: `127.0.0.1:${new URL(stack.collab).port}` });
    expect(String(viaLan.headers['set-cookie'])).not.toContain('Secure');
    const ws = stack.socketFor(stack.tokenOf(edit), 'https://e2e-demo.trycloudflare.com');
    expect(await ws.opened).toBe(true);
    ws.socket.close();

    const off = (await stack.api<Status>('/api/share/tunnel/stop', {})).body;
    expect(off.tunnel.active).toBe(false);
    expect(off.invites[0]!.publicUrl).toBeNull();
    expect(await stack.socketFor(stack.tokenOf(edit), 'https://e2e-demo.trycloudflare.com').opened).toBe(false);
  });

  it('audits who joined, what they wrote and what was refused, with no content, no token, no address', async () => {
    const created = (await stack.api<Status>('/api/share/invites', { name: 'Caio', role: 'edit', ttl: 'never' })).body;
    const caio = created.invites.find((invite) => invite.name === 'Caio')!;
    const token = stack.tokenOf(caio);
    expect((await fetch(`${stack.collab}/join?token=${token}`, { redirect: 'manual' })).status).toBe(302);
    const secret = '# conteudo-secreto-do-doc';
    const write = await fetch(`${stack.collab}/api/remote/workspace`, {
      method: 'POST', headers: { cookie: `strukt_collab=${token}`, 'content-type': 'application/json', 'x-strukt-csrf': token },
      body: JSON.stringify({ repo: stack.repo, path: 'docs/notas.md', text: secret, expected: 'Olá' }),
    });
    expect(write.status).toBe(200);
    await fetch(`${stack.collab}/join?token=token-inventado-token-inventado-token-0`, { redirect: 'manual' });
    await stack.api('/api/share/invites/revoke', { id: caio.id });
    const entries = (await stack.api<{ entries: Array<Record<string, unknown>> }>('/api/share/audit')).body.entries;
    const types = entries.map((entry) => entry.type);
    for (const type of ['share.start', 'invite.create', 'join', 'write', 'denied', 'invite.revoke']) expect(types, type).toContain(type);
    expect(entries.find((entry) => entry.type === 'write')).toMatchObject({ invite: 'Caio', path: 'docs/notas.md', op: 'write', role: 'edit' });
    expect(entries[0]!.type).toBe('invite.revoke'); // newest first
    const files = await readdir(join(stack.config, 'audit'));
    expect(files).toHaveLength(1);
    const file = join(stack.config, 'audit', files[0]!);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const raw = await readFile(file, 'utf8');
    const everyToken = [...created.invites, ...(await stack.api<Status>('/api/share')).body.invites].map((invite) => stack.tokenOf(invite));
    for (const secretText of [secret, 'token-inventado', '127.0.0.1', ...everyToken]) expect(raw).not.toContain(secretText);
    expect(stack.log.join('')).not.toContain(token);
  });
});
