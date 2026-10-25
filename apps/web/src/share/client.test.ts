import { afterEach, describe, expect, it, vi } from 'vitest';
import { setRequestWorkspace } from '../workspace/requestAuth';
import { createShareClient } from './client';

const invite = { id: 'e', name: 'Link para editar', role: 'edit', createdAt: 1, expiresAt: null, url: 'http://192.168.0.5:8790/join?token=t', publicUrl: null };
const active = { active: true, root: '/repo', people: [], invites: [invite], tunnel: { active: false }, startedAt: 1 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(()=>setRequestWorkspace(undefined));

function setup(reply: Response | Error = json(active)) {
  const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => { if (reply instanceof Error) throw reply; return reply.clone(); });
  return { fetchFn, client: createShareClient(fetchFn) };
}

describe('share client', () => {
  it('scopes invitation lists and audit reads to the selected Cloud workspace',async()=>{
    setRequestWorkspace('cloud:second');
    const {client,fetchFn}=setup();await client.status();
    expect(fetchFn).toHaveBeenCalledWith('/api/share',{method:'GET',headers:{'x-joinlet-workspace':'cloud:second'}});
  });
  it('reads the status', async () => {
    const { client, fetchFn } = setup();
    expect(await client.status()).toEqual({ kind: 'ok', status: active });
    expect(fetchFn).toHaveBeenCalledWith('/api/share', { method: 'GET',headers:{} });
  });

  it('posts each action as JSON to its own route', async () => {
    const { client, fetchFn } = setup();
    await client.start('/repo');
    await client.stop();
    await client.createInvite({ name: 'Ana', role: 'comment', ttl: '24h' });
    await client.revokeInvite('x');
    await client.startTunnel({ ttl: '30m' });
    await client.stopTunnel();
    const calls = fetchFn.mock.calls.map(([url, init]) => [url, init?.method, JSON.parse(String(init?.body))]);
    expect(calls).toEqual([
      ['/api/share/start', 'POST', { dir: '/repo' }],
      ['/api/share/stop', 'POST', {}],
      ['/api/share/invites', 'POST', { name: 'Ana', role: 'comment', ttl: '24h' }],
      ['/api/share/invites/revoke', 'POST', { id: 'x' }],
      ['/api/share/tunnel/start', 'POST', { ttl: '30m', acknowledged: true }],
      ['/api/share/tunnel/stop', 'POST', {}],
    ]);
    expect((fetchFn.mock.calls[0]![1]!.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('says the server is offline when it cannot be reached or answers something that is not JSON', async () => {
    expect((await setup(new Error('x')).client.status()).kind).toBe('offline');
    expect((await setup(new Response('<html>', { status: 502 })).client.status()).kind).toBe('offline');
    expect(await setup(json({ error: 'caiu' }, 503)).client.status()).toEqual({ kind: 'offline', reason: 'caiu' });
  });

  it('keeps the server\'s own message for a refusal', async () => {
    expect(await setup(json({ error: 'Informe o nome do convite.' }, 400)).client.createInvite({ name: '', role: 'edit', ttl: '1h' })).toEqual({ kind: 'error', message: 'Informe o nome do convite.' });
    expect(await setup(json({}, 500)).client.status()).toEqual({ kind: 'error', message: 'O servidor respondeu 500.' });
  });

  it('refuses a status that is not the shape it knows', async () => {
    for (const body of [{ active: true }, { ...active, invites: [{ ...invite, role: 'admin' }] }, { ...active, tunnel: { active: true } }, { ...active, invites: 'x' }, []]) {
      expect(await setup(json(body)).client.status(), JSON.stringify(body)).toEqual({ kind: 'error', message: 'Resposta inválida do servidor.' });
    }
  });

  it('reads the activity and drops entries it does not understand', async () => {
    const { client, fetchFn } = setup(json({ entries: [{ t: '2026-10-03T12:00:00.000Z', type: 'join', invite: 'Ana' }, { nope: 1 }, 'x'] }));
    expect(await client.activity()).toEqual({ kind: 'ok', entries: [{ t: '2026-10-03T12:00:00.000Z', type: 'join', invite: 'Ana' }] });
    expect(fetchFn).toHaveBeenCalledWith('/api/share/audit', { method: 'GET',headers:{} });
    expect(await setup(json({ entries: 5 })).client.activity()).toEqual({ kind: 'error', message: 'Resposta inválida do servidor.' });
    expect(await setup(json({ error: 'Conecte' }, 409)).client.activity()).toEqual({ kind: 'error', message: 'Conecte' });
  });
});
