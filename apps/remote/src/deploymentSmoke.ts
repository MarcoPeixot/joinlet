import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { createRemoteApp } from './app';
import { backupDatabase } from './backup';

const dir = await mkdtemp(join(tmpdir(), 'joinlet-deploy-smoke-'));
let pullCreated = false, branchCreated = false;
const mockGithub = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  const path = url.pathname;
  if (url.hostname === 'github.com' && path === '/login/oauth/access_token') return Response.json({ access_token: 'github-test-only', expires_in: 3600 });
  if (path === '/user') return Response.json({ id: 42, login: 'test-user' });
  if (path === '/user/repos') return Response.json([{ full_name: 'org/project', permissions: { push: true } }]);
  if (path === '/repos/org/project') return Response.json({ default_branch: 'main', permissions: { push: true } });
  if (path.endsWith('/pulls')) {
    if (init?.method === 'POST') { pullCreated = true; return Response.json({ html_url: 'https://github.com/org/project/pull/1' }); }
    return Response.json(pullCreated ? [{ html_url: 'https://github.com/org/project/pull/1', body: '<!-- strukt:remote -->', head: { ref: 'strukt/shared', repo: { full_name: 'org/project' } } }] : []);
  }
  if (path.includes('/git/ref/heads/')) return path.endsWith('/main') || branchCreated ? Response.json({ object: { sha: 'abcdef123456' } }) : Response.json({}, { status: 404 });
  if (path.endsWith('/git/refs') && init?.method === 'POST') { branchCreated = true; return Response.json({}); }
  if (init?.method === 'POST' || init?.method === 'PATCH') return Response.json({ sha: 'abcdef123457' });
  if (path.includes('/git/commits/')) return Response.json({ tree: { sha: 'tree' } });
  if (path.includes('/git/trees/')) return Response.json({ tree: [] });
  throw new Error(`Unexpected test request: ${path}`);
}) as typeof fetch;
const remote = createRemoteApp({ publicUrl: 'http://localhost:8788', githubClientId: 'test-client', githubClientSecret: 'test-secret', encryptionKey: 'a'.repeat(64), databasePath: join(dir, 'remote.sqlite'), fetch: mockGithub, trustProxyHops: 0 });
const server = remote.app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;
const request = (path: string, init?: RequestInit) => fetch(`${base}${path}`, { redirect: 'manual', ...init });
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
try {
  for (const path of ['/health', '/ready', '/', '/app/', '/docs/en/deployment/']) assert.equal((await request(path)).status, 200, path);
  assert.match(await (await request('/app/')).text(), /strukt-mode.*remote/);
  assert.equal((await request('/api/remote/session')).status, 401);
  assert.equal((await request('/mcp', json({}))).status, 401);
  assert.equal((await request('/.env')).status, 404);
  assert.equal((await request('/api/settings')).status, 401); // Hosted AI requires a verified personal session.
  const malformed = await request('/api/remote/workspace', { ...json({}), body: '{broken' });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: 'Invalid JSON body.' });
  assert.equal((await request('/api/remote/workspace', json({ text: 'x'.repeat(1_100_000) }))).status, 413);
  const registration = await request('/register', json({ redirect_uris: ['http://localhost:43210/callback'], client_name: 'Joinlet smoke', token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }));
  assert.equal(registration.status, 201);
  const client = await registration.json() as { client_id: string };
  const verifier = 'test-only-verifier-'.repeat(4);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: 'http://localhost:43210/callback', response_type: 'code', code_challenge_method: 'S256', code_challenge: challenge, scope: 'strukt', resource: remote.auth.resource });
  const authorize = await request(`/authorize?${query}`);
  assert.equal(authorize.status, 302);
  const state = new URL(authorize.headers.get('location')!).searchParams.get('state')!;
  assert.equal((await request(`/github/callback?code=test&state=${state}`)).status, 200);
  const selected = await request('/github/select', json({ state, repo: 'org/project' }));
  assert.equal(selected.status, 302);
  const session = selected.headers.getSetCookie().find(value => value.startsWith('strukt_session='))!.split(';')[0]!;
  assert.match(selected.headers.get('set-cookie')!, /HttpOnly/);
  const code = new URL(selected.headers.get('location')!).searchParams.get('code')!;
  const tokenBody = { grant_type: 'authorization_code', client_id: client.client_id, code, redirect_uri: 'http://localhost:43210/callback' };
  assert.equal((await request('/token', json({ ...tokenBody, code_verifier: 'wrong' }))).status, 400);
  const token = await request('/token', json({ ...tokenBody, code_verifier: verifier }));
  assert.equal(token.status, 200);
  const tokens = await token.json() as { access_token: string; refresh_token: string };
  assert.equal((await request('/token', json({ ...tokenBody, code_verifier: verifier }))).status, 400);
  const sessionResponse = await request('/api/remote/session', { headers: { cookie: session } });
  assert.equal(sessionResponse.status, 200);
  const sessionBody = await sessionResponse.json() as { repo: string; csrf: string };
  assert.equal(sessionBody.repo, 'org/project');
  assert.equal(sessionResponse.headers.get('cache-control'), 'no-store');
  const refreshBody = { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token };
  assert.equal((await request('/token', json(refreshBody))).status, 200);
  assert.equal((await request('/token', json(refreshBody))).status, 400);
  const forbidden = await request('/api/remote/disconnect', { ...json({}), headers: { 'content-type': 'application/json', cookie: session } });
  assert.equal(forbidden.status, 401);
  const logout = await request('/api/remote/disconnect', { ...json({}), headers: { 'content-type': 'application/json', cookie: session, 'x-strukt-csrf': sessionBody.csrf } });
  assert.equal(logout.status, 200);
  assert.equal((await request('/api/remote/session', { headers: { cookie: session } })).status, 401);
  await assert.rejects(() => remote.auth.provider.verifyAccessToken(tokens.access_token));
  // An existing repository owner signs in from the website without starting a new MCP authorization.
  const webLogin = await request('/auth/login');
  const webState = new URL(webLogin.headers.get('location')!).searchParams.get('state')!;
  const flowCookie = webLogin.headers.getSetCookie().find(value => value.startsWith('joinlet_oauth='))!.split(';')[0]!;
  const webCallback = await request(`/github/callback?state=${webState}&code=test`, {headers:{cookie:flowCookie}});
  assert.equal(webCallback.status, 302);
  const repoCookie = webCallback.headers.getSetCookie().find(value => value.startsWith('strukt_session='))!.split(';')[0]!;
  const webAccountCookie = webCallback.headers.getSetCookie().find(value => value.startsWith('joinlet_session='))!.split(';')[0]!;
  const webSession = await request('/api/remote/session', {headers:{cookie:`${repoCookie}; ${webAccountCookie}`}});
  assert.equal(webSession.status, 200);
  assert.equal((await webSession.json() as {repo:string}).repo, 'org/project');
  // Snapshot includes committed WAL data and restores independently of the running database.
  remote.auth.beta.claim(43, 'org/backup');
  const snapshot = join(dir, 'backup.sqlite');
  await backupDatabase(join(dir, 'remote.sqlite'), snapshot);
  await assert.rejects(() => backupDatabase(join(dir, 'remote.sqlite'), snapshot));
  const restored = new Database(snapshot, { readonly: true });
  assert.equal((restored.query('SELECT owner FROM beta_workspaces WHERE repo = ?').get('org/backup') as { owner: string }).owner, '43');
  restored.close();
  assert((await readFile(snapshot)).length > 0);
  remote.drain();
  assert.equal((await request('/ready')).status, 503);
  assert.equal((await request('/health')).status, 200);
  assert.equal((await request('/api/remote/session')).status, 503);
  console.log('Joinlet remote smoke: HTTP, OAuth/PKCE, token replay, CSRF, revocation, backup/restore and readiness passed (GitHub simulated).');
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  remote.auth.close();
  await rm(dir, { recursive: true, force: true });
}
