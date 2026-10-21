import { describe, expect, it, vi } from 'vitest';
import type { ShareClient } from './client';
import { lazyShareClient } from './lazyClient';

const ok = { kind: 'ok' as const, status: { active: false as const } };
function fake(): ShareClient {
  return {
    status: vi.fn(async () => ok), start: vi.fn(async () => ok), stop: vi.fn(async () => ok), createInvite: vi.fn(async () => ok),
    revokeInvite: vi.fn(async () => ok), startTunnel: vi.fn(async () => ok), stopTunnel: vi.fn(async () => ok),
    activity: vi.fn(async () => ({ kind: 'ok' as const, entries: [] })),
  };
}

describe('lazy share client', () => {
  it('loads the real client once, on first use, and forwards every call', async () => {
    const real = fake();
    const load = vi.fn(async () => real);
    const client = lazyShareClient(load);
    expect(load).not.toHaveBeenCalled();
    await client.status();
    await client.start('/repo');
    await client.stop();
    await client.createInvite({ name: 'Ana', role: 'view', ttl: '1h' });
    await client.revokeInvite('x');
    await client.startTunnel({ ttl: '2h' });
    await client.stopTunnel();
    expect(await client.activity()).toEqual({ kind: 'ok', entries: [] });
    expect(load).toHaveBeenCalledTimes(1);
    expect(real.start).toHaveBeenCalledWith('/repo');
    expect(real.createInvite).toHaveBeenCalledWith({ name: 'Ana', role: 'view', ttl: '1h' });
    expect(real.revokeInvite).toHaveBeenCalledWith('x');
    expect(real.startTunnel).toHaveBeenCalledWith({ ttl: '2h' });
  });

  it('answers "offline" (never throws) when the chunk cannot load, and tries again next time', async () => {
    const real = fake();
    const load = vi.fn<() => Promise<ShareClient>>().mockRejectedValueOnce(new Error('chunk')).mockResolvedValue(real);
    const client = lazyShareClient(load);
    expect(await client.status()).toMatchObject({ kind: 'offline' });
    expect(await client.status()).toEqual(ok);
    expect(load).toHaveBeenCalledTimes(2);
    const broken = lazyShareClient(async () => { throw new Error('chunk'); });
    expect(await broken.activity()).toMatchObject({ kind: 'offline' });
  });
});
