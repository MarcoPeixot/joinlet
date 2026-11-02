import assert from 'node:assert/strict';
import { createRemoteApp } from './app';
import { privateValues } from './secrets';

await (async () => {
  const remote = createRemoteApp({ publicUrl: 'http://127.0.0.1', encryptionKey: '0'.repeat(64), databasePath: ':memory:' });
  const account = remote.auth.accounts.register('configuration@example.test', 'synthetic')!;
  const session = remote.auth.createWebSession(account.id);
  const server = remote.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const headers = { cookie: `joinlet_session=${session.token}`, 'x-strukt-csrf': session.csrf, 'content-type': 'application/json' };
  try {
    assert.equal((await (await fetch(base + '/api/repositories', { headers })).json()).githubConfigured, false);
    for (const [path, method] of [['/api/repositories/github/authorize', 'POST'], ['/api/repositories/github/repos', 'GET']] as const) {
      const response = await fetch(base + path, { method, headers, ...(method === 'POST' ? { body: '{}' } : {}) });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { code: 'github_not_configured', error: 'GitHub repository connections are not configured on this Joinlet server.' });
    }
    assert.deepEqual(remote.auth.database.query('SELECT count(*) AS n FROM repository_oauth').get(), { n: 0 });
    assert.equal((await fetch(base + '/api/repositories/github/authorize', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status, 401);
  } finally {
    remote.drain(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve())); remote.auth.close();
  }
})();

await (async () => {
  const remote = createRemoteApp({ publicUrl: 'http://127.0.0.1', encryptionKey: '0'.repeat(64), databasePath: ':memory:', githubClientId: 'synthetic', githubClientSecret: 'synthetic', githubAppSlug: 'joinlet-test', fetch: Object.assign(async () => Response.json({ error: 'synthetic upstream details' }, { status: 503 }), { preconnect: fetch.preconnect }) });
  const account = remote.auth.accounts.register('authorization@example.test', 'synthetic')!;
  const session = remote.auth.createWebSession(account.id);
  const server = remote.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const headers = { cookie: `joinlet_session=${session.token}`, 'x-strukt-csrf': session.csrf, 'content-type': 'application/json' };
  try {
    const info = await (await fetch(base + '/api/repositories', { headers })).json();
    assert.equal(info.githubConfigured, true); assert.equal(info.githubConnected, false); assert.equal(info.githubInstallUrl, 'https://github.com/apps/joinlet-test/installations/new');
    const response = await fetch(base + '/api/repositories/github/repos', { headers });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'github_authorization_required');
    const authorization = await fetch(base + '/api/repositories/github/authorize', { method: 'POST', headers, body: '{}' });
    assert.equal(authorization.status, 200);
    const url = new URL((await authorization.json()).url);
    assert.equal(url.origin, 'https://github.com');
    assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1/github/callback');
    const credentials = privateValues('0'.repeat(64)).seal(JSON.stringify({ token: 'synthetic', refreshToken: 'synthetic-refresh', expires: 1 }), `repository-github:${account.id}`);
    remote.auth.database.query('INSERT INTO repository_credentials(owner,value,version) VALUES (?,?,?)').run(account.id, credentials, account.session_version);
    const unavailable = await fetch(base + '/api/repositories/github/repos', { headers });
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { error: 'Joinlet could not complete this repository request. Check the connection and permissions.' });
  } finally {
    remote.drain(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve())); remote.auth.close();
  }
})();

console.log('Joinlet GitHub authorization smoke passed');
