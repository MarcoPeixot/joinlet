import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { argsOf, cleanupDirs, diagramJson, fakeIo, manifestOf, tempDir, writeArch } from '../testing';
import { parseArgs } from '../args';
import { runExport } from './export';

afterEach(cleanupDirs);

async function workspace() {
  const root = await tempDir();
  await writeArch(root, {
    'strukt.json': manifestOf('Loja', [{ slug: 'a', title: 'Visão geral' }]),
    'diagrams/a.strukt.json': diagramJson('API', 'DB'),
  });
  return root;
}

describe('runExport', () => {
  it('prints Mermaid to stdout', async () => {
    const root = await workspace();
    const io = fakeIo();
    expect(await runExport(argsOf('export', 'a', '--format', 'mermaid', '--dir', root), io)).toBe(0);
    expect(io.outText).toBe('flowchart LR\n  n0["API"]\n  n1["DB"]\n');
  });

  it('prints PlantUML and writes --out', async () => {
    const root = await workspace();
    const file = join(root, 'out', 'a.puml');
    const io = fakeIo();
    expect(await runExport(argsOf('export', 'a', '--format=plantuml', '--out', file, '--dir', root), io)).toBe(0);
    expect(io.outText).toBe('');
    expect(await readFile(file, 'utf8')).toContain('@startuml');
  });

  it('fails with exit 1 and pt-BR errors for unknown slug or format', async () => {
    const root = await workspace();
    for (const slug of ['nope', 'constructor', '__proto__']) {
      const io = fakeIo();
      expect(await runExport(argsOf('export', slug, '--format', 'mermaid', '--dir', root), io)).toBe(1);
      expect(io.errText).toContain(`Diagrama "${slug}" não encontrado`);
    }
    const io = fakeIo();
    expect(await runExport(argsOf('export', 'a', '--format', 'svg', '--dir', root), io)).toBe(1);
    expect(io.errText).toContain('Formato inválido: "svg"');
    const missing = fakeIo();
    expect(await runExport(argsOf('export', 'a', '--dir', root), missing)).toBe(1);
    expect(missing.errText).toContain('Formato inválido');
  });

  it('exits 2 without a workspace and requires one slug', async () => {
    const io = fakeIo();
    expect(await runExport(argsOf('export', 'a', '--format', 'mermaid', '--dir', await tempDir()), io)).toBe(2);
    expect(parseArgs(['export'])).toEqual({ error: 'O export precisa de exatamente um <slug> de diagrama.' });
  });

  it('refuses --out inside .arch and leaves the diagram untouched', async () => {
    const root = await workspace();
    const target = join(root, '.arch', 'diagrams', 'a.strukt.json');
    const before = await readFile(target, 'utf8');
    const io = fakeIo();
    expect(await runExport(argsOf('export', 'a', '--format', 'mermaid', '--out', target, '--dir', root), io)).toBe(1);
    expect(io.errText).toContain('Recusei gravar');
    expect(await readFile(target, 'utf8')).toBe(before);
  });

  it('refuses --out inside .git', async () => {
    const root = await workspace();
    await mkdir(join(root, '.git'));
    const io = fakeIo();
    expect(await runExport(argsOf('export', 'a', '--format', 'mermaid', '--out', join(root, '.git', 'a.mmd'), '--dir', root), io)).toBe(1);
    expect(await readdir(join(root, '.git'))).toEqual([]);
  });

  it('refuses an --out directory that is a symlink into .arch, and a symlinked target file', async () => {
    const root = await workspace();
    const link = join(await tempDir(), 'link');
    await symlink(join(root, '.arch', 'diagrams'), link);
    const io = fakeIo();
    expect(await runExport(argsOf('export', 'a', '--format', 'mermaid', '--out', join(link, 'a.strukt.json'), '--dir', root), io)).toBe(1);
    const victim = join(await tempDir(), 'victim.txt');
    await writeFile(victim, 'keep', 'utf8');
    const out = await tempDir();
    await symlink(victim, join(out, 'a.mmd'));
    const io2 = fakeIo();
    expect(await runExport(argsOf('export', 'a', '--format', 'mermaid', '--out', join(out, 'a.mmd'), '--dir', root), io2)).toBe(1);
    expect(await readFile(victim, 'utf8')).toBe('keep');
  });

  it('replaces an existing file atomically without leaving temp files', async () => {
    const root = await workspace();
    const out = await tempDir();
    await writeFile(join(out, 'a.mmd'), 'old', 'utf8');
    const io = fakeIo();
    expect(await runExport(argsOf('export', 'a', '--format', 'mermaid', '--out', join(out, 'a.mmd'), '--dir', root), io)).toBe(0);
    expect(await readFile(join(out, 'a.mmd'), 'utf8')).toContain('flowchart');
    expect(await readdir(out)).toEqual(['a.mmd']);
  });
});
