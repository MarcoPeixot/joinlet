import { request } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { expect, it } from 'vitest';
import { webHosting } from './webHosting';

it('routes the public site and app with fixed origins, preserving legacy queries', async () => {
  const hosting = webHosting('https://app.joinlet.co', 'https://joinlet.co');
  const app = express();
  app.use(hosting.gate);
  app.use((_req, res) => res.send('passed'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No port');
  const get = (path: string, host: string, method = 'GET') => new Promise<{status: number; headers: Headers}>((resolve, reject) => {
    const call = request({ hostname: '127.0.0.1', port: address.port, path, method, headers: { host, 'x-forwarded-host': 'evil.test' } }, response => {
      response.resume(); response.on('end', () => resolve({ status: response.statusCode!, headers: new Headers({ location: response.headers.location ?? '' }) }));
    });
    call.on('error', reject); call.end();
  });
  try {
    expect((await get('/', 'joinlet.co')).status).toBe(200);
    expect((await get('/', 'app.joinlet.co')).status).toBe(200);
    expect((await get('/', 'evil.test')).status).toBe(421);
    expect((await get('/ready', '127.0.0.1')).status).toBe(200);
    expect((await get('/app/?lang=pt-BR&settings=ai', 'joinlet.co')).headers.get('location')).toBe('https://app.joinlet.co/?lang=pt-BR&settings=ai');
    expect((await get('/app/index.html?example=orders', 'app.joinlet.co')).headers.get('location')).toBe('https://app.joinlet.co/?example=orders');
    expect((await get('/join/secret?x=1', 'joinlet.co')).headers.get('location')).toBe('https://app.joinlet.co/join/secret?x=1');
    expect((await get('/docs/en/deployment/?a=1', 'app.joinlet.co')).headers.get('location')).toBe('https://joinlet.co/docs/en/deployment/?a=1');
    for (const path of ['/api/remote/session', '/mcp', '/register', '/.well-known/oauth-authorization-server']) expect((await get(path, 'joinlet.co')).status).toBe(404);
    expect((await get('/auth/login', 'joinlet.co', 'POST')).status).toBe(404);
    expect((await get('/api/remote/session', 'app.joinlet.co')).status).toBe(200);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

it('keeps combined local hosting and ignores forwarded hosts for origin selection', async () => {
  const hosting = webHosting('http://localhost:8788');
  expect(hosting.split).toBe(false);
  expect(hosting.isAppHost('evil.test')).toBe(false);
  const response = await hosting.page(new URL('../../web/', import.meta.url).pathname, 'index.html');
  expect(response).toContain('name="joinlet-app-url" content="/app/"');
});

it('rewrites static landing and docs CTAs and supplies runtime links without rebuilding', async () => {
  const hosting = webHosting('https://app.example.test', 'https://example.test');
  const source = await hosting.page(new URL('../../web/', import.meta.url).pathname, 'index.html');
  expect(source).toContain('href="https://app.example.test/"');
  expect(source).not.toContain('href="/app/"');
  expect(source).toContain('name="joinlet-site-url" content="https://example.test/"');
  expect(source).toContain('href="https://example.test/"');
});

it('adds hosted analytics only when explicitly configured and identifies the app surface', async () => {
  const root = new URL('../../web/', import.meta.url).pathname;
  expect(await webHosting('http://localhost:8788').page(root, 'app/index.html')).not.toContain('name="joinlet-analytics"');
  const configured = await webHosting('http://localhost:8788', undefined, '/telemetry').page(root, 'app/index.html');
  expect(configured).toContain('name="joinlet-analytics" content="/telemetry"');
  expect(configured).toContain('name="joinlet-analytics-source" content="editor"');
});

it("marks optional editor entry without changing site pages or default hosting",async()=>{const root=new URL("../../web/",import.meta.url).pathname;const optional=webHosting("http://localhost:8788",undefined,undefined,true);expect(await optional.page(root,"app/index.html")).toContain('name="joinlet-optional-login" content="true"');expect(await optional.page(root,"index.html")).not.toContain("joinlet-optional-login");expect(await webHosting("http://localhost:8788").page(root,"app/index.html")).not.toContain("joinlet-optional-login");});
