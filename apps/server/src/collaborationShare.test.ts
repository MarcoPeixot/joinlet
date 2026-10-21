import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyModel } from '@strukt/core';
import { ADMIN_PLAN, BETA_PLAN, type AccessPlan, printManifest, serializeDiagram } from '@strukt/workspace';
import type { StorageAdapter } from '@strukt/workspace';
import { createFsAdapter } from '@strukt/workspace/fs';
import type { AuditEvent, AuditLog } from './audit';
import { createCollaborationHandler } from './collaborationHttp';
import type { RequestInfo } from './collaborationHttp';
import { createFailureLimiter } from './failureLimiter';
import { INVITE_TTLS, createInviteRegistry } from './invites';

const PORT = 48_791;
const ORIGIN = `http://192.168.0.10:${PORT}`;
const PUBLIC = 'https://quick-demo.trycloudflare.com';
const EDIT = 'edit-token-edit-token-edit-token-edit-0001';

let root: string;
let arch: string;
let name: string;
let time: number;
let publicOrigin: string | null;
let events: AuditEvent[];
let upgrades: Array<Record<string, unknown>>;
let invites = createInviteRegistry();
let adapterOverride: (() => StorageAdapter) | null = null;

const audit: AuditLog = { hashIp: (ip) => (ip ? `h${ip.length}`.padEnd(8, '0') : 'unknown'), record: (event) => { events.push(event); }, flush: async () => {}, recent: async () => [] };

function diagram(): string {
  const model = emptyModel();
  model.elements = { API: { kind: 'node', id: 'API' } };
  model.order = ['API'];
  return serializeDiagram({ model, layout: { nodes: {}, edges: {} } }).json;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'strukt-share-http-'));
  arch = join(root, '.arch');
  name = basename(root);
  await mkdir(join(arch, 'diagrams'), { recursive: true });
  await mkdir(join(root, 'web/app'), { recursive: true });
  await writeFile(join(root, 'web', 'index.html'), '<html><head></head></html>');
  await writeFile(join(root, 'web/app/index.html'), '<html><head></head></html>');
  await writeFile(join(arch, 'strukt.json'), printManifest({ version: 1, name: 'x', diagrams: [{ slug: 'mapa', title: 'Mapa' }], docs: [{ slug: 'notas', title: 'Notas' }], sketches: [] }));
  await writeFile(join(arch, 'diagrams', 'mapa.strukt.json'), diagram());
  time = 1_000_000;
  adapterOverride = null;
  publicOrigin = null;
  events = [];
  upgrades = [];
  invites = createInviteRegistry({ now: () => time });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

let limiter = createFailureLimiter();
function handler(accessPlan: AccessPlan = BETA_PLAN) {
  return createCollaborationHandler({
    accessPlan, root, archDir: arch, adapter: () => adapterOverride?.() ?? createFsAdapter(arch), invites, origin: ORIGIN, publicOrigin: () => publicOrigin, port: PORT,
    dist: join(root, 'web'), asset: async () => null, newId: () => 'peer', audit, limiter, now: () => time,
  });
}
async function call(path: string, init: RequestInit & { headers?: Record<string, string> } = {}, info?: RequestInfo) {
  const request = new Request(`${ORIGIN}${path}`, { ...init, headers: { host: `192.168.0.10:${PORT}`, ...init.headers } });
  return handlerOnce(request, info);
}
const visitorCookies = new Map<string, string>();
let current: ReturnType<typeof handler>;
const handlerOnce = async (request: Request, info?: RequestInfo) => {
  // Simulate browser cookie persistence, including the beta's per-browser participant identity.
  const token = request.headers.get('cookie')?.match(/strukt_collab=([^;]+)/)?.[1] ?? new URL(request.url).searchParams.get('token') ?? '';
  const known = visitorCookies.get(token);
  if (known) request.headers.set('cookie', `${request.headers.get('cookie') ?? ''}; ${known}`);
  const result = await current(request, (_request, data) => { upgrades.push(data); return true; }, info);
  const added = result?.headers.getSetCookie().find(value => value.startsWith('joinlet_participant='));
  if (added) visitorCookies.set(token, added.split(';')[0]!);
  return result;
};
beforeEach(() => { visitorCookies.clear(); limiter = createFailureLimiter({ now: () => time, limit: 5, windowMs: 60_000 }); current = handler(); });

const as = (token: string) => ({ cookie: `strukt_collab=${token}` });
const post = (token: string, body: Record<string, unknown>, headers: Record<string, string> = {}) => call('/api/remote/workspace', {
  method: 'POST', headers: { ...as(token), 'content-type': 'application/json', 'x-strukt-csrf': token, ...headers }, body: JSON.stringify({ repo: name, ...body }),
});
const wsHeaders = (token: string, origin = ORIGIN) => ({ ...as(token), upgrade: 'websocket', origin });
const onDisk = (path: string) => readFile(join(arch, path), 'utf8').catch(() => null);

describe('beta limits at the collaboration HTTP boundary', () => {
  it('uses the host entitlement for guest writes and admission, while preserving roles', async () => {
    current = handler(ADMIN_PLAN);
    const invite = invites.create({ name: 'Team', role: 'edit', ttl: 'never' });
    for (let i = 0; i < 8; i++) {
      const response = await current(new Request(`${ORIGIN}/join?token=${invite.token}`), () => false);
      expect(response!.status).toBe(302);
    }
    const before = await onDisk('strukt.json');
    const text = printManifest({ version: 1, name: 'Admin', docs: [], sketches: [], diagrams: Array.from({ length: 25 }, (_, i) => ({ slug: `d-${i}`, title: `D ${i}` })) });
    expect((await post(invite.token, { path: 'strukt.json', expected: before, text }))!.status).toBe(200);
    expect(await onDisk('strukt.json')).toBe(text);
    const viewer = invites.create({ name: 'Viewer', role: 'view', ttl: 'never' });
    expect((await post(viewer.token, { path: 'strukt.json', expected: text, text }))!.status).toBe(403);
    const status = await call('/api/remote/plan', { headers: as(invite.token) });
    expect(await status!.json()).toMatchObject({ plan: { id: 'administrator' }, accountPlan: { id: 'free-beta' } });
  });

  it('admits four guests plus the owner, reuses a browser slot and refuses a fifth guest', async () => {
    const invite = invites.create({ name: 'Team', role: 'edit', ttl: 'never' });
    const enter = (cookie?: string) => current(new Request(`${ORIGIN}/join?token=${invite.token}`, { headers: { ...(cookie ? { cookie } : {}), 'accept-language': 'en' } }), () => false);
    const first = await enter();
    expect(first!.status).toBe(302);
    const cookies = first!.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    for (let i = 0; i < 3; i++) expect((await enter())!.status).toBe(302);
    expect((await enter(cookies))!.status).toBe(302);
    const refused = await enter();
    expect(refused!.status).toBe(403);
    expect(await refused!.json()).toMatchObject({ code: 'PARTICIPANT_LIMIT_REACHED', used: 5, limit: 5 });
    const plan = await current(new Request(`${ORIGIN}/api/remote/plan`, { headers: { cookie: cookies } }), () => false);
    expect(await plan!.json()).toMatchObject({ participants: 5 });
    // A forged participant cookie cannot impersonate an already admitted browser.
    expect((await enter('joinlet_participant=forged.fake'))!.status).toBe(403);
    time += 45_001;
    expect((await enter())!.status).toBe(302);
  });

  it('rejects direct manifest growth before persistence and preserves over-limit legacy data', async () => {
    const invite = invites.create({ name: 'Editor', role: 'edit', ttl: 'never' });
    const manifest = (n: number) => printManifest({ version: 1, name: 'Beta', docs: [], sketches: [], diagrams: Array.from({ length: n }, (_, i) => ({ slug: `d-${i}`, title: `D ${i}` })) });
    const full = manifest(20);
    await writeFile(join(arch, 'strukt.json'), full);
    const refused = await post(invite.token, { path: 'strukt.json', expected: full, text: manifest(21), plan: 'administrator', admin: true });
    expect(refused!.status).toBe(403);
    expect(await refused!.json()).toMatchObject({ code: 'DIAGRAM_LIMIT_REACHED', limit: 20 });
    expect(await onDisk('strukt.json')).toBe(full);
    // Existing workspaces stay usable: edits/reductions above the limit don't destroy content.
    await writeFile(join(arch, 'strukt.json'), manifest(30));
    expect((await post(invite.token, { path: 'strukt.json', expected: manifest(30), text: manifest(29) }))!.status).toBe(200);
  });
});

describe('roles', () => {
  it('regenerates knowledge on the host after a guest writes a diagram and still refuses generated-file writes', async () => {
    await mkdir(join(arch, 'docs'), { recursive: true });
    await writeFile(join(arch, 'docs/notas.md'), '# Notes');
    await mkdir(join(arch, 'context'), { recursive: true });
    await writeFile(join(arch, 'context/ARCHITECTURE.md'), 'old generated context');
    const invite = invites.create({ name: 'Editor', role: 'edit', ttl: 'never' });
    const text = JSON.stringify({ version: 1, nodes: [{ id: 'Notifications' }], connections: [] });
    expect((await post(invite.token, { path: 'diagrams/mapa.strukt.json', expected: await onDisk('diagrams/mapa.strukt.json'), text }))!.status).toBe(200);
    expect(await onDisk('context/ARCHITECTURE.md')).toContain('Notifications');
    expect((await post(invite.token, { path: 'context/ARCHITECTURE.md', expected: await onDisk('context/ARCHITECTURE.md'), text: 'forged context' }))!.status).toBe(403);
  });

  it('lets an edit invite write and join rooms as an editor', async () => {
    const editor = invites.create({ name: 'Ana', role: 'edit', ttl: 'never' });
    expect((await post(editor.token, { path: 'docs/notas.md', text: 'oi', expected: null }))!.status).toBe(200);
    await call(`/api/collaboration?repo=${encodeURIComponent(name)}&kind=doc&slug=notas`, { headers: wsHeaders(editor.token) });
    expect(upgrades[0]).toMatchObject({ invite: editor.id, role: 'edit' });
    expect(upgrades[0]!.readOnly).toBeUndefined();
    expect(await (await call('/api/remote/session', { headers: as(editor.token) }))!.json()).toEqual({ repo: name, csrf: editor.token, mcpUrl: ORIGIN, mode: 'lan', role: 'edit', member: `i:${editor.id}` });
  });

  it.each(['comment', 'view'] as const)('a %s invite reads, joins rooms read-only and writes no diagram or doc, whatever it sends', async (role) => {
    const guest = invites.create({ name: 'Bia', role, ttl: 'never' });
    expect((await call(`/api/remote/workspace?repo=${encodeURIComponent(name)}&path=diagrams/mapa.strukt.json`, { headers: as(guest.token) }))!.status).toBe(200);
    expect((await post(guest.token, { path: 'docs/notas.md', text: 'invadido', expected: null }))!.status).toBe(403);
    // Another invite's csrf token is no way in either (a comment invite reads the header before it looks at the file).
    expect((await post(guest.token, { path: 'docs/notas.md', text: 'invadido', expected: null }, { 'x-strukt-csrf': EDIT }))!.status).toBe(role === 'view' ? 403 : 401);
    expect(await onDisk('docs/notas.md')).toBeNull();
    await call(`/api/collaboration?repo=${encodeURIComponent(name)}&kind=doc&slug=notas`, { headers: wsHeaders(guest.token) });
    expect(upgrades[0]).toMatchObject({ invite: guest.id, role, readOnly: true });
    expect(await (await call('/api/remote/session', { headers: as(guest.token) }))!.json()).toEqual({ repo: name, csrf: guest.token, mcpUrl: ORIGIN, mode: 'lan', role, member: `i:${guest.id}`, readOnly: true });
    expect((await call('/api/collaboration/invite', { headers: as(guest.token) }))!.status).toBe(403);
    expect(events.filter((event) => event.type === 'denied' && event.reason === 'read_only')).toHaveLength(1); // throttled: same caller, same reason
  });

  it('the csrf header must be the caller\'s own token: another invite\'s is refused', async () => {
    const a = invites.create({ name: 'A', role: 'edit', ttl: 'never' });
    const b = invites.create({ name: 'B', role: 'edit', ttl: 'never' });
    expect((await post(a.token, { path: 'docs/notas.md', text: 'x', expected: null }, { 'x-strukt-csrf': b.token }))!.status).toBe(401);
    expect(await onDisk('docs/notas.md')).toBeNull();
  });

  it('hands an editor its own link (not the owner\'s) to pass on', async () => {
    const a = invites.create({ name: 'A', role: 'edit', ttl: 'never' });
    const body = await (await call('/api/collaboration/invite', { headers: as(a.token) }))!.json() as { url: string };
    expect(body.url).toBe(`${ORIGIN}/join?token=${a.token}`);
  });
});

describe('joining', () => {
  it('opens with the invite\'s own token and audits who, with the role and a hash of the address, never the token', async () => {
    const guest = invites.create({ name: 'Carla', role: 'view', ttl: 'never' });
    const joined = await call(`/join?token=${guest.token}`, {}, { ip: '10.0.0.7' });
    expect(joined!.status).toBe(302);
    expect(joined!.headers.get('set-cookie')).toContain(`strukt_collab=${guest.token}`);
    expect(joined!.headers.get('set-cookie')).not.toContain('Secure');
    expect(events).toEqual([{ type: 'join', invite: 'Carla', inviteId: guest.id, role: 'view', ip: audit.hashIp('10.0.0.7') }]);
    expect(JSON.stringify(events)).not.toContain(guest.token);
    expect(JSON.stringify(events)).not.toContain('10.0.0.7');
  });

  it('keeps the cookie no longer than the invite lives, and never past a day', async () => {
    const short = invites.create({ name: 'curto', role: 'view', ttl: '1h' });
    const week = invites.create({ name: 'semana', role: 'view', ttl: '7d' });
    const never = invites.create({ name: 'sem prazo', role: 'view', ttl: 'never' });
    const age = async (token: string) => /Max-Age=(\d+)/.exec((await call(`/join?token=${token}`))!.headers.get('set-cookie')!)![1];
    expect(await age(short.token)).toBe('3600');
    expect(await age(week.token)).toBe('86400');
    expect(await age(never.token)).toBe('86400');
    time += INVITE_TTLS['1h'] - 5_000;
    expect(await age(short.token)).toBe('5');
  });

  it('refuses a made-up token and audits the denial without the token', async () => {
    const made = await call('/join?token=inventado-inventado-inventado-inventado-1', {}, { ip: '10.0.0.9' });
    expect(made!.status).toBe(401);
    expect(events).toEqual([{ type: 'denied', ip: audit.hashIp('10.0.0.9'), reason: 'invalid_token' }]);
    expect(JSON.stringify(events)).not.toContain('inventado');
  });
});

describe('revocation and expiry apply on every request', () => {
  it('a revoked invite stops reading, writing and joining at once, with a message the app recognizes', async () => {
    const guest = invites.create({ name: 'Dani', role: 'edit', ttl: 'never' });
    expect((await call('/api/remote/session', { headers: as(guest.token) }))!.status).toBe(200);
    invites.revoke(guest.id);
    for (const result of [
      await call('/api/remote/session', { headers: as(guest.token) }),
      await post(guest.token, { path: 'docs/notas.md', text: 'x', expected: null }),
      await call(`/join?token=${guest.token}`),
      await call(`/api/collaboration?repo=${encodeURIComponent(name)}&kind=doc&slug=notas`, { headers: wsHeaders(guest.token) }),
    ]) {
      expect(result!.status).toBe(401);
      expect(await result!.json()).toMatchObject({ code: 'invite_ended' });
    }
    expect(await onDisk('docs/notas.md')).toBeNull();
    expect(upgrades).toEqual([]);
  });

  it('an expired invite stops the same way, on the clock', async () => {
    const guest = invites.create({ name: 'Edu', role: 'view', ttl: '1h' });
    expect((await call('/api/remote/session', { headers: as(guest.token) }))!.status).toBe(200);
    time += INVITE_TTLS['1h'];
    const result = await call('/api/remote/session', { headers: as(guest.token) });
    expect(result!.status).toBe(401);
    expect(await result!.json()).toMatchObject({ code: 'invite_ended' });
  });

  it('a stale cookie is not a wrong guess: it never counts toward the attempt limit', async () => {
    const guest = invites.create({ name: 'Fê', role: 'view', ttl: 'never' });
    invites.revoke(guest.id);
    for (let i = 0; i < 20; i++) expect((await call('/api/remote/session', { headers: as(guest.token) }, { ip: '10.0.0.5' }))!.status).toBe(401);
    expect(events.filter((event) => event.type === 'denied')).toHaveLength(1); // audited once a minute
    const other = invites.create({ name: 'Gi', role: 'view', ttl: 'never' });
    expect((await call('/api/remote/session', { headers: as(other.token) }, { ip: '10.0.0.5' }))!.status).toBe(200);
  });

  it('says in Portuguese what a write without text or remove lacks', async () => {
    const guest = invites.create({ name: 'Ivo', role: 'edit', ttl: 'never' });
    const result = await post(guest.token, { path: 'docs/notas.md', expected: null });
    expect(result!.status).toBe(400);
    expect(await result!.json()).toEqual({ error: 'Envie o texto do arquivo ("text") ou "remove": true.' });
  });

  it('a write queued behind another one does not land if the invite was revoked meanwhile', async () => {
    const guest = invites.create({ name: 'Hugo', role: 'edit', ttl: 'never' });
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    const fs = createFsAdapter(arch);
    adapterOverride = () => ({ ...fs, write: async (path: string, text: string) => { await gate; return fs.write(path, text); } });
    const first = post(guest.token, { path: 'docs/notas.md', text: 'um', expected: null });
    const second = post(guest.token, { path: 'docs/notas.md', text: 'dois', expected: 'um' });
    await new Promise((done) => setTimeout(done, 50));
    invites.revoke(guest.id);
    release();
    const results = await Promise.all([first, second]);
    expect(results.map((result) => result!.status)).toEqual([200, 401]);
    expect(await onDisk('docs/notas.md')).toBe('um');
  });
});

describe('attempt limit', () => {
  it('blocks an address after too many distinct invalid tokens: 429 with Retry-After for unknown tokens; a valid invite still gets in', async () => {
    const guest = invites.create({ name: 'Iva', role: 'view', ttl: 'never' });
    const ip = { ip: '203.0.113.5' };
    for (let i = 0; i < 5; i++) expect((await call(`/join?token=chute-${i}-chute-chute-chute-chute-chute-chute`, {}, ip))!.status).toBe(401);
    const blocked = await call('/join?token=chute-novo-chute-chute-chute-chute-chute-chute', {}, ip);
    expect(blocked!.status).toBe(429);
    expect(Number(blocked!.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await call('/api/remote/session', { headers: as('chute-do-cookie-chute-chute-chute-chute') }, ip))!.status).toBe(429);
    // Whoever holds a live invite is never locked out by what others from the same address tried.
    expect((await call(`/join?token=${guest.token}`, {}, ip))!.status).toBe(302);
    expect((await call('/api/remote/session', { headers: as(guest.token) }, ip))!.status).toBe(200);
    expect((await call('/join?token=chute-novo-chute-chute-chute-chute-chute-chute', {}, { ip: '203.0.113.6' }))!.status).toBe(401);
    time += 61_000;
    expect((await call('/join?token=chute-novo-chute-chute-chute-chute-chute-chute', {}, ip))!.status).toBe(401);
    expect(events.filter((event) => event.type === 'denied' && event.reason === 'rate_limited')).toHaveLength(1);
  });

  it('an old cookie (from before the share restarted) is one wrong token however often the browser sends it: it never locks the address, nor the new link', async () => {
    const ip = { ip: '203.0.113.9' };
    const stale = 'cookie-velho-de-antes-do-reinicio-cookie-velho';
    for (let i = 0; i < 30; i++) expect((await call('/api/remote/session', { headers: as(stale) }, ip))!.status).toBe(401);
    const guest = invites.create({ name: 'Ju', role: 'edit', ttl: 'never' });
    const join = await call(`/join?token=${guest.token}`, {}, ip);
    expect(join!.status).toBe(302);
    expect((await call('/api/remote/session', { headers: as(guest.token) }, ip))!.status).toBe(200);
    // And a third-party guest on the same address is as welcome.
    expect((await call('/app/', { headers: as(stale) }, ip))!.status).toBe(401);
  });

  it('a request without any cookie is not counted (a browser that has not opened the invite yet)', async () => {
    for (let i = 0; i < 20; i++) expect((await call('/app/', {}, { ip: '203.0.113.7' }))!.status).toBe(401);
    const guest = invites.create({ name: 'Jo', role: 'view', ttl: 'never' });
    expect((await call(`/join?token=${guest.token}`, {}, { ip: '203.0.113.7' }))!.status).toBe(302);
  });

  it('guessing in the cookie counts like guessing in the link', async () => {
    const ip = { ip: '203.0.113.8' };
    for (let i = 0; i < 5; i++) await call('/api/remote/session', { headers: as(`chute-${i}-chute-chute-chute-chute-chute-chute`) }, ip);
    expect((await call('/api/remote/session', { headers: as('qualquer') }, ip))!.status).toBe(429);
  });
});

describe('public access (tunnel)', () => {
  const tunnelHost = { host: 'quick-demo.trycloudflare.com' };

  it('refuses the tunnel\'s origin while the tunnel is off', async () => {
    const guest = invites.create({ name: 'Kai', role: 'edit', ttl: 'never' });
    const result = await call(`/api/collaboration?repo=${encodeURIComponent(name)}&kind=doc&slug=notas`, { headers: { ...wsHeaders(guest.token, PUBLIC), ...tunnelHost } });
    expect(result!.status).toBe(403);
    expect(upgrades).toEqual([]);
  });

  it('with the tunnel on: the cookie is Secure, links use the public origin, and sockets from it are accepted', async () => {
    publicOrigin = PUBLIC;
    const guest = invites.create({ name: 'Lia', role: 'edit', ttl: 'never' });
    const lan = await call(`/join?token=${guest.token}`);
    expect(lan!.headers.get('set-cookie')).not.toContain('Secure');
    const joined = await call(`/join?token=${guest.token}`, { headers: tunnelHost });
    expect(joined!.headers.get('set-cookie')).toContain('Secure');
    expect(joined!.headers.get('set-cookie')).toContain('HttpOnly');
    expect((await (await call('/api/collaboration/invite', { headers: { ...as(guest.token), ...tunnelHost } }))!.json() as { url: string }).url).toBe(`${PUBLIC}/join?token=${guest.token}`);
    expect((await (await call('/api/collaboration/invite', { headers: as(guest.token) }))!.json() as { url: string }).url).toBe(`${ORIGIN}/join?token=${guest.token}`);
    expect((await (await call('/api/remote/session', { headers: { ...as(guest.token), ...tunnelHost } }))!.json() as { mcpUrl: string }).mcpUrl).toBe(PUBLIC);
    await call(`/api/collaboration?repo=${encodeURIComponent(name)}&kind=doc&slug=notas`, { headers: { ...wsHeaders(guest.token, PUBLIC), ...tunnelHost } });
    expect(upgrades).toHaveLength(1);
    // Any other origin is still refused.
    const foreign = await call(`/api/collaboration?repo=${encodeURIComponent(name)}&kind=doc&slug=notas`, { headers: { ...wsHeaders(guest.token, 'https://evil.trycloudflare.com'), ...tunnelHost } });
    expect(foreign!.status).toBe(403);
  });

  it('believes Cloudflare\'s client address only from loopback and only while the tunnel is on', async () => {
    const guest = invites.create({ name: 'Mo', role: 'view', ttl: 'never' });
    let guess = 0;
    const bad = (info: RequestInfo, headers: Record<string, string>) => call(`/join?token=chute-${guess++}-chute-chute-chute-chute-chute`, { headers }, info);
    const probe = (info: RequestInfo, headers: Record<string, string> = {}) => call('/join?token=sonda-sonda-sonda-sonda-sonda-sonda', { headers }, info);
    // Tunnel off: the header is ignored, the socket's address counts.
    for (let i = 0; i < 5; i++) await bad({ ip: '203.0.113.20' }, { 'cf-connecting-ip': '198.51.100.1' });
    expect((await probe({ ip: '203.0.113.20' }))!.status).toBe(429);
    expect((await probe({ ip: '203.0.113.21' }))!.status).toBe(401);
    // Tunnel on: from cloudflared (loopback) the header names the guest; from anyone else it is ignored.
    publicOrigin = PUBLIC;
    for (let i = 0; i < 5; i++) await bad({ ip: '127.0.0.1' }, { 'cf-connecting-ip': '198.51.100.2', ...tunnelHost });
    expect((await probe({ ip: '127.0.0.1' }, { 'cf-connecting-ip': '198.51.100.2', ...tunnelHost }))!.status).toBe(429);
    expect((await probe({ ip: '127.0.0.1' }, { 'cf-connecting-ip': '198.51.100.3', ...tunnelHost }))!.status).toBe(401);
    for (let i = 0; i < 5; i++) await bad({ ip: '203.0.113.30' }, { 'cf-connecting-ip': `198.51.100.${40 + i}` });
    expect((await probe({ ip: '203.0.113.30' }, { 'cf-connecting-ip': '198.51.100.99' }))!.status).toBe(429);
  });
});

describe('audit of writes', () => {
  it('records the path and the operation of a write, never its content', async () => {
    const guest = invites.create({ name: 'Nina', role: 'edit', ttl: 'never' });
    const secret = '# segredo-que-nao-pode-vazar';
    await post(guest.token, { path: 'docs/notas.md', text: secret, expected: null });
    await post(guest.token, { path: 'docs/notas.md', remove: true, expected: secret });
    expect(events).toEqual([
      { type: 'write', invite: 'Nina', inviteId: guest.id, role: 'edit', path: 'docs/notas.md', op: 'write' },
      { type: 'write', invite: 'Nina', inviteId: guest.id, role: 'edit', path: 'docs/notas.md', op: 'remove' },
    ]);
    expect(JSON.stringify(events)).not.toContain('segredo');
  });

  it('audits a refused path and a failed write is not recorded as a write', async () => {
    const guest = invites.create({ name: 'Otto', role: 'edit', ttl: 'never' });
    expect((await post(guest.token, { path: 'context/ARCHITECTURE.md', text: 'x', expected: null }))!.status).toBe(403);
    expect((await post(guest.token, { path: 'docs/notas.md', text: 'x', expected: 'errado' }))!.status).toBe(409);
    expect(events).toEqual([{ type: 'denied', ip: audit.hashIp('unknown'), reason: 'path_not_allowed', invite: 'Otto', inviteId: guest.id, role: 'edit', path: 'context/ARCHITECTURE.md' }]);
  });

  it('never logs the invite\'s token or the request\'s query string on a failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const guest = invites.create({ name: 'Pia', role: 'view', ttl: 'never' });
    current = createCollaborationHandler({
      root, archDir: arch, adapter: () => { throw new Error('boom'); }, invites, origin: ORIGIN, port: PORT, dist: join(root, 'web'), asset: async () => null, newId: () => 'peer', audit, limiter, now: () => time,
    });
    const result = await call(`/api/remote/revision?repo=${encodeURIComponent(name)}&token=${guest.token}`, { headers: as(guest.token) });
    expect(result!.status).toBe(500);
    expect(warn.mock.calls.flat().join(' ')).not.toContain(guest.token);
    warn.mockRestore();
  });
});

describe('a browser that opens a link that does not work', () => {
  const page = { accept: 'text/html,application/xhtml+xml' };

  it('gets a plain page (never JSON) for an ended invite, an invalid one, a missing cookie and a blocked address', async () => {
    const guest = invites.create({ name: 'Rui', role: 'view', ttl: 'never' });
    invites.revoke(guest.id);
    const ended = await call(`/join?token=${guest.token}`, { headers: page });
    expect(ended!.status).toBe(401);
    expect(ended!.headers.get('content-type')).toContain('text/html');
    const html = await ended!.text();
    expect(html).toContain('<h1>Este convite foi revogado ou expirou.</h1>');
    expect(html).toContain('Peça um novo link a quem compartilhou.');
    expect(html).not.toContain(guest.token);
    expect(ended!.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(ended!.headers.get('cache-control')).toBe('no-store');

    const invalid = await call('/join?token=inventado', { headers: page });
    expect(invalid!.status).toBe(401);
    expect(await invalid!.text()).toContain('<h1>Convite inválido.</h1>');
    expect((await call('/app/', { headers: page }))!.headers.get('content-type')).toContain('text/html');
    expect((await call('/app/', { headers: { ...page, ...as(guest.token) } }))!.status).toBe(401);

    const ip = { ip: '203.0.113.77' };
    for (let i = 0; i < 5; i++) await call(`/join?token=chute-${i}`, {}, ip);
    const blocked = await call('/join?token=x', { headers: page }, ip);
    expect(blocked!.status).toBe(429);
    expect(blocked!.headers.get('content-type')).toContain('text/html');
    expect(Number(blocked!.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('keeps JSON for the app, for scripts and for sockets', async () => {
    const guest = invites.create({ name: 'Sol', role: 'view', ttl: 'never' });
    invites.revoke(guest.id);
    const api = await call('/api/remote/session', { headers: { ...as(guest.token), accept: 'application/json' } });
    expect(api!.headers.get('content-type')).toContain('application/json');
    expect(await api!.json()).toMatchObject({ code: 'invite_ended' });
    const socket = await call(`/api/collaboration?repo=${encodeURIComponent(name)}&kind=doc&slug=notas`, { headers: { ...wsHeaders(guest.token), accept: 'text/html' } });
    expect(socket!.headers.get('content-type')).toContain('application/json');
    const posted = await call('/join?token=x', { method: 'POST', headers: page });
    expect(posted!.headers.get('content-type')).toContain('application/json');
  });
});

describe('comments', () => {
  const PATH = 'comments/diagram-mapa.json';
  const author = (name: string) => ({ name, color: '#3972dc' });
  const messageOf = (id: string, owner: string, name: string, text: string, at = time) => ({ id, owner, author: author(name), text, at });
  const threadOf = (id: string, owner: string, name: string, text = 'oi', anchor: unknown = { type: 'node', id: 'API' }, at = time) => ({
    id, anchor, by: owner, created: at, status: 'open', statusAt: at, messages: [messageOf(`${id}m`, owner, name, text, at)],
  });
  const fileOf = (...threads: unknown[]) => `${JSON.stringify({ version: 1, threads }, null, 2)}\n`;
  const write = (token: string, text: string, expected: string | null = null, path = PATH) => post(token, { path, text, expected });
  const json = async (result: Response | undefined) => (await result!.json()) as { error?: string };

  it('lets a comment invite start a conversation as itself, and audits the path but never the text', async () => {
    const cris = invites.create({ name: 'Cris', role: 'comment', ttl: 'never' });
    const text = fileOf(threadOf('t1', `i:${cris.id}`, 'Cris', 'texto-secreto-do-comentario'));
    expect((await write(cris.token, text))!.status).toBe(200);
    expect(await onDisk(PATH)).toBe(text);
    expect(events).toContainEqual({ type: 'write', invite: 'Cris', inviteId: cris.id, role: 'comment', path: PATH, op: 'write' });
    expect(JSON.stringify(events)).not.toContain('texto-secreto');
  });

  it('refuses anything but comment files from it: other paths, removal, and the files of items that do not exist', async () => {
    const cris = invites.create({ name: 'Cris', role: 'comment', ttl: 'never' });
    for (const path of ['strukt.json', 'diagrams/mapa.strukt.json', 'docs/notas.md', 'versions/mapa/index.json', 'comments/sketch-x.json', 'comments/diagram-mapa.json.bak', 'comments/../strukt.json']) {
      expect((await write(cris.token, '{}', null, path))!.status, path).toBe(403);
    }
    expect((await post(cris.token, { path: PATH, remove: true, expected: null }))!.status).toBe(403);
    const ghost = await write(cris.token, fileOf(threadOf('t1', `i:${cris.id}`, 'Cris')), null, 'comments/diagram-fantasma.json');
    expect(ghost!.status).toBe(422);
    expect(await onDisk('comments/diagram-fantasma.json')).toBeNull();
  });

  it('refuses a view invite, even for a comment file', async () => {
    const vera = invites.create({ name: 'Vera', role: 'view', ttl: 'never' });
    expect((await write(vera.token, fileOf(threadOf('t1', `i:${vera.id}`, 'Vera'))))!.status).toBe(403);
    expect(await onDisk(PATH)).toBeNull();
  });

  describe('what the host keeps of a comment write (identity and size)', () => {
    it('pins the author of what a guest writes to its invite, so a guest cannot speak as someone else', async () => {
      const cris = invites.create({ name: 'Cris', role: 'comment', ttl: 'never' });
      const forged = JSON.parse(fileOf(threadOf('t1', `i:${cris.id}`, 'Ana', 'fui eu mesmo')));
      forged.threads[0].status = 'resolved';
      forged.threads[0].statusAt = time + 1;
      forged.threads[0].statusBy = author('Dono do workspace');
      expect((await write(cris.token, JSON.stringify(forged)))!.status).toBe(200);
      const stored = JSON.parse((await onDisk(PATH))!) as { threads: Array<{ statusBy: { name: string }; messages: Array<{ author: { name: string } }> }> };
      expect(stored.threads[0]!.messages[0]!.author.name).toBe('Cris');
      expect(stored.threads[0]!.statusBy.name).toBe('Cris');
    });

    it('leaves what is already in the file alone: only the guest\'s own new or changed entries are pinned', async () => {
      const cris = invites.create({ name: 'Cris', role: 'comment', ttl: 'never' });
      const ana = invites.create({ name: 'Ana', role: 'edit', ttl: 'never' });
      // Ana (an editor) wrote under the name she chose; a later write by Cris must not rename her.
      const before = fileOf(threadOf('ana1', `i:${ana.id}`, 'Ana Souza', 'pergunta'));
      await mkdir(join(arch, 'comments'), { recursive: true });
      await writeFile(join(arch, PATH), before);
      const next = JSON.parse(before);
      next.threads[0].messages.push(messageOf('r1', `i:${cris.id}`, 'Qualquer um', 'resposta', time + 10));
      expect((await write(cris.token, JSON.stringify(next), before))!.status).toBe(200);
      const stored = JSON.parse((await onDisk(PATH))!) as { threads: Array<{ messages: Array<{ author: { name: string } }> }> };
      expect(stored.threads[0]!.messages.map((message) => message.author.name)).toEqual(['Ana Souza', 'Cris']);
    });

    it('stores the canonical form: padding and unknown fields do not bloat the file', async () => {
      const cris = invites.create({ name: 'Cris', role: 'comment', ttl: 'never' });
      const fat = JSON.parse(fileOf(threadOf('t1', `i:${cris.id}`, 'Cris')));
      fat.threads[0].lixo = 'x'.repeat(300_000);
      fat.threads[0].messages[0].lixo = 'y'.repeat(300_000);
      expect((await write(cris.token, JSON.stringify(fat, null, 8)))!.status).toBe(200);
      const stored = (await onDisk(PATH))!;
      expect(stored.length).toBeLessThan(2_000);
      expect(stored).not.toContain('lixo');
    });
  });

  describe('write rate (per invite)', () => {
    it('refuses writes past the limit with 429 and Retry-After, audits one denial, keeps the audit from flooding, and recovers', async () => {
      const cris = invites.create({ name: 'Cris', role: 'comment', ttl: 'never' });
      const ana = invites.create({ name: 'Ana', role: 'edit', ttl: 'never' });
      let accepted = 0;
      let refused = 0;
      let last: Response | undefined;
      for (let i = 0; i < 300; i++) {
        last = await post(cris.token, { path: PATH, text: '{ não é json', expected: null });
        if (last!.status === 429) refused += 1;
        else accepted += 1;
      }
      expect(refused).toBeGreaterThan(200);
      expect(accepted).toBeLessThanOrEqual(60);
      expect(Number(last!.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(events.filter((event) => event.type === 'denied' && event.reason === 'rate_limited' && event.inviteId === cris.id)).toHaveLength(1);
      // Another guest is not slowed by it.
      expect((await post(ana.token, { path: 'docs/notas.md', text: 'oi', expected: null }))!.status).toBe(200);
      time += 15_000;
      expect((await write(cris.token, fileOf(threadOf('t1', `i:${cris.id}`, 'Cris'))))!.status).toBe(200);
    });
  });

  describe('against a file others have written', () => {
    let cris: ReturnType<typeof invites.create>;
    let ana: ReturnType<typeof invites.create>;
    let before: string;
    beforeEach(async () => {
      cris = invites.create({ name: 'Cris', role: 'comment', ttl: 'never' });
      ana = invites.create({ name: 'Ana', role: 'edit', ttl: 'never' });
      before = fileOf(threadOf('ana1', `i:${ana.id}`, 'Ana', 'pergunta da Ana'), threadOf('cris1', `i:${cris.id}`, 'Cris', 'dúvida da Cris', { type: 'node', id: 'API' }, time + 5));
      expect((await write(ana.token, before))!.status).toBe(200);
    });
    const edited = (change: (file: { threads: Array<Record<string, any>> }) => void) => {
      const file = JSON.parse(before) as { threads: Array<Record<string, any>> };
      change(file);
      return JSON.stringify(file);
    };

    it('lets it reply, edit and delete its own messages and resolve a conversation of someone else', async () => {
      const reply = edited((file) => file.threads[0]!.messages.push(messageOf('r1', `i:${cris.id}`, 'Cris', 'resposta da Cris', time + 10)));
      expect((await write(cris.token, reply, before))!.status).toBe(200);
      // The host keeps the canonical form of what it was sent, so the next write is based on what is on disk.
      const stored = (await onDisk(PATH))!;
      const resolved = edited((file) => { file.threads[0]!.messages.push(messageOf('r1', `i:${cris.id}`, 'Cris', 'resposta da Cris', time + 10)); Object.assign(file.threads[0]!, { status: 'resolved', statusAt: time + 20, statusBy: author('Cris') }); });
      expect((await write(cris.token, resolved, stored))!.status).toBe(200);
      const stored2 = (await onDisk(PATH))!;
      const rewritten = edited((file) => { file.threads[0]!.messages.push({ ...messageOf('r1', `i:${cris.id}`, 'Cris', 'resposta corrigida', time + 10), edited: time + 30 }); Object.assign(file.threads[0]!, { status: 'resolved', statusAt: time + 20, statusBy: author('Cris') }); });
      expect((await write(cris.token, rewritten, stored2))!.status).toBe(200);
    });

    it('refuses to edit, delete or impersonate anyone else, with the rule\'s reason, and leaves the file as it was', async () => {
      const attacks: Array<[string, string]> = [
        ['editing a message of Ana', edited((file) => { file.threads[0]!.messages[0].text = 'Ana disse outra coisa'; })],
        ['deleting a message of Ana', edited((file) => { file.threads[0]!.messages[0] = { id: 'ana1m', owner: `i:${ana.id}`, author: author('Ana'), text: '', at: time, deleted: time + 1 }; })],
        ['dropping Ana\'s conversation', edited((file) => { file.threads.shift(); })],
        ['deleting Ana\'s conversation', edited((file) => { Object.assign(file.threads[0]!, { deleted: time + 1 }); })],
        ['emptying the file', fileOf()],
        ['speaking as Ana', edited((file) => file.threads[0]!.messages.push(messageOf('r1', `i:${ana.id}`, 'Ana', 'fui eu', time + 10)))],
        ['starting a conversation as Ana', edited((file) => file.threads.push(threadOf('forjada', `i:${ana.id}`, 'Ana')))],
        ['moving a conversation to another node', edited((file) => { file.threads[0]!.anchor = { type: 'node', id: 'Banco' }; })],
        ['a future date', edited((file) => file.threads[1]!.messages.push(messageOf('r2', `i:${cris.id}`, 'Cris', 'do futuro', time + 7 * 86_400_000)))],
      ];
      for (const [what, attempt] of attacks) {
        const result = await write(cris.token, attempt, before);
        expect(result!.status, what).toBe(403);
        expect((await json(result)).error, what).toMatch(/próprios/);
      }
      expect(await onDisk(PATH)).toBe(before);
      expect(events.filter((event) => event.type === 'denied' && event.reason === 'comment_rule').length).toBeGreaterThan(0);
    });

    it('refuses a file that is not valid (not JSON, wrong anchors for the item, over the size) and a stale write', async () => {
      expect((await json(await write(cris.token, '{ não é json', before))).error).toMatch(/JSON/);
      const docAnchor = edited((file) => file.threads.push(threadOf('t9', `i:${cris.id}`, 'Cris', 'oi', { type: 'text', quote: 'x', prefix: '', suffix: '', from: 0 })));
      expect((await write(cris.token, docAnchor, before))!.status).toBe(422);
      expect((await write(cris.token, 'x'.repeat(1_100_000), before))!.status).toBe(413);
      expect((await write(cris.token, edited((file) => file.threads.push(threadOf('t8', `i:${cris.id}`, 'Cris'))), 'texto antigo'))!.status).toBe(409);
      expect(await onDisk(PATH)).toBe(before);
    });

    it('never lets __proto__ become a name the host reads or a key it keeps', async () => {
      const hostile = '{"version":1,"threads":[{"__proto__":{"polluted":1},"id":"__proto__","anchor":{"type":"node","id":"__proto__"},"by":"__proto__","created":1,"status":"open","messages":[{"id":"m","owner":"__proto__","author":{"name":"__proto__","color":"#3972dc"},"text":"oi","at":1}]}]}';
      expect((await write(cris.token, hostile, before))!.status).toBeGreaterThanOrEqual(400);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect((await write(cris.token, '{}', null, 'comments/diagram-__proto__.json'))!.status).toBe(403);
    });

    it('does not let a comment invite overwrite a file that is broken today, but an editor repairs it', async () => {
      await writeFile(join(arch, PATH), '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> outro\n');
      const broken = (await onDisk(PATH))!;
      const refused = await write(cris.token, fileOf(threadOf('t1', `i:${cris.id}`, 'Cris')), broken);
      expect(refused!.status).toBe(403);
      expect((await json(refused)).error).toMatch(/erros/);
      expect((await write(ana.token, before, broken))!.status).toBe(200);
    });

    it('lets an edit invite write any valid comment file, including over others\' messages', async () => {
      const moderated = edited((file) => { file.threads[1]!.messages[0].text = 'moderado pela Ana'; });
      expect((await write(ana.token, moderated, before))!.status).toBe(200);
      const stored = (await onDisk(PATH))!;
      expect((await write(ana.token, '{ não é json', stored))!.status).toBe(422);
      expect((await post(ana.token, { path: PATH, remove: true, expected: stored }))!.status).toBe(200);
      expect(await onDisk(PATH)).toBeNull();
    });
  });

  it('ends a comment invite\'s writes when it is revoked, like any other', async () => {
    const cris = invites.create({ name: 'Cris', role: 'comment', ttl: 'never' });
    invites.revoke(cris.id);
    const result = await write(cris.token, fileOf(threadOf('t1', `i:${cris.id}`, 'Cris')));
    expect(result!.status).toBe(401);
    expect(await onDisk(PATH)).toBeNull();
  });
});
