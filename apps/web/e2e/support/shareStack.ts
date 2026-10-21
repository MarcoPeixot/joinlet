import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DIST, assertFreshDist, diagramJson, freePort } from './collabHost';

export interface ShareStack {
  /** The owner's server routes (`/api/share/*`): what the app's Compartilhar dialog talks to. */
  owner: string;
  /** The collaboration host guests open invites on. */
  collab: string;
  root: string;
  /** Calls an owner route (GET when there is no body) and returns its JSON. */
  api<T = Record<string, unknown>>(path: string, body?: unknown): Promise<{ status: number; body: T }>;
  /** Moves the stack's clock forward (invites, attempt window and audit read it). */
  advance(ms: number): Promise<void>;
  dispose(): Promise<void>;
}

export interface StackInvite { id: string; name: string; role: string; url: string; publicUrl: string | null }
export interface StackStatus { active: boolean; invites: StackInvite[]; people: Array<{ name: string }>; tunnel: { active: boolean; url?: string } }

/**
 * The owner's `/api/share` routes plus a real collaboration host over a temp workspace (apps/server/src/shareStack.ts,
 * run with Bun): revocation, expiry (a clock the test moves) and roles run against the real thing. The tunnel is a fake
 * (cloudflared is not run). Needs the web build (see `collabHost.ts`). Always `dispose()` it in `afterAll`.
 */
export async function startShareStack(options: { admin?: boolean; cloud?: boolean } = {}): Promise<ShareStack> {
  await assertFreshDist();
  const dir = await mkdtemp(join(tmpdir(), 'strukt-share-e2e-'));
  const root = join(dir, 'repo');
  const arch = join(root, '.arch');
  await mkdir(join(arch, 'docs'), { recursive: true });
  await mkdir(join(arch, 'diagrams'), { recursive: true });
  await writeFile(join(arch, 'strukt.json'), JSON.stringify({ version: 1, name: 'Compartilhar', diagrams: [{ slug: 'mapa', title: 'Mapa' }], docs: [{ slug: 'notas', title: 'Notas' }], sketches: [] }));
  await writeFile(join(arch, 'docs', 'notas.md'), 'Olá');
  await writeFile(join(arch, 'diagrams', 'mapa.strukt.json'), diagramJson(['Web', 'API', 'Banco']));
  await writeFile(join(arch, 'diagrams', 'mapa.layout.json'), JSON.stringify({ nodes: { Web: { x: 60, y: 80 }, API: { x: 320, y: 120 }, Banco: { x: 580, y: 160 } } }));
  const [ownerPort, collabPort, clockPort] = [await freePort(), await freePort(), await freePort()];
  const child: ChildProcess = spawn('bun', ['src/shareStack.ts'], {
    cwd: resolve(import.meta.dirname, '../../../server'),
    env: {
      ...process.env, STRUKT_STACK_PLAN: options.cloud ? 'cloud' : 'self-hosted', STRUKT_STACK_ADMIN: options.admin ? '1' : '0', STRUKT_STACK_ROOT: root, STRUKT_STACK_OWNER_PORT: String(ownerPort), STRUKT_STACK_COLLAB_PORT: String(collabPort),
      STRUKT_STACK_CLOCK_PORT: String(clockPort), STRUKT_STACK_DIST: DIST, STRUKT_STACK_CONFIG: join(dir, 'config'),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let ready = false;
  child.stdout!.on('data', (chunk) => { if (String(chunk).includes('stack-ready')) ready = true; });
  const deadline = Date.now() + 20_000;
  while (!ready && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  if (!ready) throw new Error('share stack did not start');
  const owner = `http://127.0.0.1:${ownerPort}`;
  const stack: ShareStack = {
    owner, collab: `http://127.0.0.1:${collabPort}`, root,
    async api(path, body) {
      const response = await fetch(`${owner}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() as never };
    },
    async advance(ms) { await fetch(`http://127.0.0.1:${clockPort}/advance?ms=${ms}`, { method: 'POST' }); },
    async dispose() {
      if (child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await exited;
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
  return stack;
}
