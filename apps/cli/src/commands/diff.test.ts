import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { argsOf, cleanupDirs, diagramJson, fakeIo, fakeRunner, manifestOf, tempDir, writeArch } from '../testing';
import { runDiff } from './diff';

afterEach(cleanupDirs);

const head = { 'strukt.json': manifestOf('Loja', [{ slug: 'a', title: 'A' }]), 'diagrams/a.strukt.json': diagramJson('API', 'DB') };
const feature = {
  'strukt.json': manifestOf('Loja', [{ slug: 'a', title: 'A' }]),
  'diagrams/a.strukt.json': diagramJson('API', 'Gateway', 'DB'),
};

describe('runDiff', () => {
  it('compares two refs and prints the semantic changes in pt-BR', async () => {
    const root = await tempDir();
    const out = fakeIo();
    const runner = fakeRunner({ files: { main: head, feature } });
    expect(await runDiff(argsOf('diff', 'main', 'feature', '--dir', root), out, runner)).toBe(0);
    expect(out.outText).toContain('Comparando "main" → "feature"');
    expect(out.outText).toContain('+ Gateway');
  });

  it('compares a ref with the working tree', async () => {
    const root = await tempDir();
    await writeArch(root, feature);
    const out = fakeIo();
    expect(await runDiff(argsOf('diff', 'main', '--dir', root), out, fakeRunner({ files: { main: head } }))).toBe(0);
    expect(out.outText).toContain('Comparando "main" → "árvore de trabalho"');
    expect(out.outText).toContain('+ Gateway');
  });

  it('prints Markdown for a PR comment', async () => {
    const root = await tempDir();
    const out = fakeIo();
    await runDiff(argsOf('diff', 'main', 'feature', '--dir', root, '--markdown'), out, fakeRunner({ files: { main: head, feature } }));
    expect(out.outText).toContain('## Arquitetura — `main` → `feature`');
    expect(out.outText).toContain('- Adicionados: `Gateway`');
  });

  it('exits 2 when a ref has no workspace', async () => {
    const out = fakeIo();
    expect(await runDiff(argsOf('diff', 'main', 'feature', '--dir', await tempDir()), out, fakeRunner({}))).toBe(2);
    expect(out.errText).toContain('Não foi possível ler .arch/ em "main"');
  });

  describe('--svg', () => {
    it('writes <slug>.diff.svg for each changed diagram only and prints the paths', async () => {
      const root = await tempDir();
      const outDir = join(await tempDir(), 'strukt-diff');
      const two = { 'strukt.json': manifestOf('Loja', [{ slug: 'a', title: 'A' }, { slug: 'b', title: 'B' }]) };
      const main = { ...two, 'diagrams/a.strukt.json': diagramJson('API', 'DB'), 'diagrams/b.strukt.json': diagramJson('X') };
      const feat = { ...two, 'diagrams/a.strukt.json': diagramJson('API', 'Gateway', 'DB'), 'diagrams/b.strukt.json': diagramJson('X') };
      const out = fakeIo();
      expect(await runDiff(argsOf('diff', 'main', 'feature', '--dir', root, '--svg', outDir), out, fakeRunner({ files: { main, feature: feat } }))).toBe(0);
      expect(await readdir(outDir)).toEqual(['a.diff.svg']);
      const svg = await readFile(join(outDir, 'a.diff.svg'), 'utf8');
      expect(svg).toContain('<svg');
      expect(svg).toContain('Gateway');
      expect(out.outText).toContain(join(outDir, 'a.diff.svg'));
      expect(out.outText).toContain('+ Gateway');
    });

    it('keeps --markdown output and writes nothing when nothing changed', async () => {
      const root = await tempDir();
      const outDir = join(await tempDir(), 'svgs');
      const out = fakeIo();
      await runDiff(argsOf('diff', 'main', 'main', '--dir', root, '--markdown', '--svg', outDir), out, fakeRunner({ files: { main: head } }));
      expect(out.outText).toContain('## Arquitetura');
      expect(existsSync(outDir)).toBe(false);
    });

    it('never writes for hostile slugs (the manifest parser already drops them; the file-name check is the second wall)', async () => {
      for (const slug of ['../evil', 'a/b', '.hidden', '..']) {
        const root = await tempDir();
        const outDir = join(await tempDir(), 'out');
        const man = manifestOf('Loja', [{ slug, title: 'X' }]);
        const files = {
          main: { 'strukt.json': man, [`diagrams/${slug}.strukt.json`]: diagramJson('A') },
          feature: { 'strukt.json': man, [`diagrams/${slug}.strukt.json`]: diagramJson('A', 'B') },
        };
        const out = fakeIo();
        const code = await runDiff(argsOf('diff', 'main', 'feature', '--dir', root, '--svg', outDir), out, fakeRunner({ files }));
        expect(code).toBe(0);
        expect(existsSync(outDir) ? await readdir(outDir) : []).toEqual([]);
        expect(existsSync(join(outDir, '..', 'evil.diff.svg'))).toBe(false);
      }
    });

    it('writes distinct files for slugs that differ only by case (no overwrite on case-insensitive filesystems)', async () => {
      const root = await tempDir();
      const outDir = join(await tempDir(), 'out');
      const man = manifestOf('Loja', [{ slug: 'A', title: 'A' }, { slug: 'a', title: 'a' }]);
      const files = {
        main: { 'strukt.json': man, 'diagrams/A.strukt.json': diagramJson('X'), 'diagrams/a.strukt.json': diagramJson('Y') },
        feature: { 'strukt.json': man, 'diagrams/A.strukt.json': diagramJson('X', 'Alfa'), 'diagrams/a.strukt.json': diagramJson('Y', 'Beta') },
      };
      const out = fakeIo();
      expect(await runDiff(argsOf('diff', 'main', 'feature', '--dir', root, '--svg', outDir), out, fakeRunner({ files }))).toBe(0);
      const names = await readdir(outDir);
      expect(names).toHaveLength(2);
      expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(2);
      const texts = await Promise.all(names.map((n) => readFile(join(outDir, n), 'utf8')));
      expect(texts.some((t) => t.includes('Alfa'))).toBe(true);
      expect(texts.some((t) => t.includes('Beta'))).toBe(true);
      for (const n of names) expect(out.outText).toContain(join(outDir, n));
    });

    it('prefixes Windows reserved names (slug passes the manifest, the file-name wall acts)', async () => {
      const root = await tempDir();
      const outDir = join(await tempDir(), 'out');
      const man = manifestOf('Loja', [{ slug: 'con', title: 'C' }]);
      const files = {
        main: { 'strukt.json': man, 'diagrams/con.strukt.json': diagramJson('X') },
        feature: { 'strukt.json': man, 'diagrams/con.strukt.json': diagramJson('X', 'Y') },
      };
      expect(await runDiff(argsOf('diff', 'main', 'feature', '--dir', root, '--svg', outDir), fakeIo(), fakeRunner({ files }))).toBe(0);
      expect(await readdir(outDir)).toEqual(['_con.diff.svg']);
    });

    it('replaces its own previous regular file on re-run', async () => {
      const root = await tempDir();
      const outDir = await tempDir();
      await writeFile(join(outDir, 'a.diff.svg'), 'old', 'utf8');
      expect(await runDiff(argsOf('diff', 'main', 'feature', '--dir', root, '--svg', outDir), fakeIo(), fakeRunner({ files: { main: head, feature } }))).toBe(0);
      expect(await readFile(join(outDir, 'a.diff.svg'), 'utf8')).toContain('<svg');
    });

    it('refuses a target directory that is a symlink', async () => {
      const root = await tempDir();
      const real = await tempDir();
      const link = join(await tempDir(), 'link');
      await symlink(real, link);
      const out = fakeIo();
      const code = await runDiff(argsOf('diff', 'main', 'feature', '--dir', root, '--svg', link), out, fakeRunner({ files: { main: head, feature } }));
      expect(code).toBe(2);
      expect(await readdir(real)).toEqual([]);
    });

    it('does not follow a symlink planted at the target file name', async () => {
      const root = await tempDir();
      const outDir = await tempDir();
      const victim = join(await tempDir(), 'victim.txt');
      await writeFile(victim, 'keep', 'utf8');
      await mkdir(outDir, { recursive: true });
      await symlink(victim, join(outDir, 'a.diff.svg'));
      const out = fakeIo();
      const code = await runDiff(argsOf('diff', 'main', 'feature', '--dir', root, '--svg', outDir), out, fakeRunner({ files: { main: head, feature } }));
      expect(code).toBe(2);
      expect(await readFile(victim, 'utf8')).toBe('keep');
    });

    it('refuses a target reached through a symlinked ancestor that resolves into .arch', async () => {
      const root = await tempDir();
      await mkdir(join(root, '.arch'), { recursive: true });
      const elsewhere = await tempDir();
      const viaLink = join(elsewhere, 'link');
      await symlink(join(root, '.arch'), viaLink);
      for (const target of [join(viaLink, 'svgs'), join(viaLink, 'a', 'b')]) {
        const out = fakeIo();
        const code = await runDiff(argsOf('diff', 'main', 'feature', '--dir', root, '--svg', target), out, fakeRunner({ files: { main: head, feature } }));
        expect(code, target).toBe(2);
        expect(out.errText).toContain('.arch');
      }
      expect(await readdir(join(root, '.arch'))).toEqual([]);
    });

    it('refuses --svg pointing straight into .arch (also through ..)', async () => {
      const root = await tempDir();
      await mkdir(join(root, '.arch'), { recursive: true });
      const out = fakeIo();
      const code = await runDiff(argsOf('diff', 'main', 'feature', '--dir', root, '--svg', join(root, 'x', '..', '.arch', 'svgs')), out, fakeRunner({ files: { main: head, feature } }));
      expect(code).toBe(2);
      expect(existsSync(join(root, '.arch', 'svgs'))).toBe(false);
    });

    it('leaves no temp files behind and replaces atomically', async () => {
      const root = await tempDir();
      const outDir = await tempDir();
      await writeFile(join(outDir, 'a.diff.svg'), 'old', 'utf8');
      expect(await runDiff(argsOf('diff', 'main', 'feature', '--dir', root, '--svg', outDir), fakeIo(), fakeRunner({ files: { main: head, feature } }))).toBe(0);
      expect(await readdir(outDir)).toEqual(['a.diff.svg']);
    });
  });
});
