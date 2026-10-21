import { file } from 'bun';
import { ADMIN_PLAN, BETA_PLAN, SELF_HOSTED_PLAN } from '@strukt/workspace';
import { allowedOrigins } from './origin';
import { websocket } from 'hono/bun';
/**
 * Test-only entry (run with Bun, never started by the app): the owner's server routes (`/api/share/*`) and a real
 * collaboration host on loopback ports, with a clock the test can move and a fake tunnel (cloudflared is not run).
 * Used by `shareStack.test.ts` and the Playwright specs, which spawn it.
 */
import { join, resolve, sep } from 'node:path';
import { serve } from 'bun';
import { createApp } from './app';
import { createAuditLog } from './audit';
import { startCollaborationHost } from './collaborationHost';
import { createShare } from './share';

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Defina ${name}.`);
  return value;
};

const accessPlan = process.env.STRUKT_STACK_ADMIN === '1' ? ADMIN_PLAN : process.env.STRUKT_STACK_PLAN === 'cloud' ? BETA_PLAN : SELF_HOSTED_PLAN;
const root = env('STRUKT_STACK_ROOT');
const ownerPort = Number(env('STRUKT_STACK_OWNER_PORT'));
const collabPort = Number(env('STRUKT_STACK_COLLAB_PORT'));
const clockPort = Number(env('STRUKT_STACK_CLOCK_PORT'));
const dist = env('STRUKT_STACK_DIST');
const config = env('STRUKT_STACK_CONFIG');

let offset = 0;
const now = () => Date.now() + offset;
// The clock server moves the stack's clock forward: `POST /advance?ms=3600000`.
serve({
  port: clockPort,
  hostname: '127.0.0.1',
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/advance' && request.method === 'POST') offset += Number(url.searchParams.get('ms') ?? 0);
    return Response.json({ now: now() });
  },
});

const share = createShare({
  now,
  freePort: async () => collabPort,
  audit: (folder) => createAuditLog({ dir: join(config, 'audit'), root: folder, now }),
  start: ({ root: folder, port, audit }) => startCollaborationHost({
    accessPlan, root: folder, port, audit, now, hostname: '127.0.0.1', publicUrl: `http://127.0.0.1:${port}`, dist, databasePath: join(config, 'rooms.sqlite'),
    token: process.env.STRUKT_STACK_EDIT_TOKEN, viewToken: process.env.STRUKT_STACK_VIEW_TOKEN,
  }),
  tunnel: async () => ({ url: 'https://e2e-demo.trycloudflare.com', stop: async () => {} }),
});
let selected = root;
const app = createApp({ accessPlan, share, sharedWorkspaceDir: join(config, 'shared-workspaces'), allowedOrigins: allowedOrigins({}, ownerPort), selectedRepo: { get: () => selected, set: async (root) => { selected = root ?? ''; } } });
serve({ port: ownerPort, hostname: '127.0.0.1', websocket, async fetch(request, server) {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return app.fetch(request, server);
  const path = url.pathname === '/app/' ? 'app/index.html' : url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const target = resolve(dist, path);
  if (!target.startsWith(resolve(dist) + sep)) return new Response(null, { status: 404 });
  const asset = file(target);
  return await asset.exists() ? new Response(asset) : new Response(null, { status: 404 });
} });
console.log('stack-ready');
process.on('SIGTERM', () => void share.stop().finally(() => process.exit(0)));
process.on('SIGINT', () => void share.stop().finally(() => process.exit(0)));
