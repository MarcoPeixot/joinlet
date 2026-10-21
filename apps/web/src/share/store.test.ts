import { describe, expect, it, vi } from 'vitest';
import { createShareStore } from './store';
import type { ActivityReply, InviteView, ShareClient, ShareReply, ShareStatus } from './client';

const invite = (id: string, name: string): InviteView => ({ id, name, role: 'view', createdAt: 1, expiresAt: null, url: `http://192.168.0.5:8790/join?token=${id}`, publicUrl: null });
const active: ShareStatus = { active: true, root: '/repo', people: [{ name: 'Ana', color: '#3972dc' }], invites: [invite('e', 'Link para editar'), invite('v', 'Link só para ver')], tunnel: { active: false }, startedAt: 1 };
const ok = (status: ShareStatus): ShareReply => ({ kind: 'ok', status });

function setup(overrides: Partial<ShareClient> = {}) {
  const client: ShareClient = {
    status: vi.fn(async (): Promise<ShareReply> => ok({ active: false })),
    start: vi.fn(async (): Promise<ShareReply> => ok(active)),
    stop: vi.fn(async (): Promise<ShareReply> => ok({ active: false })),
    createInvite: vi.fn(async (): Promise<ShareReply> => ok(active)),
    revokeInvite: vi.fn(async (): Promise<ShareReply> => ok(active)),
    startTunnel: vi.fn(async (): Promise<ShareReply> => ok(active)),
    stopTunnel: vi.fn(async (): Promise<ShareReply> => ok(active)),
    activity: vi.fn(async (): Promise<ActivityReply> => ({ kind: 'ok', entries: [{ t: '2026-10-03T12:00:00.000Z', type: 'join', invite: 'Ana' }] })),
    ...overrides,
  };
  return { client, store: createShareStore({ client }) };
}

describe('share store', () => {
  it('starts inactive and idle', () => {
    expect(setup().store.getState()).toMatchObject({ status: { active: false }, open: false, busy: false, error: null, offline: false, activity: [] });
  });

  it('refresh reads the server status', async () => {
    const { store } = setup({ status: async () => ok(active) });
    await store.getState().refresh();
    expect(store.getState().status).toEqual(active);
  });

  it('says so when the local server is not running', async () => {
    const { store } = setup({ status: async () => ({ kind: 'offline', reason: 'O servidor local precisa estar rodando.' }) });
    await store.getState().refresh();
    expect(store.getState()).toMatchObject({ offline: true, error: 'O servidor local precisa estar rodando.' });
  });

  it('start shares the folder, then shows the links and clears an old error', async () => {
    const { store, client } = setup();
    store.setState({ error: 'antigo' });
    const pending = store.getState().start('/repo');
    expect(store.getState().busy).toBe(true);
    await pending;
    expect(client.start).toHaveBeenCalledWith('/repo');
    expect(store.getState()).toMatchObject({ status: active, busy: false, error: null });
  });

  it('start keeps the failure for the dialog and stays inactive', async () => {
    const { store } = setup({ start: async () => ({ kind: 'error', message: 'Frontend não compilado.' }) });
    await store.getState().start('/repo');
    expect(store.getState()).toMatchObject({ status: { active: false }, busy: false, error: 'Frontend não compilado.' });
  });

  it('stop ends the share', async () => {
    const { store, client } = setup({ status: async () => ok(active) });
    await store.getState().refresh();
    await store.getState().stop();
    expect(client.stop).toHaveBeenCalled();
    expect(store.getState().status).toEqual({ active: false });
  });

  it('opening the dialog refreshes the status and the activity', async () => {
    const { store, client } = setup();
    store.getState().setOpen(true);
    await vi.waitFor(() => expect(store.getState().activity).toHaveLength(1));
    expect(store.getState().open).toBe(true);
    expect(client.status).toHaveBeenCalled();
    expect(client.activity).toHaveBeenCalled();
  });

  it('creating an invite reports whether it worked and keeps the server\'s refusal', async () => {
    const { store, client } = setup();
    expect(await store.getState().createInvite({ name: 'Ana', role: 'edit', ttl: '1h' })).toBe(true);
    expect(client.createInvite).toHaveBeenCalledWith({ name: 'Ana', role: 'edit', ttl: '1h' });
    const refused = setup({ createInvite: async () => ({ kind: 'error', message: 'Informe o nome do convite.' }) });
    expect(await refused.store.getState().createInvite({ name: '', role: 'edit', ttl: '1h' })).toBe(false);
    expect(refused.store.getState().error).toBe('Informe o nome do convite.');
  });

  it('revoking, opening and closing public access go through the server and refresh the activity', async () => {
    const { store, client } = setup();
    await store.getState().revokeInvite('e');
    await store.getState().startTunnel('30m');
    await store.getState().stopTunnel();
    expect(client.revokeInvite).toHaveBeenCalledWith('e');
    expect(client.startTunnel).toHaveBeenCalledWith({ ttl: '30m' });
    expect(client.stopTunnel).toHaveBeenCalled();
    await vi.waitFor(() => expect(client.activity).toHaveBeenCalledTimes(3));
  });

  it('background status polling does not hide a failed public connection', async () => {
    const { store } = setup({ status: async () => ok(active), startTunnel: async () => ({ kind: 'error', message: 'Tunnel unavailable' }) });
    await store.getState().startTunnel('24h');
    await store.getState().refresh();
    expect(store.getState().error).toBe('Tunnel unavailable');
    expect(store.getState().status).toEqual(active);
  });

  it('does not refresh the activity after a failed action, and keeps its own error apart', async () => {
    const activity = vi.fn(async (): Promise<ActivityReply> => ({ kind: 'error', message: 'Conecte um repositório.' }));
    const { store } = setup({ revokeInvite: async () => ({ kind: 'error', message: 'Convite não encontrado.' }), activity });
    await store.getState().revokeInvite('x');
    expect(activity).not.toHaveBeenCalled();
    expect(store.getState().error).toBe('Convite não encontrado.');
    await store.getState().loadActivity();
    expect(store.getState()).toMatchObject({ activityError: 'Conecte um repositório.', error: 'Convite não encontrado.' });
  });
});
