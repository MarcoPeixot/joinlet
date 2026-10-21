import { emptyLayout, emptyModel } from '@strukt/core';
import { assignDiffSvgNames, diffSvgFileName } from '@strukt/git';
import { buildSiteReport } from '@strukt/workspace';
import type { WorkspaceData } from '@strukt/workspace';
import { describe, expect, it } from 'vitest';

/** The site page names and the diff SVG names both come from untrusted manifest slugs: they must agree on what is a file name. */
const CORPUS = [
  'loja', 'a', 'A', 'a-b_c', 'a.b', 'v1.2.3', '9lives', '_x', '-x', 'a-',
  '~', 'a~2', '~a', '.', '..', '.hidden', 'a.', 'a..', '',
  'con', 'CON', 'nul', 'aux', 'prn', 'com1', 'LPT9', 'con.txt', 'com0', 'console',
  'a'.repeat(100), 'a'.repeat(101), 'ção', 'café', 'ａｂｃ', '日本', 'a b', 'a/b', 'a\\b', '../x', 'a\0b', 'a\nb', 'a:b', '__proto__', 'constructor', 'toString',
];

function siteAccepts(slug: string): boolean {
  const data: WorkspaceData = {
    manifest: { version: 1, name: 'x', diagrams: [{ slug, title: 't' }], docs: [], sketches: [] },
    diagrams: Object.fromEntries([[slug, { model: emptyModel(), layout: emptyLayout() }]]),
    docs: {},
    sketches: {},
    board: { cards: [] } as unknown as WorkspaceData['board'],
  };
  const { files } = buildSiteReport(data, { renderDiagramSvg: () => '<svg xmlns="http://www.w3.org/2000/svg"/>' });
  return Object.keys(files).some((path) => path.startsWith('diagrams/'));
}

describe('slug allowlists agree across the site and the diff SVG writer', () => {
  it.each(CORPUS.map((slug) => [JSON.stringify(slug), slug] as const))('%s', (_label, slug) => {
    expect(diffSvgFileName(slug) !== null, 'diffSvgFileName').toBe(siteAccepts(slug));
  });

  it('gives case- and Unicode-colliding slugs distinct names on both sides', () => {
    const slugs = ['Loja', 'loja', 'LOJA', 'ａｂｃ', 'abc'];
    const names = assignDiffSvgNames(slugs).flatMap((n) => (n.name ? [n.name.toLowerCase().normalize('NFKC')] : []));
    expect(names).toHaveLength(4);
    expect(new Set(names).size).toBe(4);
    const data: WorkspaceData = {
      manifest: { version: 1, name: 'x', diagrams: slugs.map((slug) => ({ slug, title: slug })), docs: [], sketches: [] },
      diagrams: {},
      docs: {},
      sketches: {},
      board: { cards: [] } as unknown as WorkspaceData['board'],
    };
    const pages = Object.keys(buildSiteReport(data, { renderDiagramSvg: () => '<svg/>' }).files).filter((p) => p.startsWith('diagrams/'));
    // 'ａｂｃ' is not a valid slug (fullwidth), so it is skipped on both sides; the rest keep unique folded names.
    const folded = pages.map((p) => p.toLowerCase().normalize('NFKC'));
    expect(new Set(folded).size).toBe(folded.length);
    expect(pages).toHaveLength(4);
  });
});
