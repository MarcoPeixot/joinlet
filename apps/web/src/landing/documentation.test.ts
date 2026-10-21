import { describe, expect, it } from 'vitest';
// @ts-expect-error The static generator is native ESM shared with Vite.
import { documentationAssets } from '../../docs/site.mjs';
import content from '../../docs/content.json';

describe('product documentation', () => {
  it('publishes both languages with resolvable internal links and heading anchors', () => {
    const assets = documentationAssets() as Map<string,string>;
    expect(content.some(page => page.slug === 'beta')).toBe(true);
    for (const page of content) for (const lang of ['en','pt-BR'] as const) {
      expect(page[lang].body.length).toBeGreaterThan(700);
      expect(assets.has(`docs/${lang}/${page.slug}/index.html`)).toBe(true);
    }
    for (const [file,html] of assets) {
      if (!file.endsWith('.html')) continue;
      expect((html.match(/<h1>/g)??[]).length).toBe(1);
      const base=html.match(/<base href="([^"]+)"/)![1];
      for (const match of html.matchAll(/href="([^"]+)"/g)) {
        const url=new URL(match[1]!,`https://local.test${base}`);
        if (url.origin!=='https://local.test'||!url.pathname.startsWith('/docs/')) continue;
        const target=url.pathname.slice(1)+(url.pathname.endsWith('/')?'index.html':'');
        expect(assets.has(target),`${file} → ${match[1]}`).toBe(true);
        if (url.hash) expect(assets.get(target),`${target}${url.hash}`).toContain(`id="${url.hash.slice(1)}"`);
      }
    }
  });
});
