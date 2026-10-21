import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRemoteApp } from './app';

const dir = await mkdtemp(join(tmpdir(), 'joinlet-domains-'));
const remote = createRemoteApp({ publicUrl: 'https://app.joinlet.co', siteUrl: 'https://joinlet.co', githubClientId: 'test', githubClientSecret: 'test', encryptionKey: 'a'.repeat(64), databasePath: join(dir, 'test.sqlite'), fetch: (async input => {
  const path = new URL(String(input)).pathname;
  if (path === '/login/oauth/access_token') return Response.json({ access_token: 'test' });
  if (path === '/user') return Response.json({ id: 123, login: 'test' });
  throw Error(`Unexpected fetch ${path}`);
}) as typeof fetch });
const server = remote.app.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert(address && typeof address !== 'string');
const get = (path: string, host: string, cookie?: string) => new Promise<{ status: number; body: string; headers: import('node:http').IncomingHttpHeaders }>((resolve, reject) => {
  const call = request({ hostname: '127.0.0.1', port: address.port, path, headers: { host, ...(cookie ? { cookie } : {}) } }, response => {
    let body = ''; response.setEncoding('utf8'); response.on('data', chunk => body += chunk);
    response.on('end', () => resolve({ status: response.statusCode!, body, headers: response.headers }));
  });
  call.on('error', reject); call.end();
});
try {
  const landing = await get('/', 'joinlet.co');
  assert.equal(landing.status, 200);
  assert.match(landing.body, /href="https:\/\/app.joinlet.co\/"/);
  assert.doesNotMatch(landing.body, /href="\/app\/"/);
  const app = await get('/', 'app.joinlet.co');
  assert.equal(app.status, 200);
  assert.match(app.body, /strukt-mode" content="remote/);
  assert.match(app.body, /joinlet-app-url" content="https:\/\/app.joinlet.co\//);
  assert.equal(app.headers['x-robots-tag'], 'noindex, nofollow');
  const docs = await get('/docs/en/deployment/', 'joinlet.co');
  assert.equal(docs.status, 200);
  assert.match(docs.body, /href="https:\/\/app.joinlet.co\/\?lang=en"/);
  assert.match(docs.body, /rel="canonical" href="https:\/\/joinlet.co\/docs\/en\/deployment\//);
  assert.equal((await get('/api/remote/session', 'joinlet.co')).status, 404);
  assert.equal((await get('/api/remote/session', 'app.joinlet.co')).status, 401);
  assert.equal((await get('/docs/en/', 'app.joinlet.co')).headers.location, 'https://joinlet.co/docs/en/');
  assert.match((await get('/robots.txt', 'app.joinlet.co')).body, /Disallow: \/\n/);
  const login = await get('/auth/login', 'app.joinlet.co');
  const url = new URL(login.headers.location!);
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.joinlet.co/github/callback');
  const flow = login.headers['set-cookie']!.find(value => value.startsWith('joinlet_oauth='))!.split(';')[0];
  const callback = await get(`/github/callback?state=${url.searchParams.get('state')}&code=test`, 'app.joinlet.co', flow);
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.location, '/');
  const cookies = callback.headers['set-cookie']!;
  assert(cookies.some(value => value.startsWith('joinlet_session=')));
  for (const cookie of cookies) { assert.doesNotMatch(cookie, /Domain=/i); if (!cookie.includes('Expires=Thu, 01 Jan 1970')) { assert.match(cookie, /Secure/i); assert.match(cookie, /HttpOnly/i); } }
  const sessionCookie = cookies.filter(value => !value.includes('Expires=Thu, 01 Jan 1970')).map(value => value.split(';')[0]).join('; ');
  assert.equal((await get('/api/remote/session', 'app.joinlet.co', sessionCookie)).status, 200);
  assert.equal((await get('/api/remote/session', 'joinlet.co', sessionCookie)).status, 404);
  console.log('Joinlet split domains: landing, app, docs, redirects, isolated sessions and OAuth passed');
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  remote.auth.close(); await rm(dir, { recursive: true, force: true });
}
