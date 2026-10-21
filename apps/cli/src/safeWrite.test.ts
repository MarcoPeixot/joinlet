import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isWithin, realResolve, writeFilesSafely } from './safeWrite';
import { cleanupDirs, tempDir } from './testing';

afterEach(cleanupDirs);

describe('writeFilesSafely', () => {
  it('writes, replaces and leaves no temp files', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'a.txt'), 'old', 'utf8');
    const saved = await writeFilesSafely(dir, [{ rel: 'a.txt', content: 'new' }, { rel: 'sub/b.txt', content: 'b' }]);
    expect(saved.ok).toBe(true);
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('new');
    expect(await readdir(dir)).toEqual(['a.txt', 'sub']);
    expect(await readdir(join(dir, 'sub'))).toEqual(['b.txt']);
  });

  it('a symlink swapped in at the target name is replaced, never written through', async () => {
    const dir = await tempDir();
    const victim = join(await tempDir(), 'victim.txt');
    await writeFile(victim, 'keep', 'utf8');
    await symlink(victim, join(dir, 'a.txt'));
    const saved = await writeFilesSafely(dir, [{ rel: 'a.txt', content: 'x' }]);
    expect(saved.ok).toBe(false);
    expect(await readFile(victim, 'utf8')).toBe('keep');
  });

  it('refuses a directory that resolves into a forbidden folder', async () => {
    const root = await tempDir();
    await mkdir(join(root, '.arch'));
    const link = join(await tempDir(), 'l');
    await symlink(join(root, '.arch'), link);
    const saved = await writeFilesSafely(join(link, 'deep', 'er'), [{ rel: 'a.txt', content: 'x' }], { forbidInside: [join(root, '.arch')] });
    expect(saved.ok).toBe(false);
    expect(await readdir(join(root, '.arch'))).toEqual([]);
  });

  it('realResolve resolves the nearest existing ancestor and keeps the missing tail', async () => {
    const real = await tempDir();
    const link = join(await tempDir(), 'l');
    await symlink(real, link);
    expect(await realResolve(join(link, 'a', 'b'))).toBe(join(await realResolve(real), 'a', 'b'));
  });

  it('isWithin treats a child folder named "..x" as inside and a real parent as outside', () => {
    expect(isWithin('/a/b', '/a/b/..x')).toBe(true);
    expect(isWithin('/a/b', '/a/b/..x/y')).toBe(true);
    expect(isWithin('/a/b', '/a/b')).toBe(true);
    expect(isWithin('/a/b', '/a')).toBe(false);
    expect(isWithin('/a/b', '/a/c')).toBe(false);
  });

  it('refuses a target under a folder named "..x" inside a forbidden folder', async () => {
    const root = await tempDir();
    await mkdir(join(root, '.arch'));
    const saved = await writeFilesSafely(join(root, '.arch', '..x'), [{ rel: 'a.txt', content: 'x' }], { forbidInside: [join(root, '.arch')] });
    expect(saved.ok).toBe(false);
  });

  it('removes the temp file when the write fails after it was created', async () => {
    const dir = await tempDir();
    const write = (async (path, _data, opts) => {
      await writeFile(path, 'partial', opts as never);
      throw new Error('disco cheio');
    }) as typeof writeFile;
    const saved = await writeFilesSafely(dir, [{ rel: 'a.txt', content: 'x' }], { write });
    expect(saved.ok).toBe(false);
    expect(await readdir(dir)).toEqual([]);
  });
});
