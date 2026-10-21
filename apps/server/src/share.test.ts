import { describe, expect, it, vi } from 'vitest';
import type { AuditEvent, AuditLog } from './audit';
import type { InviteView } from './invites';
import { createShare } from './share';
import type { ShareHost } from './share';
import type { TunnelHandle } from './tunnel';
import { UserError } from './userError';

const view = (id: string, name: string, role: InviteView['role'] = 'view'): InviteView => ({ id, name, role, createdAt: 1, expiresAt: null, url: `http://192.168.0.5:8790/join?token=${id}`, publicUrl: null });

function fakeHost() {
  let list = [view('e', 'Link para editar', 'edit'), view('v', 'Link só para ver')];
  const host: ShareHost & { origin: string | null; created: unknown[]; people: ShareHost['people'] } = {
    origin: null,
    created: [],
    invites: {
      list: () => list,
      create: vi.fn((input: { name: unknown; role: unknown; ttl: unknown }) => { host.created.push(input); const made = view(`n${list.length}`, String(input.name), input.role as InviteView['role']); list = [...list, made]; return made; }),
      revoke: vi.fn((id: string) => { const had = list.some((invite) => invite.id === id); list = list.filter((invite) => invite.id !== id); return had; }),
    },
    setPublicOrigin: vi.fn((origin: string | null) => { host.origin = origin; }),
    people: vi.fn(async () => [{ name: 'Ana', color: '#3972dc' }]),
    stop: vi.fn(async () => {}),
  };
  return host;
}

function fakeAudit() {
  const events: AuditEvent[] = [];
  const audit: AuditLog = { hashIp: () => 'unknown', record: (event) => { events.push(event); }, flush: async () => {}, recent: vi.fn(async () => []) };
  return { audit, events };
}

function fakeTunnel(url = 'https://demo-demo.trycloudflare.com') {
  const stops: string[] = [];
  const handle: TunnelHandle = { url, stop: async () => { stops.push('stop'); } };
  let exit: (() => void) | undefined;
  const start = vi.fn(async (options: { port: number; onExit?: () => void }) => { exit = options.onExit; return handle; });
  return { start, stops, crash: () => exit?.() };
}

function setup(overrides: Partial<Parameters<typeof createShare>[0]> = {}) {
  const host = fakeHost();
  const { audit, events } = fakeAudit();
  const tunnel = fakeTunnel();
  const timers: Array<{ run: () => void; ms: number; cancelled: boolean }> = [];
  const share = createShare({
    start: async () => host, freePort: async () => 8790, now: () => 1000, audit: () => audit, tunnel: tunnel.start,
    schedule: (run, ms) => { const timer = { run, ms, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; },
    ...overrides,
  });
  return { share, host, events, tunnel, timers, audit };
}

describe('share', () => {
  it('starts a LAN host once, reports its invites and who is online, and stops it', async () => {
    const start = vi.fn(async () => fakeHost());
    const { share, events } = setup({ start });
    expect(await share.status()).toEqual({ active: false });
    const started = await share.start('/repo');
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ root: '/repo', port: 8790 }));
    expect(started).toMatchObject({ active: true, root: '/repo', startedAt: 1000, people: [{ name: 'Ana', color: '#3972dc' }], tunnel: { active: false } });
    expect(started.active && started.invites.map((invite) => invite.name)).toEqual(['Link para editar', 'Link só para ver']);
    expect(await share.start('/repo')).toEqual(started);
    expect(start).toHaveBeenCalledTimes(1);
    expect(await share.stop()).toEqual({ active: false });
    expect(await share.status()).toEqual({ active: false });
    expect(await share.stop()).toEqual({ active: false });
    expect(events.map((event) => event.type)).toEqual(['share.start', 'share.stop']);
  });

  it('refuses to share another folder while one is shared', async () => {
    const { share } = setup();
    await share.start('/a');
    await expect(share.start('/b')).rejects.toThrow('Já existe um compartilhamento ativo de outra pasta. Pare-o antes de compartilhar esta.');
  });

  it('passes a host\'s own pt-BR failure through and hides anything else', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const refusal = setup({ start: async () => { throw new Error('Frontend não compilado. Rode bun run build antes de iniciar a colaboração.'); } });
    await expect(refusal.share.start('/a')).rejects.toThrow('Frontend não compilado');
    const crash = setup({ start: async () => { throw new Error("EACCES: open '/home/dono/x'"); } });
    await expect(crash.share.start('/a')).rejects.toThrow('Não foi possível iniciar o compartilhamento.');
    expect(warn.mock.calls.flat().join(' ')).toContain('EACCES');
    expect(await crash.share.status()).toEqual({ active: false });
    warn.mockRestore();
  });

  it('survives a host that fails to list its people', async () => {
    const { share, host } = setup();
    host.people = async () => { throw new Error('boom'); };
    await share.start('/a');
    expect(await share.status()).toMatchObject({ active: true, people: [] });
  });
});

describe('invites', () => {
  it('creates and revokes named invites through the host, and needs a running share', async () => {
    const { share, host } = setup();
    await expect(share.createInvite({ name: 'Ana', role: 'edit', ttl: '24h' })).rejects.toThrow('Ative o compartilhamento');
    await expect(share.revokeInvite('x')).rejects.toThrow('Ative o compartilhamento');
    await share.start('/a');
    const status = await share.createInvite({ name: 'Ana', role: 'comment', ttl: '24h' });
    expect(host.created).toEqual([{ name: 'Ana', role: 'comment', ttl: '24h' }]);
    expect(status.active && status.invites.map((invite) => invite.name)).toEqual(['Link para editar', 'Link só para ver', 'Ana']);
    const after = await share.revokeInvite('n2');
    expect(after.active && after.invites.map((invite) => invite.name)).toEqual(['Link para editar', 'Link só para ver']);
    await expect(share.revokeInvite('n2')).rejects.toThrow('Convite não encontrado');
  });

  it('passes the registry\'s own refusals through (pt-BR) and hides anything else', async () => {
    const { share, host } = setup();
    await share.start('/a');
    host.invites.create = () => { throw new UserError('Informe o nome do convite.'); };
    await expect(share.createInvite({ name: '', role: 'edit', ttl: '1h' })).rejects.toThrow('Informe o nome do convite.');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    host.invites.create = () => { throw new Error('/Users/dono/segredo'); };
    await expect(share.createInvite({ name: 'x', role: 'edit', ttl: '1h' })).rejects.toThrow('Não foi possível criar o convite.');
    warn.mockRestore();
  });
});

describe('public access', () => {
  it('needs the person\'s acknowledgement and a share to expose', async () => {
    const { share, tunnel } = setup();
    await expect(share.startTunnel({ ttl: '2h', acknowledged: true })).rejects.toThrow('Ative o compartilhamento');
    await share.start('/a');
    await expect(share.startTunnel({ ttl: '2h' })).rejects.toThrow('Confirme o aviso');
    await expect(share.startTunnel({ ttl: '2h', acknowledged: 'sim' })).rejects.toThrow('Confirme o aviso');
    expect(tunnel.start).not.toHaveBeenCalled();
  });

  it('exposes only the collaboration host: the tunnel gets its port, the host learns the public origin, and it falls on its own', async () => {
    const { share, host, tunnel, timers, events } = setup();
    await share.start('/a');
    const status = await share.startTunnel({ ttl: '30m', acknowledged: true });
    expect(tunnel.start).toHaveBeenCalledWith(expect.objectContaining({ port: 8790 }));
    expect(host.origin).toBe('https://demo-demo.trycloudflare.com');
    expect(status).toMatchObject({ active: true, tunnel: { active: true, provider: 'cloudflared', url: 'https://demo-demo.trycloudflare.com', expiresAt: 1000 + 30 * 60_000 } });
    expect(timers.at(-1)!.ms).toBe(30 * 60_000);
    expect(events.at(-1)).toEqual({ type: 'tunnel.start', provider: 'cloudflared', expiresAt: 1000 + 30 * 60_000 });
    await expect(share.startTunnel({ ttl: '2h', acknowledged: true })).rejects.toThrow('já está ligado');
    timers.at(-1)!.run();
    await vi.waitFor(() => expect(tunnel.stops).toEqual(['stop']));
    expect(host.origin).toBeNull();
    expect(events.at(-1)).toEqual({ type: 'tunnel.stop', provider: 'cloudflared', reason: 'expired' });
    expect(await share.status()).toMatchObject({ tunnel: { active: false } });
  });

  it('defaults to two hours and refuses other durations', async () => {
    const { share, timers } = setup();
    await share.start('/a');
    await expect(share.startTunnel({ ttl: '7d', acknowledged: true })).rejects.toThrow('duração');
    await expect(share.startTunnel({ ttl: '__proto__', acknowledged: true })).rejects.toThrow('duração');
    await share.startTunnel({ acknowledged: true });
    expect(timers.at(-1)!.ms).toBe(2 * 3_600_000);
  });

  it('stops by hand, when the share stops, and when cloudflared dies on its own', async () => {
    const manual = setup();
    await manual.share.start('/a');
    await manual.share.startTunnel({ ttl: '2h', acknowledged: true });
    await manual.share.stopTunnel();
    expect(manual.tunnel.stops).toEqual(['stop']);
    expect(manual.host.origin).toBeNull();
    expect(manual.timers.at(-1)!.cancelled).toBe(true);
    expect(manual.events.at(-1)).toMatchObject({ type: 'tunnel.stop', reason: 'manual' });

    const closing = setup();
    await closing.share.start('/a');
    await closing.share.startTunnel({ ttl: '2h', acknowledged: true });
    await closing.share.stop();
    expect(closing.tunnel.stops).toEqual(['stop']);
    expect(closing.events.map((event) => event.type === 'tunnel.stop' ? `tunnel.stop:${event.reason}` : event.type)).toEqual(['share.start', 'tunnel.start', 'tunnel.stop:share_stopped', 'share.stop']);

    const dying = setup();
    await dying.share.start('/a');
    await dying.share.startTunnel({ ttl: '2h', acknowledged: true });
    dying.tunnel.crash();
    expect(await dying.share.status()).toMatchObject({ tunnel: { active: false } });
    expect(dying.host.origin).toBeNull();
    expect(dying.events.at(-1)).toMatchObject({ type: 'tunnel.stop', reason: 'exited' });
  });

  it('says why the tunnel could not open (missing cloudflared) and hides anything else', async () => {
    const missing = setup({ tunnel: async () => { throw new UserError('O cloudflared não está instalado. Instale-o (macOS: brew install cloudflared).'); } });
    await missing.share.start('/a');
    await expect(missing.share.startTunnel({ ttl: '2h', acknowledged: true })).rejects.toThrow('brew install cloudflared');
    expect(missing.host.origin).toBeNull();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const odd = setup({ tunnel: async () => { throw new Error('/Users/dono/.cloudflared/cert.pem'); } });
    await odd.share.start('/a');
    await expect(odd.share.startTunnel({ ttl: '2h', acknowledged: true })).rejects.toThrow('Não foi possível abrir o acesso público.');
    warn.mockRestore();
  });

  it('never audits the public address', async () => {
    const { share, events } = setup();
    await share.start('/a');
    await share.startTunnel({ ttl: '2h', acknowledged: true });
    expect(JSON.stringify(events)).not.toContain('trycloudflare');
  });
});

describe('activity', () => {
  it('reads the audit of the workspace, even after the share stopped', async () => {
    const { share, audit } = setup();
    (audit.recent as ReturnType<typeof vi.fn>).mockResolvedValue([{ t: 'x', type: 'join' }]);
    expect(await share.activity('/a')).toEqual([{ t: 'x', type: 'join' }]);
    expect(audit.recent).toHaveBeenCalledWith(100);
  });
});

describe('public access races', () => {
  it('opens only one tunnel when asked twice at once, and drops one that finishes after the share stopped', async () => {
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    const stops: string[] = [];
    const opening = vi.fn(async () => { await gate; return { url: 'https://slow-demo.trycloudflare.com', stop: async () => { stops.push('stop'); } }; });
    const { share, host } = setup({ tunnel: opening });
    await share.start('/a');
    const first = share.startTunnel({ ttl: '2h', acknowledged: true });
    await expect(share.startTunnel({ ttl: '2h', acknowledged: true })).rejects.toThrow('já está ligado');
    await share.stop();
    release();
    await expect(first).rejects.toThrow('encerrado');
    expect(stops).toEqual(['stop']);
    expect(host.origin).toBeNull();
    expect(opening).toHaveBeenCalledTimes(1);
  });
});
