import { describe, expect, it, vi } from 'vitest';
import { createGithubAuth } from './githubAuth';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('GitHub device authorization', () => {
  it('keeps device codes and tokens on the server, respects polling intervals, and verifies the account', async () => {
    let now = 1_000_000;
    let saved: string | null = null;
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, string>;
      if (String(url).endsWith('/login/device/code')) return json({ device_code: 'secret-device', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 });
      if (String(url).endsWith('/login/oauth/access_token') && body.grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
        return json(body.device_code === 'secret-device' && now < 1_010_000 ? { error: 'authorization_pending' } : { access_token: 'secret-access', refresh_token: 'secret-refresh', expires_in: 28800, refresh_token_expires_in: 15897600 });
      }
      return json({ id: 42, login: 'marco' });
    });
    const auth = createGithubAuth({ clientId: 'client-id', fs: { read: async () => saved, write: async (text) => { saved = text; } }, fetch, now: () => now, makeId: () => 'flow-id' });
    await auth.load();

    const started = await auth.startDeviceFlow();
    expect(started).toEqual({ ok: true, flow: { id: 'flow-id', userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device', intervalSeconds: 5, expiresAt: 1_900_000 } });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ client_id: 'client-id', scope: 'repo offline_access' });
    if (!started.ok) throw new Error(started.error);

    expect(await auth.pollDeviceFlow(started.flow.id)).toEqual({ state: 'pending', retryAfter: 5 });
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 5_000;
    expect(await auth.pollDeviceFlow(started.flow.id)).toEqual({ state: 'pending', retryAfter: 5 });
    now += 5_000;
    expect(await auth.pollDeviceFlow(started.flow.id)).toEqual({ state: 'connected', login: 'marco' });
    expect(auth.view()).toEqual({ configured: true, connected: true, login: 'marco' });
    expect(saved).toContain('secret-access');
    expect(JSON.stringify(auth.view())).not.toContain('secret-access');
  });

  it('refreshes an expiring token and rotates the stored refresh token', async () => {
    const now = 2_000_000;
    let saved = JSON.stringify({ version: 1, accessToken: 'old-access', refreshToken: 'old-refresh', accessExpiresAt: now - 1, refreshExpiresAt: now + 10_000, login: 'marco' });
    const fetch = vi.fn(async () => json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 28800, refresh_token_expires_in: 15897600 }));
    const auth = createGithubAuth({ clientId: 'client-id', fs: { read: async () => saved, write: async (text) => { saved = text ?? ''; } }, fetch, now: () => now });
    await auth.load();

    expect(await auth.token()).toBe('new-access');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(saved)).toMatchObject({ accessToken: 'new-access', refreshToken: 'new-refresh', login: 'marco' });
  });

  it('requires an OAuth app client ID before starting login', async () => {
    const auth = createGithubAuth({ fs: { read: async () => null, write: async () => {} }, fetch: vi.fn() });
    expect(await auth.startDeviceFlow()).toMatchObject({ ok: false, status: 503 });
  });
});
