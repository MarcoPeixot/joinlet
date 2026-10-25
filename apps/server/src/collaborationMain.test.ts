import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// The real LAN host is a Bun process (Bun.serve, bun:sqlite); vitest runs in Node, so it is spawned.
const hasBun = spawnSync('bun', ['--version']).status === 0;
const TOKEN = 'token-do-host';

const freePort = () => new Promise<number>((done) => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close(() => done(typeof address === 'object' && address ? address.port : 0));
  });
});

let child: ChildProcess | null = null;
let root = '';
afterEach(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
  child = null;
  if (root) await rm(root, { recursive: true, force: true });
});

/** Spawns the real host over a temp workspace (`files` under .arch/) on a free loopback port. */
async function startHost(files: Record<string, string>) {
  root = await mkdtemp(join(tmpdir(), 'strukt-collab-main-'));
  const arch = join(root, '.arch');
  await mkdir(join(arch, 'diagrams'), { recursive: true });
  await mkdir(join(arch, 'docs'), { recursive: true });
  await mkdir(join(root, 'dist'));
  await mkdir(join(root, 'dist/app'));
  await writeFile(join(root, 'dist', 'index.html'), '<html><head></head></html>');
  await writeFile(join(root, 'dist/app/index.html'), '<html><head></head></html>');
  for (const [path, text] of Object.entries(files)) await writeFile(join(arch, path), text);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const log: string[] = [];
  child = spawn('bun', ['src/collaborationMain.ts'], {
    cwd: resolve(import.meta.dirname, '..'),
    env: {
      ...process.env, STRUKT_COLLAB_ROOT: root, STRUKT_COLLAB_PORT: String(port), STRUKT_COLLAB_PUBLIC_URL: origin, STRUKT_COLLAB_TOKEN: TOKEN,
      STRUKT_COLLAB_DB: join(root, 'rooms.sqlite'), STRUKT_COLLAB_HOST: '127.0.0.1', STRUKT_COLLAB_DIST: join(root, 'dist'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout!.on('data', (chunk) => log.push(String(chunk)));
  child.stderr!.on('data', (chunk) => log.push(String(chunk)));
  const alive = async () => (await fetch(`${origin}/api/remote/session`).catch(() => null))?.status;
  for (let i = 0; i < 150 && await alive() !== 401; i++) await new Promise((r) => setTimeout(r, 100));
  expect(await alive(), log.join('')).toBe(401);
  /** A guest socket (what the web client sends from onopen: SYNC + PRESENCE); `until` decides when it hangs up. */
  const guest = (kind: string, slug: string, until: (packet: Uint8Array) => boolean = () => false) => new Promise<{ code: number; kinds: number[]; errors: string[] }>((done) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/collaboration?repo=${encodeURIComponent(basename(root))}&kind=${kind}&slug=${slug}`, { headers: { cookie: `strukt_collab=${TOKEN}`, origin } } as never);
    socket.binaryType = 'arraybuffer';
    const kinds: number[] = [];
    const errors: string[] = [];
    socket.onopen = () => {
      socket.send(new Uint8Array([0, 0]));
      socket.send(new Uint8Array([2, ...new TextEncoder().encode('{"name":"x","color":"#123456"}')]));
    };
    socket.onmessage = (event) => {
      const packet = new Uint8Array(event.data as ArrayBuffer);
      kinds.push(packet[0]!);
      if (packet[0] === 3) errors.push(new TextDecoder().decode(packet.subarray(1)));
      if (until(packet)) socket.close();
    };
    socket.onclose = (event) => done({ code: event.code, kinds, errors });
  });
  return { alive, guest, log };
}

const manifest = (diagrams: string[], docs: string[] = []) => JSON.stringify({
  version: 1, name: 'W', diagrams: diagrams.map((slug) => ({ slug, title: slug })), docs: docs.map((slug) => ({ slug, title: slug })), sketches: [],
});

describe.skipIf(!hasBun)('the LAN host process', () => {
  it('survives a guest that joins a room which cannot open and sends from onopen', async () => {
    const { alive, guest, log } = await startHost({
      'strukt.json': manifest(['grande', 'mapa']),
      // Past the 20,000-element cap: the room refuses to open (CollaborationRefusal).
      'diagrams/grande.strukt.json': JSON.stringify({ version: 1, nodes: Array.from({ length: 20_500 }, (_, i) => ({ id: `N${i}` })), connections: [] }),
      'diagrams/mapa.strukt.json': '{"version":1,"nodes":[{"id":"Web"}],"connections":[]}\n',
    });
    for (let i = 0; i < 2; i++) {
      const refused = await guest('diagram', 'grande');
      expect(refused.code).toBe(1011);
      expect(refused.errors.join()).toContain('limite de 20000 elementos');
    }
    await new Promise((r) => setTimeout(r, 300));
    expect(child!.exitCode, log.join('')).toBeNull();
    expect(await alive()).toBe(401);
    expect((await guest('diagram', 'mapa', (packet) => packet[0] === 1)).kinds).toContain(1);
  }, 60_000);

  it.skipIf(process.getuid?.() === 0)('tells a guest a generic message, never the host\'s path, when a projection cannot write (EACCES)', async () => {
    // Not in the canonical print: the room rewrites it as soon as it opens, and the file is read-only.
    const { guest, log } = await startHost({ 'strukt.json': manifest(['mapa']), 'diagrams/mapa.strukt.json': '{"version":1,"nodes":[{"id":"Web"}],"connections":[]}' });
    await chmod(join(root, '.arch', 'diagrams', 'mapa.strukt.json'), 0o444);
    // Atomic replacement can rename over a read-only file. Deny directory writes
    // as well so both direct and atomic projection writes really fail.
    const directory = join(root, '.arch', 'diagrams');
    await chmod(directory, 0o555);
    try {
      const { errors } = await guest('diagram', 'mapa', (packet) => packet[0] === 3);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Falha ao gravar');
      expect(errors[0]).not.toContain(root);
      expect(errors[0]).not.toMatch(/EACCES|\/|\.arch/);
      await new Promise((r) => setTimeout(r, 100));
      expect(log.join('')).toContain('EACCES');
    } finally { await chmod(directory, 0o755); }
  }, 60_000);

  it('closes a room the manifest does not list with 4404, which a browser sees (a refused upgrade reads as 1006)', async () => {
    const { guest } = await startHost({ 'strukt.json': manifest([], ['notas']), 'docs/notas.md': 'x' });
    expect((await guest('doc', 'nope')).code).toBe(4404);
    expect((await guest('diagram', '__proto__')).code).toBe(4404);
    expect((await guest('doc', 'notas', (packet) => packet[0] === 1)).kinds).toContain(1);
  }, 60_000);
});
