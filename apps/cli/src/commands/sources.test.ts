import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSources } from '@strukt/workspace';
import { argsOf, cleanupDirs, diagramJson, fakeIo, manifestOf, tempDir, writeArch } from '../testing';
import { runSources } from './sources';
import { runSync } from './sync';
import { run } from '../main';
import { mkdir, writeFile } from 'node:fs/promises';

afterEach(cleanupDirs);

async function repo(files: Record<string, string> = {}): Promise<string> {
  const root = await tempDir();
  await writeArch(root, {
    'strukt.json': manifestOf('Loja', [{ slug: 'infra', title: 'Infra' }]),
    'diagrams/infra.strukt.json': diagramJson(),
    ...files,
  });
  await mkdir(join(root, 'infra'), { recursive: true });
  await writeFile(join(root, 'infra', 'main.tf'), 'resource "aws_s3_bucket" "logs" {\n}\n', 'utf8');
  return root;
}

const sourcesOf = async (root: string) => parseSources(await readFile(join(root, '.arch', 'sources.json'), 'utf8'));
const add = (root: string, ...rest: string[]) => runSources(argsOf('sources', 'add', ...rest, '--dir', root), fakeIo());

describe('runSources', () => {
  it('lists nothing before the first source', async () => {
    const io = fakeIo();
    expect(await runSources(argsOf('sources', 'list', '--dir', await repo()), io)).toBe(0);
    expect(io.outText).toContain('Nenhuma fonte configurada');
  });

  it('adds a source, writes canonical JSON and counts the matching files', async () => {
    const root = await repo();
    const io = fakeIo();
    expect(await runSources(argsOf('sources', 'add', 'infra', '--kind', 'terraform', '--include', 'infra/**/*.tf', '--include', '!infra/legacy/**', '--diagram', 'infra', '--dir', root), io)).toBe(0);
    expect(io.outText).toContain('Fonte "infra" adicionada');
    expect(io.outText).toContain('1 arquivo casa');
    expect((await sourcesOf(root)).sources).toEqual([{ id: 'infra', kind: 'terraform', include: ['infra/**/*.tf', '!infra/legacy/**'], diagram: 'infra', mode: 'merge' }]);
    const list = fakeIo();
    await runSources(argsOf('sources', 'list', '--dir', root), list);
    expect(list.outText).toContain('infra  terraform  → infra (merge)  infra/**/*.tf !infra/legacy/**');
    const json = fakeIo();
    await runSources(argsOf('sources', 'list', '--json', '--dir', root), json);
    expect(JSON.parse(json.outText).sources).toHaveLength(1);
  });

  it('creates the target diagram when it does not exist yet', async () => {
    const root = await repo();
    const io = fakeIo();
    expect(await add(root, 'k8s', '--kind', 'kubernetes', '--include', 'k8s/*.yaml', '--diagram', 'cluster-prod')).toBe(0);
    const manifest = JSON.parse(await readFile(join(root, '.arch', 'strukt.json'), 'utf8'));
    expect(manifest.diagrams.map((d: { slug: string }) => d.slug)).toEqual(['infra', 'cluster-prod']);
    expect(await readFile(join(root, '.arch', 'diagrams', 'cluster-prod.strukt.json'), 'utf8')).toContain('"nodes": []');
    expect(io.errText).toBe('');
  });

  it('warns when no file matches yet', async () => {
    const root = await repo();
    const io = fakeIo();
    expect(await runSources(argsOf('sources', 'add', 'api', '--kind', 'openapi', '--include', 'api/*.yaml', '--diagram', 'infra', '--dir', root), io)).toBe(0);
    expect(io.errText).toContain('nenhum arquivo casa');
  });

  it('refuses invalid sources with the reason and writes nothing', async () => {
    const root = await repo();
    const before = await readdir(join(root, '.arch'));
    for (const bad of [
      ['x', '--kind', 'cobol', '--include', 'a', '--diagram', 'infra'],
      ['x', '--kind', 'd2', '--include', '../fora/*.d2', '--diagram', 'infra'],
      ['x', '--kind', 'd2', '--include', 'a.d2', '--diagram', '../x'],
      ['x', '--kind', 'd2', '--include', 'a.d2', '--diagram', 'infra', '--mode', 'overwrite'],
      ['__proto__', '--kind', 'd2', '--include', 'a.d2', '--diagram', 'infra'],
      ['x', '--kind', 'd2', '--include', 'a.d2', '--diagram', 'Maiúscula_Estranha'],
    ]) {
      const io = fakeIo();
      expect(await runSources(argsOf('sources', 'add', ...bad, '--dir', root), io), bad.join(' ')).toBe(1);
      expect(io.errText.length).toBeGreaterThan(0);
    }
    expect(await readdir(join(root, '.arch'))).toEqual(before);
  });

  it('refuses a duplicate id and a mode that conflicts with the diagram', async () => {
    const root = await repo();
    await add(root, 'infra', '--kind', 'terraform', '--include', 'infra/*.tf', '--diagram', 'infra');
    const dup = fakeIo();
    expect(await runSources(argsOf('sources', 'add', 'infra', '--kind', 'd2', '--include', 'a.d2', '--diagram', 'infra', '--dir', root), dup)).toBe(1);
    expect(dup.errText).toContain('já existe');
    const mixed = fakeIo();
    expect(await runSources(argsOf('sources', 'add', 'other', '--kind', 'd2', '--include', 'a.d2', '--diagram', 'infra', '--mode', 'replace', '--dir', root), mixed)).toBe(1);
    expect(mixed.errText).toContain('misturar');
    expect((await sourcesOf(root)).sources).toHaveLength(1);
  });

  it('refuses to edit a corrupted sources file', async () => {
    const root = await repo({ 'sources.json': '{ nope' });
    const io = fakeIo();
    expect(await runSources(argsOf('sources', 'list', '--dir', root), io)).toBe(1);
    expect(io.errText).toContain('JSON inválido');
    expect(io.errText).toContain('Corrija');
  });

  it('removes a source and detaches its elements from the sync base', async () => {
    const root = await repo();
    await add(root, 'infra', '--kind', 'terraform', '--include', 'infra/*.tf', '--diagram', 'infra');
    await runSync(argsOf('sync', '--dir', root), fakeIo());
    expect(JSON.parse(await readFile(join(root, '.arch', 'sync.json'), 'utf8')).sources.infra).toBeDefined();
    const io = fakeIo();
    expect(await runSources(argsOf('sources', 'remove', 'infra', '--dir', root), io)).toBe(0);
    expect(io.outText).toContain('continuam no diagrama');
    expect((await sourcesOf(root)).sources).toEqual([]);
    await expect(readFile(join(root, '.arch', 'sync.json'), 'utf8')).rejects.toThrow();
    expect(await readFile(join(root, '.arch', 'diagrams', 'infra.strukt.json'), 'utf8')).toContain('aws_s3_bucket.logs');
    expect(await runSync(argsOf('sync', '--check', '--dir', root), fakeIo())).toBe(0);
  });

  it('rejects removing an unknown source', async () => {
    const root = await repo();
    await add(root, 'infra', '--kind', 'terraform', '--include', 'infra/*.tf', '--diagram', 'infra');
    const io = fakeIo();
    expect(await runSources(argsOf('sources', 'remove', 'nada', '--dir', root), io)).toBe(1);
    expect(io.errText).toContain('Fontes: infra');
  });

  it('is reachable from the CLI entry point', async () => {
    const root = await repo();
    const io = fakeIo();
    expect(await run(['sources', 'add', 'infra', '--kind', 'terraform', '--include', 'infra/*.tf', '--diagram', 'infra', '--dir', root], io)).toBe(0);
    expect(await run(['sources', 'list', '--dir', root], io)).toBe(0);
    expect(await run(['sources', 'zap', '--dir', root], fakeIo())).toBe(2);
  });
});
