import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseArgs } from '../args';
import { argsOf, cleanupDirs, diagramJson, fakeIo, manifestOf, tempDir, writeArch } from '../testing';
import { runSite } from './site';

afterEach(cleanupDirs);

async function fixture() {
  const root = await tempDir();
  await writeArch(root, {
    'strukt.json': manifestOf('Loja <b>', [{ slug: 'a', title: 'Visão geral' }], [{ slug: 'api', title: 'API' }]),
    'diagrams/a.strukt.json': diagramJson('API', 'DB'),
    'docs/api.md': '# API\n\nVeja [site](https://exemplo.com) <script>alert(1)</script>',
  });
  return root;
}

describe('runSite', () => {
  it('writes the static site and prints the files', async () => {
    const root = await fixture();
    const outDir = join(await tempDir(), 'site');
    const out = fakeIo();
    expect(await runSite(argsOf('site', '--dir', root, '--out', outDir), out)).toBe(0);
    expect((await readdir(outDir)).sort()).toEqual(['.strukt-site', 'diagrams', 'docs', 'index.html', 'style.css']);
    const index = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(index).toContain('Loja &lt;b&gt;');
    expect(index).not.toContain('<b>');
    const diagram = await readFile(join(outDir, 'diagrams/a.html'), 'utf8');
    expect(diagram).toContain('<svg');
    expect(diagram).not.toContain('Diff visual');
    expect(diagram).not.toContain('sem mudanças');
    const doc = await readFile(join(outDir, 'docs/api.html'), 'utf8');
    expect(doc).toContain('&lt;script&gt;');
    expect(doc).not.toContain('<script');
    expect(out.outText).toContain(join(outDir, 'index.html'));
    expect(out.outText).toContain('5 arquivos');
  });

  it('defaults to ./strukt-site relative to the current directory', () => {
    expect(parseArgs(['site'])).toMatchObject({ command: 'site' });
    expect((parseArgs(['site']) as { out?: string }).out).toBeUndefined();
    expect(parseArgs(['site', 'x'])).toEqual({ error: 'O comando "site" não aceita argumentos posicionais.' });
  });

  it('is idempotent: a second run replaces its own files with identical content', async () => {
    const root = await fixture();
    const outDir = join(await tempDir(), 'site');
    await runSite(argsOf('site', '--dir', root, '--out', outDir), fakeIo());
    const first = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(await runSite(argsOf('site', '--dir', root, '--out', outDir), fakeIo())).toBe(0);
    expect(await readFile(join(outDir, 'index.html'), 'utf8')).toBe(first);
  });

  it('writes a page per perspective and removes it on the next run when the perspective is gone', async () => {
    const root = await fixture();
    const file = join(root, '.arch', 'diagrams/a.perspectives.json');
    await writeFile(file, JSON.stringify({ version: 1, perspectives: [{ id: 'sem-db', name: 'Sem <DB>', hide: ['DB'] }] }), 'utf8');
    const outDir = join(await tempDir(), 'site');
    expect(await runSite(argsOf('site', '--dir', root, '--out', outDir), fakeIo())).toBe(0);
    const page = await readFile(join(outDir, 'diagrams/a~p~sem-db.html'), 'utf8');
    expect(page).toContain('Sem &lt;DB&gt;');
    expect(page).toContain('<svg');
    expect(await readFile(join(outDir, 'diagrams/a.html'), 'utf8')).toContain('href="a~p~sem-db.html"');
    await rm(file);
    const out = fakeIo();
    expect(await runSite(argsOf('site', '--dir', root, '--out', outDir), out)).toBe(0);
    expect(existsSync(join(outDir, 'diagrams/a~p~sem-db.html'))).toBe(false);
    expect(out.outText).toContain('1 arquivo antigo removido');
  });

  it('exits 2 without a workspace', async () => {
    const out = fakeIo();
    expect(await runSite(argsOf('site', '--dir', await tempDir()), out)).toBe(2);
    expect(out.errText).toContain('Nenhum workspace do Joinlet');
  });

  it('refuses to write inside .arch/', async () => {
    const root = await fixture();
    const out = fakeIo();
    expect(await runSite(argsOf('site', '--dir', root, '--out', join(root, '.arch', 'site')), out)).toBe(2);
    expect(out.errText).toContain('.arch');
    expect(existsSync(join(root, '.arch', 'site'))).toBe(false);
  });

  it('refuses a symlinked output dir or sub-dir and a non-regular target, writing nothing', async () => {
    const root = await fixture();
    const real = await tempDir();
    const link = join(await tempDir(), 'link');
    await symlink(real, link);
    const out = fakeIo();
    expect(await runSite(argsOf('site', '--dir', root, '--out', link), out)).toBe(2);
    expect(await readdir(real)).toEqual([]);

    const dir = await tempDir();
    await writeFile(join(dir, '.strukt-site'), '{"files":[]}', 'utf8');
    await symlink(real, join(dir, 'diagrams'));
    expect(await runSite(argsOf('site', '--dir', root, '--out', dir), fakeIo())).toBe(2);
    expect(await readdir(real)).toEqual([]);

    const dir2 = await tempDir();
    await writeFile(join(dir2, '.strukt-site'), '{"files":[]}', 'utf8');
    await mkdir(join(dir2, 'index.html'));
    const io2 = fakeIo();
    expect(await runSite(argsOf('site', '--dir', root, '--out', dir2), io2)).toBe(2);
    expect(io2.errText).toContain('Nada foi gravado');
    expect(existsSync(join(dir2, 'style.css'))).toBe(false);
  });

  it('replaces only its own regular files', async () => {
    const root = await fixture();
    const dir = await tempDir();
    await writeFile(join(dir, '.strukt-site'), '{"files":["index.html"]}', 'utf8');
    await writeFile(join(dir, 'index.html'), 'old', 'utf8');
    await writeFile(join(dir, 'keep.txt'), 'mine', 'utf8');
    expect(await runSite(argsOf('site', '--dir', root, '--out', dir), fakeIo())).toBe(0);
    expect(await readFile(join(dir, 'index.html'), 'utf8')).toContain('<!doctype html>');
    expect(await readFile(join(dir, 'keep.txt'), 'utf8')).toBe('mine');
  });

  it('refuses an output dir that is or contains .arch or .git', async () => {
    const root = await fixture();
    await mkdir(join(root, '.git'));
    for (const out of [root, join(root, '..'), '.']) {
      const io = fakeIo();
      const cwd = process.cwd();
      if (out === '.') process.chdir(root);
      try {
        expect(await runSite(argsOf('site', '--dir', root, '--out', out), io), out).toBe(2);
      } finally {
        process.chdir(cwd);
      }
      expect(io.errText).toMatch(/\.arch|\.git/);
    }
    expect(existsSync(join(root, 'index.html'))).toBe(false);
    const other = await tempDir();
    await mkdir(join(other, '.git'));
    expect(await runSite(argsOf('site', '--dir', root, '--out', other), fakeIo())).toBe(2);
    expect(existsSync(join(other, 'index.html'))).toBe(false);
  });

  it('refuses a non-empty dir without the site marker and writes nothing', async () => {
    const root = await fixture();
    const dir = await tempDir();
    await writeFile(join(dir, 'index.html'), 'precious', 'utf8');
    const io = fakeIo();
    expect(await runSite(argsOf('site', '--dir', root, '--out', dir), io), io.errText).toBe(2);
    expect(io.errText).toContain('.strukt-site');
    expect(await readFile(join(dir, 'index.html'), 'utf8')).toBe('precious');
    expect(existsSync(join(dir, 'style.css'))).toBe(false);
  });

  it('accepts an empty existing dir and writes the marker listing every generated file', async () => {
    const root = await fixture();
    const dir = await tempDir();
    expect(await runSite(argsOf('site', '--dir', root, '--out', dir), fakeIo())).toBe(0);
    const marker = JSON.parse(await readFile(join(dir, '.strukt-site'), 'utf8')) as { files: string[] };
    expect(marker.files).toEqual(['diagrams/a.html', 'docs/api.html', 'index.html', 'style.css']);
  });

  it('removes stale files listed in the previous marker, and only those', async () => {
    const root = await fixture();
    const dir = await tempDir();
    expect(await runSite(argsOf('site', '--dir', root, '--out', dir), fakeIo())).toBe(0);
    await mkdir(join(dir, 'diagrams'), { recursive: true });
    await writeFile(join(dir, 'diagrams', 'gone.html'), 'stale', 'utf8');
    await writeFile(join(dir, 'foreign.txt'), 'not ours', 'utf8');
    const marker = JSON.parse(await readFile(join(dir, '.strukt-site'), 'utf8')) as { files: string[] };
    await writeFile(join(dir, '.strukt-site'), JSON.stringify({ files: [...marker.files, 'diagrams/gone.html', '../escape.txt', '/etc/hosts', 'diagrams/../foreign.txt'] }), 'utf8');
    const outside = join(dir, '..', 'escape.txt');
    await writeFile(outside, 'outside', 'utf8');
    const io = fakeIo();
    expect(await runSite(argsOf('site', '--dir', root, '--out', dir), io)).toBe(0);
    expect(existsSync(join(dir, 'diagrams', 'gone.html'))).toBe(false);
    expect(await readFile(join(dir, 'foreign.txt'), 'utf8')).toBe('not ours');
    expect(await readFile(outside, 'utf8')).toBe('outside');
    expect(io.outText).toContain('1 arquivo antigo removido');
    await rm(outside, { force: true });
  });

  it('does not follow a symlinked directory when removing stale files', async () => {
    const root = await fixture();
    const dir = await tempDir();
    const victim = await tempDir();
    await writeFile(join(victim, 'x.html'), 'victim', 'utf8');
    await symlink(victim, join(dir, 'old'));
    await writeFile(join(dir, '.strukt-site'), JSON.stringify({ files: ['old/x.html'] }), 'utf8');
    expect(await runSite(argsOf('site', '--dir', root, '--out', dir), fakeIo())).toBe(0);
    expect(await readFile(join(victim, 'x.html'), 'utf8')).toBe('victim');
  });

  it('only deletes marker entries that match the generated-name allowlist', async () => {
    const root = await fixture();
    const dir = await tempDir();
    expect(await runSite(argsOf('site', '--dir', root, '--out', dir), fakeIo())).toBe(0);
    await mkdir(join(dir, 'docs', 'sub'), { recursive: true });
    await mkdir(join(dir, 'diagrams'), { recursive: true });
    const victims: Record<string, string> = {
      'foreign.txt': 'a', 'README.md': 'b', 'diagrams/.hidden.html': 'c', 'docs/sub/x.html': 'd', 'docs/x.': 'e', 'docs/old.html': 'stale',
    };
    for (const [rel, content] of Object.entries(victims)) await writeFile(join(dir, rel), content, 'utf8');
    const hostile = ['foreign.txt', 'README.md', 'docs/../x.html', 'diagrams/.hidden.html', '../out.html', 'docs/sub/x.html', 'docs/x.'];
    await writeFile(join(dir, '.strukt-site'), JSON.stringify({ files: [...hostile, 'docs/old.html'] }), 'utf8');
    const io = fakeIo();
    expect(await runSite(argsOf('site', '--dir', root, '--out', dir), io)).toBe(0);
    for (const rel of ['foreign.txt', 'README.md', 'diagrams/.hidden.html', 'docs/sub/x.html', 'docs/x.']) expect(existsSync(join(dir, rel)), rel).toBe(true);
    expect(existsSync(join(dir, 'docs', 'old.html'))).toBe(false);
    expect(io.errText).toContain('.strukt-site');
    expect(io.outText).toContain('1 arquivo antigo removido');
  });

  it('refuses --out inside .git', async () => {
    const root = await fixture();
    await mkdir(join(root, '.git'));
    const io = fakeIo();
    expect(await runSite(argsOf('site', '--dir', root, '--out', join(root, '.git', 'x')), io)).toBe(2);
    expect(existsSync(join(root, '.git', 'x'))).toBe(false);
  });

  it('never deletes a page just written when an older marker lists the same name in another case', async () => {
    const root = await fixture();
    const outDir = join(await tempDir(), 'site');
    await runSite(argsOf('site', '--dir', root, '--out', outDir), fakeIo());
    const marker = JSON.parse(await readFile(join(outDir, '.strukt-site'), 'utf8')) as { generator: string; files: string[] };
    marker.files.push('docs/API.html', 'diagrams/A.html');
    await writeFile(join(outDir, '.strukt-site'), JSON.stringify(marker), 'utf8');
    expect(await runSite(argsOf('site', '--dir', root, '--out', outDir), fakeIo())).toBe(0);
    expect(existsSync(join(outDir, 'docs/api.html'))).toBe(true);
    expect(existsSync(join(outDir, 'diagrams/a.html'))).toBe(true);
  });
});
