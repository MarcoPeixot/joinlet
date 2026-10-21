import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { buildCheckInvocation, buildDiffInvocation } from './cli';
import { diffMarkdown } from './diffView';
import { parseCheckReport, reportToFileDiagnostics } from './checkReport';
import { nodeExec } from './nodeExec';
import { runCli } from './run';

/** Runs the real `apps/cli` (through bun, as `bun link` would) so the extension is tested against the actual `check --json` output. */
const MAIN = join(dirname(fileURLToPath(import.meta.url)), '../../cli/src/main.ts');
const cli = { path: 'bun', args: [MAIN] };
const dirs: string[] = [];

async function workspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'strukt-vscode-'));
  dirs.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, '.arch', path)), { recursive: true });
    await writeFile(join(root, '.arch', path), text, 'utf8');
  }
  return root;
}

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

const manifest = JSON.stringify({ version: 1, name: 'Loja', diagrams: [{ slug: 'a', title: 'A' }], docs: [], sketches: [] });

describe('joinlet check --json (real CLI)', () => {
  it('is parsed and mapped to the diagram file for a broken diagram', async () => {
    const root = await workspace({ 'strukt.json': manifest, 'diagrams/a.strukt.json': '{\n  "version": 1,\n  "nodes": [{ "id": "A", "color": 5 }]\n}\n' });
    const outcome = await runCli(nodeExec, buildCheckInvocation(cli, root, { drift: false }));
    expect(outcome).toMatchObject({ kind: 'done', code: 1 });
    if (outcome.kind !== 'done') return;
    const parsed = parseCheckReport(outcome.stdout);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const files = reportToFileDiagnostics(parsed.report, { strict: false });
    expect(files.get('diagrams/a.strukt.json')).toEqual([expect.objectContaining({ severity: 'error', startLine: 2, message: expect.stringContaining('nodes[0].color') })]);
  }, 30_000);

  it('reports a clean workspace with exit code 0', async () => {
    const root = await workspace({ 'strukt.json': manifest, 'diagrams/a.strukt.json': '{\n  "version": 1,\n  "nodes": [{ "id": "A" }]\n}\n' });
    const outcome = await runCli(nodeExec, buildCheckInvocation(cli, root, { drift: true }));
    expect(outcome).toMatchObject({ kind: 'done', code: 0 });
    if (outcome.kind === 'done') expect(parseCheckReport(outcome.stdout)).toMatchObject({ ok: true, report: { errors: 0 } });
  }, 30_000);

  it('exits 2 with a pt-BR explanation outside a workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'strukt-vscode-'));
    dirs.push(root);
    const outcome = await runCli(nodeExec, buildCheckInvocation(cli, root, { drift: false }));
    expect(outcome).toMatchObject({ kind: 'done', code: 2, stderr: expect.stringContaining('Nenhum workspace do Joinlet') });
  }, 30_000);
});

describe('joinlet diff --markdown (real CLI, real git)', () => {
  it('compares the working tree with HEAD', async () => {
    const root = await workspace({ 'strukt.json': manifest, 'diagrams/a.strukt.json': '{\n  "version": 1,\n  "nodes": [{ "id": "A" }]\n}\n' });
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: root, stdio: 'ignore' });
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    await writeFile(join(root, '.arch/diagrams/a.strukt.json'), '{\n  "version": 1,\n  "nodes": [{ "id": "A" }, { "id": "Cache" }]\n}\n', 'utf8');
    const outcome = await runCli(nodeExec, buildDiffInvocation(cli, root, 'HEAD'));
    expect(outcome).toMatchObject({ kind: 'done', code: 0 });
    if (outcome.kind !== 'done') return;
    expect(diffMarkdown('HEAD', outcome.stdout)).toContain('Cache');
  }, 30_000);
});
