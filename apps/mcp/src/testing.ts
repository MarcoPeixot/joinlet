import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { printManifest } from '@strukt/workspace';
import type { CommandRunner } from '@strukt/git';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createStruktServer } from './server';
import { openMcpWorkspace } from './workspace';
import type { McpWorkspace } from './workspace';

const dirs: string[] = [];

export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'strukt-mcp-'));
  dirs.push(dir);
  return dir;
}

export async function cleanupDirs(): Promise<void> {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
}

/** Writes `<root>/.arch/<path>` for each entry. */
export async function writeArch(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, '.arch', path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, text, 'utf8');
  }
}

export const manifestOf = (name: string, diagrams: { slug: string; title: string }[], docs: { slug: string; title: string }[] = []) =>
  printManifest({ version: 1, name, diagrams, docs, sketches: [] });

export const diagramJson = (...ids: string[]) =>
  `${JSON.stringify({ $schema: './strukt.schema.json', version: 1, nodes: ids.map((id) => ({ id })), connections: [] }, null, 2)}\n`;

/** A workspace with one diagram ("a") and one doc ("notas"), opened from disk. */
export async function openTestWorkspace(): Promise<McpWorkspace> {
  const root = await tempDir();
  await writeArch(root, {
    'strukt.json': manifestOf('Loja', [{ slug: 'a', title: 'A' }], [{ slug: 'notas', title: 'Notas' }]),
    'diagrams/a.strukt.json': diagramJson('API', 'DB'),
    'docs/notas.md': '# Notas\n',
  });
  const ws = await openMcpWorkspace(root);
  if ('error' in ws) throw new Error(ws.error);
  return ws;
}

export interface TestClient {
  client: Client;
  close(): Promise<void>;
}

export async function connectClient(ws: McpWorkspace, options: { runner?: CommandRunner } = {}): Promise<TestClient> {
  const server = createStruktServer(ws, options);
  const client = new Client({ name: 'strukt-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** The first text block of a tool result. */
export function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.map((block) => block.text ?? '').join('\n');
}

export const isErrorOf = (result: unknown): boolean => (result as { isError?: boolean }).isError === true;

export { fakeRunner, when } from '@strukt/git/testing';
export type { FakeCall, FakeRunnerOptions } from '@strukt/git/testing';
