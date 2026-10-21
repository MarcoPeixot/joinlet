import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sourceFiles, sourceHash, staleReason } from '../build/sourceStamp.mjs';

/** A minimal repository: what the build reads, and files it never reads. */
let root = '';
const write = (path: string, text: string) => {
  const full = join(root, path);
  mkdirSync(full.slice(0, full.lastIndexOf('/')), { recursive: true });
  writeFileSync(full, text);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'strukt-stamp-'));
  write('apps/web/src/main.tsx', 'a');
  write('apps/web/app/index.html', '<html/>');
  write('apps/web/index.html', '<html/>');
  write('apps/web/package.json', '{}');
  write('packages/core/src/model.ts', 'm');
  write('packages/core/package.json', '{}');
  write('bun.lock', 'lock');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('sourceHash (the build stamp)', () => {
  it('is stable for the same sources and changes when a source changes', () => {
    const before = sourceHash(root);
    expect(sourceHash(root)).toBe(before);
    write('packages/core/src/model.ts', 'changed');
    expect(sourceHash(root)).not.toBe(before);
  });

  it('changes with an app source, the editor page, a new file and the lockfile', () => {
    const seen = new Set([sourceHash(root)]);
    for (const [path, text] of [['apps/web/src/main.tsx', 'b'], ['apps/web/app/index.html', '<html lang="pt"/>'], ['apps/web/src/new.ts', 'x'], ['bun.lock', 'lock2']] as const) {
      write(path, text);
      seen.add(sourceHash(root));
    }
    expect(seen.size).toBe(5);
  });

  it('ignores tests, node_modules and a previous build', () => {
    const before = sourceHash(root);
    write('apps/web/src/main.test.ts', 'a test');
    write('packages/core/src/model.spec.tsx', 'a spec');
    write('apps/web/src/node_modules/x/index.js', 'dep');
    write('apps/web/dist/assets/a.js', 'old build');
    expect(sourceHash(root)).toBe(before);
    expect(sourceFiles(root).some((file) => /\.test\.|node_modules|\/dist\//.test(file))).toBe(false);
  });

  it('flags a build whose stamp is of other sources, exactly as the bundle test does', () => {
    const stamp = JSON.stringify({ sources: sourceHash(root) });
    expect(staleReason(stamp, sourceHash(root))).toBeNull();
    write('apps/web/src/main.tsx', 'edited after the build');
    expect(staleReason(stamp, sourceHash(root))).toMatch(/fontes diferentes/);
  });
});
