import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { Database } from 'bun:sqlite';
import { authToken, createAccounts } from './accounts';
import { createRemoteApp } from './app';
import { createRemoteCollaboration } from './collaboration';
import { backupDatabase } from './backup';
import { invalidateRestoredAccess } from './recovery';
import { WebSocket } from 'ws';

const dir = await mkdtemp(join(tmpdir(), 'joinlet-password-test-'));
let time = Date.now();
const password = `  ${authToken()}!  `;
const replacement = '1234567!';
const options = { publicUrl: 'https://app.joinlet.test', siteUrl: 'https://joinlet.test', deploymentMode: 'cloud' as const,
  encryptionKey: 'a'.repeat(64), databasePath: join(dir, 'accounts.sqlite'), now: () => time, adminGithubIds: new Set([1]) };
const remote = createRemoteApp(options);
const collaboration = createRemoteCollaboration(options, remote.auth, remote.hosted);
const server = remote.app.listen(0, '127.0.0.1');
server.on('upgrade', (request, socket, head) => void collaboration.upgrade(request, socket, head));
await once(server, 'listening');
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const request = (path: string, body?: unknown, cookie?: string, csrf?: string, origin = options.publicUrl) => fetch(base + path, {
  redirect: 'manual', method: body === undefined ? 'GET' : 'POST', headers: {
    host: new URL(options.publicUrl).host, ...(body !== undefined ? { origin, 'content-type': 'application/json' } : {}),
    ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-strukt-csrf': csrf } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const login = async (email: string, secret = password) => {
  const response = await request('/api/auth/login', { email, password: secret });
  assert.equal(response.status, 200, 'password sign-in');
  const header = response.headers.getSetCookie().find(c => c.startsWith('joinlet_session='))!;
  assert.match(header, /HttpOnly/); assert.match(header, /Secure/); assert.match(header, /SameSite=Lax/); assert(!/Domain=/i.test(header));
  const cookie = header.split(';')[0]!;
  const sessionResponse = await request('/api/remote/session', undefined, cookie);
  assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json() as { repo: string; csrf: string; beta: { plan: { id: string } } };
  return { cookie, ...session };
};
const sockets: WebSocket[] = [];
try {
  assert.deepEqual(await (await request('/api/auth/config')).json(), { password: true, github: false });
  assert.equal((await request('/auth/login')).status, 503);
  assert.equal((await request('/api/auth/register', { email: 'owner@example.test', password }, undefined, undefined, 'https://attacker.test')).status, 403);
  assert.equal((await request('/api/auth/register', { email: 'owner@example.test', password: 'short' })).status, 400);
  assert.equal((await request('/api/auth/register', { email: 'owner@example.test', password: 'a'.repeat(129) })).status, 400);
  for (const invalid of ['123456!', '12345678', 'abcdefgh ']) assert.equal((await request('/api/auth/register', { email: 'owner@example.test', password: invalid })).status, 400, 'new password policy');
  time += 60_001;
  assert.equal((await request('/api/auth/register', { email: ' Owner@Example.Test ', password })).status, 200);
  const account = remote.auth.accounts.byEmail('owner@example.test')!;
  assert(account); assert.equal(account.github_id, null); assert.equal(account.verified, 0);
  assert.match(account.password_hash!, /^\$argon2id\$/);
  const originalHash = account.password_hash;
  assert.equal((await request('/api/auth/register', { email: 'owner@example.test', password: replacement })).status, 200);
  assert.equal(remote.auth.accounts.get(account.id)!.password_hash, originalHash, 'duplicate registration preserves credentials');
  const wrong = await request('/api/auth/login', { email: 'owner@example.test', password: replacement });
  const missing = await request('/api/auth/login', { email: 'missing@example.test', password: replacement });
  assert.equal(wrong.status, 401); assert.equal(missing.status, 401); assert.deepEqual(await wrong.json(), await missing.json());
  assert.equal((await request('/api/auth/login', { email: 'owner@example.test', password: password.trim() })).status, 401, 'passwords are never trimmed');
  const owner = await login('OWNER@example.test');
  const secondOwnerSession = await login('owner@example.test');
  assert.equal(owner.repo, secondOwnerSession.repo);
  assert.equal(owner.beta.plan.id, 'free-beta', 'a password ID colliding with a GitHub admin ID grants no privilege');
  const github = remote.auth.accounts.github(1, 'verified-github-admin');
  assert.notEqual(github.id, account.id); assert.equal(remote.auth.beta.accountPlan(github.id).id, 'administrator');
  assert.equal((await request('/api/auth/register', { email: 'other@example.test', password })).status, 200);
  const other = await login('other@example.test');
  assert.notEqual(owner.repo, other.repo);
  assert.equal((await request(`/api/remote/workspace?repo=${encodeURIComponent(owner.repo)}`, undefined, other.cookie)).status, 403);
  const write = (data: unknown) => request('/api/remote/workspace', { repo: owner.repo, ...data as object }, owner.cookie, owner.csrf);
  assert.equal((await write({ path: 'docs/notes.md', text: '# Password owner', expected: null })).status, 200);
  assert.equal((await request('/api/settings', { provider: 'openai', keys: { openai: 'test-only-' + authToken() }, openai: { baseUrl: 'https://api.openai.com/v1' } }, owner.cookie, owner.csrf)).status, 200);
  assert.notDeepEqual(await (await request('/api/settings', undefined, owner.cookie)).json(), await (await request('/api/settings', undefined, other.cookie)).json());
  const share = await request('/api/share/invites', { name: 'Test guest', role: 'edit', ttl: '24h' }, owner.cookie, owner.csrf);
  assert.equal(share.status, 200);
  const invite = await share.json() as { invites: { url: string }[] };
  const inviteUrl = invite.invites[0]?.url;
  assert(inviteUrl, 'a guest invitation is issued');
  const joined = await request(new URL(inviteUrl).pathname);
  const guestCookie = joined.headers.getSetCookie().find(c => c.startsWith('joinlet_guest='))!.split(';')[0]!;
  const snapshot = join(dir, 'snapshot.sqlite');
  await backupDatabase(options.databasePath, snapshot);
  const socket = new WebSocket(base.replace('http:', 'ws:') + `/api/collaboration?repo=${encodeURIComponent(owner.repo)}&kind=doc&slug=notes`, { headers: { host: new URL(options.publicUrl).host, cookie: owner.cookie, origin: options.publicUrl } });
  sockets.push(socket);
  await once(socket, 'open');
  assert.equal((await request('/api/auth/change-password', { currentPassword: password, password: replacement }, owner.cookie)).status, 401);
  const closed = once(socket, 'close');
  assert.equal((await request('/api/auth/change-password', { currentPassword: password, password: replacement }, owner.cookie, owner.csrf)).status, 200);
  await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(Error('Revoked session socket stayed connected.')), 4000).unref())]);
  assert.equal((await request('/api/remote/session', undefined, owner.cookie)).status, 401);
  assert.equal((await request('/api/remote/session', undefined, secondOwnerSession.cookie)).status, 401);
  time += 16 * 60_000;
  assert.equal((await request('/api/auth/login', { email: 'owner@example.test', password })).status, 401);
  const changed = await login('owner@example.test', replacement);
  assert.equal(changed.repo, owner.repo);
  assert.equal((await request('/api/auth/logout', {}, changed.cookie, changed.csrf)).status, 200);
  assert.equal((await request('/api/remote/session', undefined, changed.cookie)).status, 401);
  time += 31 * 24 * 60 * 60_000;
  assert.equal((await request('/api/remote/session', undefined, other.cookie)).status, 401, 'expired account sessions fail closed');
  time = Date.now();
  for (let i = 0; i < 10; i++) assert.equal((await request('/api/auth/login', { email: 'rate@example.test', password })).status, 401);
  assert.equal((await request('/api/auth/login', { email: 'rate@example.test', password })).status, 429);
  const restored = new Database(snapshot);
  try {
    const oldHash = (restored.query('SELECT password_hash FROM accounts WHERE id=?').get(account.id) as { password_hash: string }).password_hash;
    assert(await Bun.password.verify(password, oldHash));
    invalidateRestoredAccess(restored);
    assert.equal((restored.query('SELECT COUNT(*) AS n FROM records WHERE kind <> ?').get('client') as { n: number }).n, 0);
    assert.equal((restored.query('SELECT COUNT(*) AS n FROM hosted_guests').get() as { n: number }).n, 0);
    assert.equal((restored.query('SELECT COUNT(*) AS n FROM hosted_invites WHERE revoked=0').get() as { n: number }).n, 0);
    assert.match((restored.query('SELECT text FROM hosted_files WHERE workspace=? AND path=?').get(owner.repo, 'docs/notes.md') as { text: string }).text, /Password owner/);
    assert(restored.query('SELECT value FROM hosted_settings WHERE user=?').get(account.id));
  } finally { restored.close(); }
  time += 16 * 60_000;
  assert.equal((await request('/api/auth/register', { email: 'short@example.test', password: replacement })).status, 200, 'eight-character signup');
  await login('short@example.test', replacement);
  const legacyPassword = 'ExistingPasswordWithoutPunctuation';
  remote.auth.accounts.register('legacy@example.test', await Bun.password.hash(legacyPassword, { algorithm: 'argon2id', memoryCost: 65536, timeCost: 2 }));
  const legacySession = await login('legacy@example.test', legacyPassword);
  assert.equal((await request('/api/auth/change-password', { currentPassword: legacyPassword, password: '12345678' }, legacySession.cookie, legacySession.csrf)).status, 400);
  assert.equal((await request('/api/remote/session', undefined, legacySession.cookie)).status, 200, 'invalid replacement preserves sessions');
  assert.equal((await request('/api/auth/change-password', { currentPassword: legacyPassword, password: replacement }, legacySession.cookie, legacySession.csrf)).status, 200, 'old password remains usable for change confirmation');
  assert.equal((await request('/api/remote/session', undefined, legacySession.cookie)).status, 401);
  await login('legacy@example.test', replacement);
  const legacy = new Database(':memory:');
  try {
    legacy.exec("CREATE TABLE records(kind TEXT,id TEXT,value TEXT,expires INTEGER); CREATE TABLE beta_workspaces(repo TEXT,owner TEXT,created INTEGER); CREATE TABLE hosted_workspaces(owner INTEGER); CREATE TABLE hosted_settings(user INTEGER,value TEXT);");
    legacy.query('INSERT INTO beta_workspaces VALUES (?,?,?)').run('org/repo', '77', time);
    legacy.query('INSERT INTO hosted_workspaces VALUES (?)').run(77);
    legacy.query('INSERT INTO hosted_settings VALUES (?,?)').run(77, 'unchanged-encrypted-settings');
    const migrated = createAccounts(legacy);
    assert.equal(migrated.github(77, 'legacy-owner').id, 77);
    const local = migrated.register('new@example.test', originalHash!)!;
    assert.notEqual(migrated.github(local.id, 'different-github-user').id, local.id);
    assert.equal((legacy.query('SELECT value FROM hosted_settings WHERE user=77').get() as { value: string }).value, 'unchanged-encrypted-settings');
    const count = (legacy.query('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n;
    createAccounts(legacy);
    assert.equal((legacy.query('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n, count);
  } finally { legacy.close(); }
  console.log('Joinlet password smoke passed: signup, exact passwords, sessions, account isolation, admin boundaries, CSRF, throttling, WebSocket revocation, backup recovery and legacy migration.');
} finally {
  for (const socket of sockets) socket.terminate();
  await collaboration.shutdown(); server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  remote.auth.close(); await rm(dir, { recursive: true, force: true });
}
