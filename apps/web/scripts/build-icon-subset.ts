/**
 * Regenerates `src/diagram/icons/simple-subset.json`: the simple-icons brands (`slug → { title, hex, path }`)
 * the app itself references (curated registry, sample diagrams, fixtures, tests). The full package is ~5 MB of
 * JavaScript, so the registry renders from this subset and only loads the package for a brand outside it
 * (the catalog search and arbitrary `si:` names). Run from `apps/web` after adding a brand to the code or samples:
 *
 *   bun scripts/build-icon-subset.ts
 *
 * It also writes `simple-index.json` (`[slug, title]` of every brand in the package's own order, ~80 KB): the icon picker lists and searches
 * brands from it, so opening the picker never loads the package. `--index` writes only that file.
 *
 * A word is kept when, stripped of non-alphanumerics (and of a leading `si:`), it is a simple-icons slug.
 * Over-including a common word is harmless: lucide is tried first and the entry is what the package returns.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as simple from 'simple-icons';

const root = new URL('../../../', import.meta.url).pathname;
const SCAN = ['apps/web/src', 'apps/web/e2e', 'apps/server/src', 'apps/mcp/src', 'apps/cli/src', 'packages'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
const SKIP_FILES = /(logos-subset|lucide-categories|brand-categories|simple-subset|simple-index)\.json$/;
const EXT = /\.(ts|tsx|json|strukt|md)$/;

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) yield* files(path);
    else if (EXT.test(name) && !SKIP_FILES.test(name) && stat.size < 400_000) yield path;
  }
}

const bySlug = new Map<string, { title: string; hex: string; path: string }>();
for (const value of Object.values(simple)) {
  if (value && typeof value === 'object' && 'slug' in value && 'path' in value && 'hex' in value && 'title' in value) {
    const icon = value as { slug: string; title: string; hex: string; path: string };
    bySlug.set(icon.slug, { title: icon.title, hex: icon.hex, path: icon.path });
  }
}

const indexOnly = process.argv.includes('--index');
const index = [...bySlug].map(([slug, icon]) => [slug, icon.title]);
writeFileSync(new URL('../src/diagram/icons/simple-index.json', import.meta.url), `${JSON.stringify(index)}\n`);
console.log(`simple-index.json: ${bySlug.size} brands`);
if (indexOnly) process.exit(0);

const used = new Set<string>();
for (const dir of SCAN) {
  for (const file of files(join(root, dir))) {
    for (const word of readFileSync(file, 'utf8').toLowerCase().match(/[a-z0-9][a-z0-9:_.-]*/g) ?? []) {
      const slug = word.replace(/^si:/, '').replace(/[^a-z0-9]/g, '');
      if (bySlug.has(slug)) used.add(slug);
    }
  }
}

const subset = Object.fromEntries([...used].sort().map((slug) => [slug, bySlug.get(slug)!]));
writeFileSync(new URL('../src/diagram/icons/simple-subset.json', import.meta.url), `${JSON.stringify(subset)}\n`);
console.log(`simple-subset.json: ${used.size} of ${bySlug.size} brands`);
