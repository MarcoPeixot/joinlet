import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRemoteApp } from './app';
import { createAccounts, authToken } from './accounts';
import { Database } from 'bun:sqlite';

const dir = await mkdtemp(join(tmpdir(), 'joinlet-profile-'));
let time = 1_700_000_000_000;
const token = authToken() + authToken();
const options = { publicUrl: 'https://app.joinlet.test', encryptionKey: 'b'.repeat(64), databasePath: join(dir, 'profile.sqlite'), accountDirectoryToken: token, now: () => time };
const remote = createRemoteApp(options);
const server = remote.app.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const owner = remote.auth.accounts.register('profile@example.test', 'synthetic-test-hash')!;
const other = remote.auth.accounts.register('other@example.test', 'synthetic-other-hash')!;
const session = remote.auth.createWebSession(owner.id), second = remote.auth.createWebSession(other.id);
const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKSsAAAAASUVORK5CYII=';
const request = (path: string, body?: unknown, cookie = session.token, csrf: string | null = session.csrf, origin = options.publicUrl) => fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { origin, 'content-type': 'application/json', cookie: 'joinlet_session=' + cookie, ...(csrf ? { 'x-strukt-csrf': csrf } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const directory = (query = '', credential = token) => fetch(base + '/api/internal/accounts' + query, { headers: { Authorization: 'Bearer ' + credential } });
try {
  assert.equal(owner.created_at, time); assert.equal(owner.last_login_at, null);
  assert.equal(remote.auth.accounts.get(owner.id)!.last_login_at, time);
  assert.equal((await request('/api/auth/profile', { name: 'New name', avatar }, session.token, null)).status, 401);
  assert.equal((await request('/api/auth/profile', { name: 'New name', avatar }, session.token, session.csrf, 'https://evil.test')).status, 403);
  for (const body of [{ name: '', avatar: null }, { name: 'a'.repeat(81), avatar: null }, { name: 'Bad\nName', avatar: null }, { name: 'Name', avatar: 'https://outside.test/a.png' }, { name: 'Name', avatar: 'data:image/svg+xml;base64,PHN2Zy8+' }, { name: 'Name', avatar: avatar + 'AAAA' }, { name: 'Name', avatar, id: other.id }, { name: 'Name', avatar, email: 'changed@example.test' }]) assert.equal((await request('/api/auth/profile', body)).status, 400);
  const saved = await request('/api/auth/profile', { name: '  Maria Silva  ', avatar });
  assert.equal(saved.status, 200); assert.deepEqual(await saved.json(), { id: owner.id, name: 'Maria Silva', email: owner.email, avatar });
  const me = await (await request('/api/auth/me')).json() as any;
  assert.equal(me.avatar, avatar); assert.equal(me.name, 'Maria Silva'); assert.equal(me.password_hash, undefined);
  assert.equal(remote.auth.webSession(session.token)!.login, 'Maria Silva', 'existing sessions use the current display name');
  assert.equal((await (await request('/api/auth/me', undefined, second.token)).json() as any).name, other.name, 'profile changes cannot affect another account');
  assert.equal((await directory('', 'incorrect')).status, 401);
  assert.equal((await request('/api/internal/accounts')).status, 401, 'a signed-in account is not an operator');
  assert.equal((await directory('?page=0')).status, 400);
  assert.equal((await directory('?q=' + 'a'.repeat(121))).status, 400);
  const result = await (await directory('?q=maria')).json() as any;
  assert.equal(result.total, 1); assert.equal(result.items[0].email, owner.email); assert.equal(result.items[0].avatar, avatar);
  assert.deepEqual(Object.keys(result.items[0]).sort(), ['id', 'name', 'email', 'avatar', 'createdAt', 'lastLoginAt', 'emailVerified', 'githubLogin', 'password', 'workspaces'].sort());
  assert.equal((await (await directory('?q=%25')).json() as any).total, 0, 'search metacharacters are literal');
  for (let i = 0; i < 26; i++) remote.auth.accounts.register(`page-${i}@example.test`, 'synthetic');
  const page1 = await (await directory()).json() as any, page2 = await (await directory('?page=2')).json() as any;
  assert.equal(page1.items.length, 25); assert.equal(page2.items.length, 3); assert.equal(page1.total, 28);
  assert(!page2.items.some((row: any) => page1.items.some((first: any) => first.id === row.id)));
  const persisted = new Database(options.databasePath);
  try { const reopened = createAccounts(persisted); assert.equal(reopened.get(owner.id)!.avatar, avatar); assert.equal(reopened.get(owner.id)!.name, 'Maria Silva'); } finally { persisted.close(); }
  assert.equal((await request('/api/auth/profile', { name: 'Maria Silva', avatar: null })).status, 200);
  assert.equal(remote.auth.accounts.get(owner.id)!.avatar, null);
  // Exercise upgrading an actual v1 schema, including idempotency and unknown historical dates.
  const legacy = new Database(':memory:');
  try {
    legacy.exec("CREATE TABLE records(kind TEXT,id TEXT,value TEXT,expires INTEGER); CREATE TABLE account_migrations(version INTEGER PRIMARY KEY); INSERT INTO account_migrations VALUES(1); CREATE TABLE accounts(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,github_id INTEGER UNIQUE,github_login TEXT,email TEXT UNIQUE COLLATE NOCASE,verified INTEGER NOT NULL DEFAULT 0,password_hash TEXT,session_version INTEGER NOT NULL DEFAULT 0); INSERT INTO accounts(id,name,email,password_hash) VALUES(99,'Legacy','legacy@example.test','synthetic');");
    const upgraded = createAccounts(legacy); assert.equal(upgraded.get(99)!.created_at, null); assert.equal(upgraded.get(99)!.name, 'Legacy'); assert.equal(upgraded.get(99)!.password_hash, 'synthetic'); createAccounts(legacy);
  } finally { legacy.close(); }
  console.log('Joinlet profile smoke passed: profile ownership, CSRF, raster validation, persistence, directory projection, search, pagination and v1 migration.');
} finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); remote.auth.close(); await rm(dir, { recursive: true, force: true }); }
