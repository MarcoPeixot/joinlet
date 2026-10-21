// Build stamp: proves which sources a `dist/` was built from. Plain ESM so both vite.config.ts and the
// bundle test can import it (the web package has no Node types).
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Written next to `index.html` by the build (see `sourceStampPlugin`). */
export const STAMP_FILE = 'build-stamp.json';

const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.vite', 'coverage', 'test-results', 'playwright-report']);
/** Tests do not reach the bundle: editing one must not make a build look old. */
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) walk(path, out);
    } else if (entry.isFile() && !TEST_FILE.test(entry.name)) out.push(path);
  }
}

/** Every file the web build can read, as absolute paths in a stable order. */
export function sourceFiles(repoRoot) {
  const root = typeof repoRoot === 'string' && repoRoot.startsWith('file:') ? fileURLToPath(repoRoot) : repoRoot;
  const files = [];
  const web = join(root, 'apps/web');
  for (const dir of ['src', 'app', 'setup', 'build']) walk(join(web, dir), files);
  for (const file of ['index.html', 'package.json', 'vite.config.ts', 'tsconfig.json']) files.push(join(web, file));
  files.push(join(root, 'bun.lock'));
  let packages = [];
  try {
    packages = readdirSync(join(root, 'packages'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    // no packages folder: nothing to add
  }
  for (const name of packages) {
    walk(join(root, 'packages', name, 'src'), files);
    files.push(join(root, 'packages', name, 'package.json'));
  }
  return files.sort();
}

/** Hash of the paths and contents of `sourceFiles`: changes when, and only when, something the build reads changes. */
export function sourceHash(repoRoot) {
  const root = typeof repoRoot === 'string' && repoRoot.startsWith('file:') ? fileURLToPath(repoRoot) : repoRoot;
  const hash = createHash('sha256');
  for (const file of sourceFiles(root)) {
    let content;
    try {
      content = readFileSync(file);
    } catch {
      continue; // a file that does not exist (no bun.lock in a copy) is the same on both sides
    }
    hash.update(relative(root, file).split(sep).join('/'));
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** Why a build is not for the current sources, or `null` when it is. `stampText` is the stamp file's content, if any. */
export function staleReason(stampText, currentHash) {
  if (stampText === undefined) return 'o dist não tem carimbo de build (build-stamp.json): ele veio de um build anterior a este teste';
  let stamp;
  try {
    stamp = JSON.parse(stampText);
  } catch {
    return 'o carimbo de build do dist está ilegível';
  }
  if (!stamp || typeof stamp.sources !== 'string') return 'o carimbo de build do dist está ilegível';
  if (stamp.sources !== currentHash) return 'o dist foi gerado de fontes diferentes das atuais (fonte editada depois do build)';
  return null;
}

/** Vite plugin: records the hash of the sources as the build STARTS (an edit during the build then reads as stale). */
export function sourceStampPlugin(repoRoot) {
  let sources = '';
  let outDir = '';
  return {
    name: 'strukt-source-stamp',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    buildStart() {
      sources = sourceHash(repoRoot);
    },
    writeBundle() {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, STAMP_FILE), `${JSON.stringify({ sources, builtAt: new Date().toISOString() })}\n`);
    },
  };
}
