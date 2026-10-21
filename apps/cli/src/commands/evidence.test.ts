import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fingerprintLines } from '@strukt/workspace';
import { afterEach, describe, expect, it } from 'vitest';
import { argsOf, cleanupDirs, diagramJson, fakeIo, manifestOf, tempDir, writeArch } from '../testing';
import { runCheck } from './check';
import { runEvidence } from './evidence';

afterEach(cleanupDirs);

const source = 'import x;\nexport function route() {}\nexport const z = 1;\n';

async function setup(evidence: unknown, files: Record<string, string> = { 'src/api.ts': source }): Promise<string> {
  const root = await tempDir();
  await mkdir(join(root, 'src'));
  for (const [path, text] of Object.entries(files)) await writeFile(join(root, path), text);
  await writeArch(root, {
    'strukt.json': manifestOf('Loja', [{ slug: 'a', title: 'A' }]),
    'diagrams/a.strukt.json': diagramJson('API'),
    'evidence.json': JSON.stringify({ a: { API: evidence } }),
  });
  return root;
}
const evidenceOf = async (root: string) => JSON.parse(await readFile(join(root, '.arch', 'evidence.json'), 'utf8')).a.API;

describe('runEvidence snap', () => {
  it('records snippets, is idempotent, and never prints file content', async () => {
    const root = await setup([{ path: 'src/api.ts', line: 2, contains: 'route' }, { path: 'src/api.ts' }]);
    const out = fakeIo();
    expect(await runEvidence(argsOf('evidence', 'snap', '--dir', root), out)).toBe(0);
    expect(out.outText).toContain('1 referências fixadas, 0 ignoradas');
    expect(out.outText).not.toContain('export function');
    const first = await readFile(join(root, '.arch', 'evidence.json'), 'utf8');
    expect((await evidenceOf(root))[0]).toMatchObject({ snippet: fingerprintLines(source.split('\n'), 2), contains: 'route' });
    const again = fakeIo();
    expect(await runEvidence(argsOf('evidence', 'snap', '--dir', root), again)).toBe(0);
    expect(again.outText).toContain('0 referências fixadas, 0 ignoradas');
    expect(await readFile(join(root, '.arch', 'evidence.json'), 'utf8')).toBe(first);
  });

  it('caps file size in bytes: a multi-byte file over 2 MiB is too big even though it has fewer UTF-16 units', async () => {
    const wide = `${'é'.repeat(1_100_000)}\n`; // 1.1M units, 2.2M bytes
    const root = await setup([{ path: 'src/wide.ts', line: 1 }], { 'src/wide.ts': wide });
    const out = fakeIo();
    expect(await runEvidence(argsOf('evidence', 'snap', '--dir', root), out)).toBe(0);
    expect(out.outText).toContain('0 referências fixadas, 1 ignoradas');
    expect(out.outText).toContain('grande demais');
  });

  it('makes check --drift report a moved snippet after lines are inserted above', async () => {
    const root = await setup([{ path: 'src/api.ts', line: 2 }]);
    await runEvidence(argsOf('evidence', 'snap', '--dir', root), fakeIo());
    await writeFile(join(root, 'src', 'api.ts'), `a\nb\n${source}`);
    const out = fakeIo();
    expect(await runCheck(argsOf('check', '--dir', root, '--drift'), out)).toBe(0);
    expect(out.outText).toContain('para a 4');
  });

  it('skips missing, out-of-range, traversal and symlink-escape entries without reading them', async () => {
    const outside = await tempDir();
    await writeFile(join(outside, 'secret.ts'), 'a\nb\nc\n');
    const root = await setup([
      { path: 'src/api.ts', line: 99 },
      { path: 'src/none.ts', line: 1 },
      { path: '../../etc/passwd', line: 1 },
      { path: 'link/secret.ts', line: 2 },
      { path: 'src/leak.ts', line: 2 },
    ]);
    await symlink(outside, join(root, 'link'));
    await symlink(join(outside, 'secret.ts'), join(root, 'src', 'leak.ts'));
    const out = fakeIo();
    expect(await runEvidence(argsOf('evidence', 'snap', '--dir', root), out)).toBe(0);
    expect(out.outText).toContain('0 referências fixadas, 4 ignoradas');
    expect(out.outText).toContain('src/api.ts');
    expect(out.outText).not.toContain('passwd');
    expect(JSON.stringify(await evidenceOf(root))).not.toContain('snippet');
  });

  it('exits 2 without a workspace', async () => {
    const out = fakeIo();
    expect(await runEvidence(argsOf('evidence', 'snap', '--dir', await tempDir()), out)).toBe(2);
  });
});
