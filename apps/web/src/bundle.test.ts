import { describe, expect, it } from 'vitest';
import { INITIAL_JS_BYTES } from '../build/loadingBudget';
import { sourceHash, staleReason } from '../build/sourceStamp.mjs';

// Read through Vite's glob (no Node types in this package). Needs `bun run build` first.
const pages = import.meta.glob<string>('../dist/app/index.html', { query: '?raw', import: 'default', eager: true });
const stamps = import.meta.glob<string>('../dist/build-stamp.json', { query: '?raw', import: 'default', eager: true });
const assets = import.meta.glob<string>('../dist/assets/*.js', { query: '?raw', import: 'default' });
const landingPages = import.meta.glob<string>('../dist/index.html', { query: '?raw', import: 'default', eager: true });
const html = Object.values(pages)[0];

/**
 * The measurement is only worth anything for the sources it is run against: a `dist/` left from an older build
 * would pass (or fail) for the wrong code. The build records a hash of the sources in `dist/build-stamp.json`
 * (build/sourceStamp.mjs); here it is compared with the sources as they are now.
 * - no `dist/`: skipped, with a warning (set STRUKT_REQUIRE_BUNDLE=1, as CI does after the build, to fail instead);
 * - `dist/` from other sources: fails, telling to rebuild (STRUKT_BUNDLE_ALLOW_STALE=1 measures it anyway).
 */
const env = (name: string): string | undefined => (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env[name];
const stale = html === undefined ? null : staleReason(Object.values(stamps)[0], sourceHash(new URL('../../..', import.meta.url).href));
const allowStale = env('STRUKT_BUNDLE_ALLOW_STALE') === '1';

if (html === undefined && env('STRUKT_REQUIRE_BUNDLE') !== '1') {
  console.warn('bundle.test: no dist/ (run `bun run build`); the initial bundle size was NOT measured.');
}

describe.skipIf(html === undefined && env('STRUKT_REQUIRE_BUNDLE') !== '1')('dist is the build of these sources', () => {
  it('exists', () => {
    expect(html, 'dist/app/index.html missing: run `bun run build` first').toBeDefined();
  });

  it('matches the current sources', () => {
    if (allowStale) return;
    expect(stale, `${stale}. Rode \`bun run build\` (ou STRUKT_BUNDLE_ALLOW_STALE=1 para medir mesmo assim).`).toBeNull();
  });
});

describe.skipIf(html === undefined || (stale !== null && !allowStale))('initial chunks', () => {
  const files = [...new Set([...(html ?? '').matchAll(/assets\/([\w.-]+\.js)/g)].map((m) => m[1]!))];
  const load = (file: string) => assets[`../dist/assets/${file}`]!();

  it('are the ones the editor entry references', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('do not statically pull yjs, codemirror or dompurify', async () => {
    for (const file of files) {
      const code = await load(file);
      expect(code, file).not.toMatch(/Yjs was already imported/);
      expect(code, file).not.toMatch(/@codemirror|cm-editor/);
      expect(code, file).not.toMatch(/DOMPurify/);
    }
  });

  it('do not statically pull the eraser router or the context generator', async () => {
    for (const file of files) {
      const code = await load(file);
      expect(code, file).not.toMatch(/RTree bulk-load selection stack/);
      expect(code, file).not.toMatch(/## Arquitetura \(Joinlet\)/);
    }
  });

  it('preloads fit the shared production budget; the network test also covers lazy modules and workers', async () => {
    const sizes = await Promise.all(files.map(async (file) => (await load(file)).length));
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(INITIAL_JS_BYTES);
  });
});

describe('build stamp', () => {
  it('reports a missing or unreadable stamp, and a stamp of other sources', () => {
    expect(staleReason(undefined, 'abc')).toMatch(/não tem carimbo/);
    expect(staleReason('not json', 'abc')).toMatch(/ilegível/);
    expect(staleReason('{}', 'abc')).toMatch(/ilegível/);
    expect(staleReason(JSON.stringify({ sources: 'old' }), 'abc')).toMatch(/fontes diferentes/);
    expect(staleReason(JSON.stringify({ sources: 'abc' }), 'abc')).toBeNull();
  });
});

describe.skipIf(html === undefined || (stale !== null && !allowStale))('landing delivery', () => {
  it('ships meaningful HTML and keeps the full icon catalog out of initial downloads', async () => {
    const landing = Object.values(landingPages)[0]!;
    expect(landing).toContain('<h1>');
    expect(landing).toContain('og:image');
    const files = [...new Set([...landing.matchAll(/assets\/([\w.-]+\.js)/g)].map(m => m[1]!))];
    expect(files.some(file => file.startsWith('simple-icons-'))).toBe(false);
    const sizes = await Promise.all(files.map(async file => (await assets[`../dist/assets/${file}`]!()).length));
    expect(sizes.reduce((a,b) => a+b,0)).toBeLessThan(1_500_000);
  });
});
