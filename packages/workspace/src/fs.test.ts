import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFsAdapter, findArchDir, openWorkspaceAt, writeWorkspace } from './fs';
import { printManifest } from './manifest';
import { printDiagramJsonSchema } from '@strukt/json';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'strukt-fs-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('createFsAdapter', () => {
  it('reads, writes, lists and removes files under the arch directory', async () => {
    const arch = join(await tempDir(), '.arch');
    await mkdir(join(arch, 'diagrams'), { recursive: true });
    await writeFile(join(arch, 'strukt.json'), '{}', 'utf8');
    const adapter = createFsAdapter(arch);
    expect(await adapter.read('strukt.json')).toBe('{}');
    expect(await adapter.read('sumiu.md')).toBeNull();
    await adapter.write('docs/notas.md', '# Notas\n');
    expect(await adapter.read('docs/notas.md')).toBe('# Notas\n');
    expect(await adapter.list()).toEqual(['docs/notas.md', 'strukt.json']);
    await adapter.remove('docs/notas.md');
    expect(await adapter.list()).toEqual(['strukt.json']);
    await adapter.remove('docs/notas.md');
  });

  it('refuses paths that leave the workspace', async () => {
    const adapter = createFsAdapter(join(await tempDir(), '.arch'));
    for (const path of ['../fora.md', '/etc/passwd', 'a/../b.md', 'a//b.md', 'a\\b.md', '']) {
      await expect(adapter.read(path), path).rejects.toThrow('Caminho inválido');
      await expect(adapter.write(path, 'x'), path).rejects.toThrow('Caminho inválido');
    }
  });

  it('never follows a symlink out of the workspace and skips links when listing', async () => {
    const root = await tempDir();
    const arch = join(root, '.arch');
    await mkdir(arch, { recursive: true });
    await writeFile(join(root, 'segredo.txt'), 'segredo', 'utf8');
    await symlink(join(root, 'segredo.txt'), join(arch, 'link.txt'));
    const adapter = createFsAdapter(arch);
    await expect(adapter.read('link.txt')).rejects.toThrow('fora do .arch/');
    expect(await adapter.list()).toEqual([]);
  });
});

describe('findArchDir', () => {
  it('finds the workspace from a subdirectory, from the root and from the .arch itself', async () => {
    const root = await tempDir();
    const arch = join(root, '.arch');
    await mkdir(join(root, 'apps', 'web'), { recursive: true });
    await mkdir(arch, { recursive: true });
    await writeFile(join(arch, 'strukt.json'), '{}', 'utf8');
    expect(await findArchDir(join(root, 'apps', 'web'))).toEqual({ root, archDir: arch });
    expect(await findArchDir(root)).toEqual({ root, archDir: arch });
    expect(await findArchDir(arch)).toEqual({ root, archDir: arch });
  });

  it('returns null without a workspace', async () => {
    expect(await findArchDir(await tempDir())).toBeNull();
  });
});

describe('openWorkspaceAt and writeWorkspace', () => {
  it('refreshes an older generated schema without rewriting user documents', async () => {
    const root = await tempDir(), arch = join(root, '.arch');
    await mkdir(arch, { recursive: true });
    await writeFile(join(arch, 'strukt.json'), printManifest({ version: 1, name: 'Projeto', diagrams: [], docs: [], sketches: [] }));
    await writeFile(join(arch, 'strukt.schema.json'), '{"old":true}');
    const opened = (await openWorkspaceAt(root))!;
    const touched = await writeWorkspace(opened.adapter, opened.data, opened.data);
    expect(touched).toEqual(['strukt.schema.json']);
    expect(await readFile(join(arch, 'strukt.schema.json'), 'utf8')).toBe(printDiagramJsonSchema());
    expect(await writeWorkspace(opened.adapter, opened.data, opened.data)).toEqual([]);
  });
  it('loads a workspace (migrating the legacy diagram) and saves only what changed', async () => {
    const root = await tempDir();
    const arch = join(root, '.arch');
    await mkdir(join(arch, 'diagrams'), { recursive: true });
    const manifest = { version: 1, name: 'Loja', diagrams: [{ slug: 'a', title: 'A' }], docs: [], sketches: [] };
    await writeFile(join(arch, 'strukt.json'), printManifest(manifest), 'utf8');
    await writeFile(join(arch, 'diagrams', 'a.strukt'), 'API > DB\n', 'utf8');

    const opened = (await openWorkspaceAt(join(root, 'apps')))!;
    expect(opened.root).toBe(root);
    expect(opened.warnings[0]).toContain('convertido para diagrams/a.strukt.json');
    expect(opened.data.diagrams.a!.model.order).toEqual(['API', 'DB']);
    expect(await readFile(join(arch, 'diagrams', 'a.strukt.bak'), 'utf8')).toBe('API > DB\n');

    const data = { ...opened.data, manifest: { ...opened.data.manifest, name: 'Loja 2' } };
    expect(await writeWorkspace(opened.adapter, data, opened.data)).toEqual(['strukt.json', 'strukt.schema.json']);
    expect(JSON.parse(await readFile(join(arch, 'strukt.json'), 'utf8')).name).toBe('Loja 2');
    // The legacy backup is not a file the workspace generates: it stays.
    expect(await readFile(join(arch, 'diagrams', 'a.strukt.bak'), 'utf8')).toBe('API > DB\n');

    const withoutA = { ...data, manifest: { ...data.manifest, diagrams: [] }, diagrams: {} };
    expect(await writeWorkspace(opened.adapter, withoutA, data)).toEqual(['diagrams/a.layout.json', 'diagrams/a.strukt.json', 'strukt.json']);
    expect(await opened.adapter.read('diagrams/a.strukt.json')).toBeNull();
  });
});
