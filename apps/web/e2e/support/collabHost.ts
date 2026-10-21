import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseDiagramJson } from '@strukt/json';

export interface CollabHost {
  origin: string;
  invite: string;
  /** The read-only link. */
  viewInvite: string;
  root: string;
  /** Stops the host process (SIGTERM, by PID) and waits for it. */
  stop(): Promise<void>;
  /** Starts the host again on the same port, workspace and token. */
  start(): Promise<void>;
  /** Stops the host and deletes the temp workspace. */
  dispose(): Promise<void>;
}

export interface CollabSeed {
  name: string;
  docs?: Record<string, { title: string; text: string }>;
  diagrams?: Record<string, { title: string; nodes: string[] }>;
}

const REPO = resolve(import.meta.dirname, '../../../..');
/** The compiled app the host serves: `STRUKT_E2E_DIST` (a separate build, never the one a running host serves) or apps/web/dist. */
export const DIST = resolve(process.env.STRUKT_E2E_DIST || join(REPO, 'apps/web/dist'));

async function newest(dir: string): Promise<{ path: string; mtime: number }> {
  let best = { path: dir, mtime: 0 };
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name);
    const found = entry.isDirectory()
      ? (entry.name === 'node_modules' || entry.name === 'fixtures' ? best : await newest(path))
      : /\.(test|spec)\.tsx?$/.test(entry.name) ? best : { path, mtime: (await stat(path)).mtimeMs };
    if (found.mtime > best.mtime) best = found;
  }
  return best;
}

let checked: Promise<void> | null = null;
/** Fails fast when the build is missing or older than the source it would test (a stale build passes or fails for nothing). */
export function assertFreshDist(): Promise<void> {
  // STRUKT_E2E_ALLOW_STALE=1: a checkout other people are editing right now outdates any build within seconds.
  if (process.env.STRUKT_E2E_ALLOW_STALE === '1') return Promise.resolve();
  checked ??= (async () => {
    const built = await stat(join(DIST, 'app/index.html')).catch(() => null);
    const rebuild = "Build it with `cd apps/web && bunx vite build --outDir <dir>` and set STRUKT_E2E_DIST=<dir>.";
    if (!built) throw new Error(`collaboration e2e: no build at ${DIST}. ${rebuild}`);
    const packages = await readdir(join(REPO, 'packages'));
    const sources = [join(REPO, 'apps/web/src'), join(REPO, 'apps/web/index.html'), join(REPO, 'apps/web/app/index.html'), ...packages.map((name) => join(REPO, 'packages', name, 'src'))];
    for (const source of sources) {
      const info = await stat(source).catch(() => null);
      const found = info?.isDirectory() ? await newest(source) : { path: source, mtime: info?.mtimeMs ?? 0 };
      if (found.mtime > built.mtimeMs) throw new Error(`collaboration e2e: the build at ${DIST} is older than ${found.path}. ${rebuild}`);
    }
  })();
  return checked;
}

export const freePort = () => new Promise<number>((done) => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close(() => done(typeof address === 'object' && address ? address.port : 0));
  });
});

/** A chain of connected nodes; refused unless it parses cleanly (an invalid seed runs the specs in "file with errors" mode). */
export function diagramJson(nodes: string[]): string {
  const text = `${JSON.stringify({
    $schema: './strukt.schema.json', version: 1,
    nodes: nodes.map((id) => ({ id })),
    connections: nodes.slice(1).map((to, index) => ({ from: nodes[index], to })),
  }, null, 2)}\n`;
  const { model, diagnostics } = parseDiagramJson(text);
  if (diagnostics.length || model.edges.length !== nodes.length - 1) throw new Error(`collaboration e2e: invalid seed diagram: ${JSON.stringify(diagnostics)}`);
  return text;
}

/** A LAN collaboration host on a free loopback port, over a temp workspace. Always `dispose()` it in `afterAll`. */
export async function startCollabHost(seed: CollabSeed): Promise<CollabHost> {
  await assertFreshDist();
  const root = await mkdtemp(join(tmpdir(), 'strukt-collab-e2e-'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const token = randomUUID();
  const viewToken = randomUUID();
  const arch = join(root, '.arch');
  await mkdir(join(arch, 'docs'), { recursive: true });
  await mkdir(join(arch, 'diagrams'), { recursive: true });
  const slug = (title: string) => title.toLowerCase();
  await writeFile(join(arch, 'strukt.json'), JSON.stringify({
    version: 1, name: seed.name,
    diagrams: Object.entries(seed.diagrams ?? {}).map(([key, d]) => ({ slug: key, title: d.title })),
    docs: Object.entries(seed.docs ?? {}).map(([key, d]) => ({ slug: key, title: d.title })),
    sketches: [],
  }));
  for (const [key, d] of Object.entries(seed.docs ?? {})) await writeFile(join(arch, 'docs', `${slug(key)}.md`), d.text);
  for (const [key, d] of Object.entries(seed.diagrams ?? {})) {
    await writeFile(join(arch, 'diagrams', `${slug(key)}.strukt.json`), diagramJson(d.nodes));
    const layout = Object.fromEntries(d.nodes.map((id, index) => [id, { x: 60 + index * 260, y: 80 + index * 40 }]));
    await writeFile(join(arch, 'diagrams', `${slug(key)}.layout.json`), JSON.stringify({ nodes: layout }));
  }

  let child: ChildProcess | null = null;
  const launch = () => spawn('bun', ['src/collaborationMain.ts'], {
    cwd: resolve(import.meta.dirname, '../../../server'),
    env: {
      ...process.env, STRUKT_COLLAB_ROOT: root, STRUKT_COLLAB_PUBLIC_URL: origin, STRUKT_COLLAB_PORT: String(port), STRUKT_COLLAB_TOKEN: token, STRUKT_COLLAB_VIEW_TOKEN: viewToken,
      STRUKT_COLLAB_DB: join(root, 'rooms.sqlite'), STRUKT_COLLAB_HOST: '127.0.0.1', STRUKT_COLLAB_DIST: DIST,
    },
    stdio: 'ignore',
  });
  const host: CollabHost = {
    origin, root, invite: `${origin}/join?token=${token}`, viewInvite: `${origin}/join?token=${viewToken}`,
    async start() {
      child = launch();
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const response = await fetch(`${origin}/api/remote/session`).catch(() => null);
        if (response?.status === 401) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('collaboration host did not start');
    },
    async stop() {
      if (!child || child.exitCode !== null) return;
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    },
    async dispose() {
      await host.stop();
      await rm(root, { recursive: true, force: true });
    },
  };
  await host.start();
  return host;
}
