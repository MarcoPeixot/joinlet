import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { printManifest } from '@strukt/workspace';
import { parseArgs } from './args';
import type { CliArgs } from './args';
import type { CliIo } from './io';

/** Parsed args for tests: a parse error is a test bug, never a silent default. */
export function argsOf(...argv: string[]): CliArgs {
  const parsed = parseArgs(argv);
  if ('error' in parsed) throw new Error(parsed.error);
  return parsed;
}

const dirs: string[] = [];

export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'strukt-cli-'));
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

/** Captures what a command wrote, for assertions. */
export function fakeIo(): CliIo & { outText: string; errText: string } {
  const io = {
    outText: '',
    errText: '',
    out(text: string) {
      io.outText += `${text}\n`;
    },
    err(text: string) {
      io.errText += `${text}\n`;
    },
  };
  return io;
}

export { fakeRunner, when } from '@strukt/git/testing';
export type { FakeCall, FakeRunnerOptions } from '@strukt/git/testing';
