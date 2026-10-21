import { applyOps, emptyLayout, emptyModel } from '@strukt/core';
import type { DiagramModel, DiagramOp } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { emptyBoard } from './board';
import { buildSite, buildSiteReport } from './site';
import type { SiteDeps } from './site';
import type { WorkspaceData } from './workspace';

function model(ops: DiagramOp[]): DiagramModel {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

const deps: SiteDeps = { renderDiagramSvg: (slug, m) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>${slug}</title><text>${m.order.length}</text></svg>` };

const shop = model([
  { op: 'add_group', id: 'Serviços' },
  { op: 'add_node', id: 'API', parentId: 'Serviços', tech: 'Node.js' },
  { op: 'add_node', id: 'DB' },
  { op: 'update', id: 'API', set: { link: 'doc:api', description: 'Porta de <entrada>' } },
  { op: 'update', id: 'DB', set: { link: 'https://exemplo.com/db?a=1&b=2' } },
  { op: 'connect', from: 'API', to: 'DB', label: 'SQL' },
]);

function workspace(over: Partial<WorkspaceData> = {}): WorkspaceData {
  return {
    manifest: {
      version: 1,
      name: 'Loja',
      diagrams: [{ slug: 'loja', title: 'Loja' }],
      docs: [{ slug: 'api', title: 'API' }],
      sketches: [{ slug: 'rascunho', title: 'Rascunho' }],
    },
    diagrams: { loja: { model: shop, layout: emptyLayout() } },
    docs: { api: '# API\n\nVeja [a loja](doc:loja) e [x](doc:api) e [docs](https://exemplo.com).' },
    sketches: { rascunho: '{}' },
    board: emptyBoard(),
    ...over,
  };
}

const bomb = '<script>alert(1)</script><img src=x onerror=alert(1)>"\'';
function hostile(): WorkspaceData {
  const evil = model([{ op: 'add_node', id: 'n1', label: bomb, tech: bomb }, { op: 'update', id: 'n1', set: { link: 'javascript:alert(1)', description: bomb } }, { op: 'add_node', id: 'n2', label: 'constructor' }, { op: 'connect', from: 'n1', to: 'n2', label: bomb }]);
  const list = ['a', 'A', '__proto__', 'constructor', 'toString', '../x', 'a/b', 'con', 'a.b', '.hidden', ''].map((slug) => ({ slug, title: bomb }));
  const diagrams: Record<string, { model: DiagramModel; layout: ReturnType<typeof emptyLayout> }> = {};
  const docs: Record<string, string> = {};
  for (const { slug } of list) {
    Object.defineProperty(diagrams, slug, { value: { model: evil, layout: emptyLayout() }, enumerable: true, configurable: true, writable: true });
    Object.defineProperty(docs, slug, { value: `# ${bomb}\n\n[x](javascript:alert(1)) ${bomb}\n\n[y](doc:constructor)`, enumerable: true, configurable: true, writable: true });
  }
  return { ...workspace(), manifest: { version: 1, name: bomb, diagrams: list, docs: list, sketches: list }, diagrams, docs, sketches: {} };
}

describe('buildSite', () => {
  it('produces the index, style.css and one page per diagram and doc', () => {
    const files = buildSite(workspace(), deps);
    expect(Object.keys(files).sort()).toEqual(['diagrams/loja.html', 'docs/api.html', 'index.html', 'style.css']);
    const index = files['index.html']!;
    expect(index).toContain('<title>Loja');
    expect(index).toContain('href="diagrams/loja.html"');
    expect(index).toContain('href="docs/api.html"');
    expect(index).toContain('Rascunho');
    expect(index).toContain('lang="pt-BR"');
  });

  it('diagram page has inline svg, an element list and links to docs', () => {
    const page = buildSite(workspace(), deps)['diagrams/loja.html']!;
    expect(page).toContain('<svg');
    expect(page).toContain('href="../style.css"');
    expect(page).toContain('href="../index.html"');
    expect(page).toContain('Node.js');
    expect(page).toContain('Porta de &lt;entrada&gt;');
    expect(page).toContain('href="../docs/api.html"');
    expect(page).toContain('href="https://exemplo.com/db?a=1&amp;b=2" rel="noopener noreferrer" target="_blank"');
    expect(page).toContain('API');
    expect(page).toContain('SQL');
  });

  it('doc page renders markdown, rewrites doc: links and degrades missing targets', () => {
    const page = buildSite(workspace(), deps)['docs/api.html']!;
    expect(page).toContain('<h2>API</h2>');
    expect(page).toContain('<p>Veja a loja e <a href="api.html" rel="noopener noreferrer">x</a>');
    expect(page).toContain('<a href="../diagrams/loja.html">Loja</a>'); // "Usado em"
    expect(page).not.toContain('doc:');
    expect(page).toContain('href="https://exemplo.com" rel="noopener noreferrer" target="_blank"');
    const missing = buildSite(workspace({ docs: { api: '[x](doc:sumiu)' } }), deps)['docs/api.html']!;
    expect(missing).not.toContain('sumiu');
    expect(missing).toContain('<p>x</p>');
  });

  it('is self-contained: strict CSP, no script, no external resources', () => {
    for (const [path, html] of Object.entries(buildSite(workspace(), deps))) {
      if (!path.endsWith('.html')) continue;
      expect(html, path).toContain("default-src 'none'");
      expect(html, path).toContain("style-src 'self'");
      expect(html, path).not.toMatch(/<script|<iframe|<object|<embed|<link[^>]+rel="(?!stylesheet)|@import|<img|\bstyle=/i);
      expect(html, path).not.toMatch(/(?:src|href)="(?:\/\/|javascript:|data:)/i);
    }
    expect(buildSite(workspace(), deps)['style.css']).toContain('prefers-color-scheme: dark');
    expect(buildSite(workspace(), deps)['style.css']).not.toMatch(/url\(|@import/);
  });

  it('is deterministic', () => {
    expect(buildSite(workspace(), deps)).toEqual(buildSite(workspace(), deps));
    expect(JSON.stringify(buildSite(hostile(), deps))).toBe(JSON.stringify(buildSite(hostile(), deps)));
  });

  it('escapes titles, labels and names everywhere; nothing hostile survives (hostile fixture)', () => {
    const { files, skipped } = buildSiteReport(hostile(), deps);
    expect(Object.keys(files).length).toBeGreaterThan(3);
    for (const [path, content] of Object.entries(files)) {
      if (!path.endsWith('.html')) continue;
      expect(content, path).not.toMatch(/<script|<img|javascript:/i);
      for (const tag of content.matchAll(/<[^>]*>/g)) expect(tag[0], path).not.toMatch(/\son\w+\s*=/i);
      expect(content, path).toContain('&lt;script&gt;');
      // every '<' opens a tag from our own small vocabulary (svg pieces come from the injected renderer)
      for (const m of content.matchAll(/<\/?([a-zA-Z0-9]+)/g)) expect(['html', 'head', 'meta', 'title', 'link', 'body', 'header', 'main', 'nav', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'ul', 'ol', 'li', 'section', 'figure', 'figcaption', 'article', 'svg', 'text', 'dl', 'dt', 'dd', 'code', 'pre', 'strong', 'em', 'blockquote', 'hr', 'span', 'small']).toContain(m[1]);
    }
    expect(skipped.length).toBeGreaterThan(0);
  });

  it('skips hostile slugs and never writes outside the map', () => {
    const files = buildSite(hostile(), deps);
    for (const path of Object.keys(files)) {
      expect(path).toMatch(/^(?:index\.html|style\.css|(?:diagrams|docs)\/[A-Za-z0-9_~][A-Za-z0-9._~-]*\.html)$/);
      expect(path).not.toContain('..');
      expect(path.toLowerCase()).not.toContain('__proto__');
    }
    const paths = Object.keys(files).map((p) => p.toLowerCase());
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain('diagrams/constructor.html');
    expect(paths).toContain('diagrams/a.html');
    expect(paths).toContain('diagrams/a~2.html');
    expect(paths).toContain('diagrams/_con.html');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects an unsafe svg from the renderer', () => {
    const page = buildSite(workspace(), { renderDiagramSvg: () => '<svg><script>alert(1)</script></svg>' })['diagrams/loja.html']!;
    expect(page).not.toContain('<script');
    expect(page).toContain('Não foi possível exibir');
  });

  it('keeps a diagram whose escaped label merely contains one=, href= or javascript:', () => {
    const benign: SiteDeps = { renderDiagramSvg: () => '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="one= href=x javascript:1"><title>one=1</title><text x="1">href=&quot;javascript:x&quot; onclick=1</text></svg>' };
    const report = buildSiteReport(workspace(), benign);
    expect(report.files['diagrams/loja.html']).toContain('<svg');
    expect(report.files['diagrams/loja.html']).not.toContain('Não foi possível exibir');
    expect(report.skipped).toEqual([]);
  });

  it('still rejects real event handlers, hrefs, script URLs, animation/use/image, namespaced tags and unbalanced tags, with a skipped note', () => {
    for (const svg of [
      '<svg><text onclick="x()">a</text></svg>',
      '<svg><text\nonload = "x()">a</text></svg>',
      '<svg><g href="javascript:alert(1)"/></svg>',
      '<svg><a xlink:href="http://x">y</a></svg>',
      '<svg><text x="1>a</text></svg>',
      '<svg><text>a<b</svg>',
      '<svg><rect fill="JaVa\tScRiPt:alert(1)"/></svg>',
      '<svg><rect fill="  javascript:alert(1)"/></svg>',
      '<svg><rect fill="java&#115;cript&colon;alert(1)"/></svg>',
      '<svg><rect fill=&#x6A;avascript:alert(1)/></svg>',
      '<svg><rect fill=javascript:alert(1)/></svg>',
      '<svg><animate attributeName="x" to="1"/></svg>',
      '<svg><set attributeName="x" to="1"/></svg>',
      '<svg><use href2="#a"/></svg>',
      '<svg><image src="x"/></svg>',
      '<svg><svg:script>alert(1)</svg:script></svg>',
      '<svg><x:foo/></svg>',
    ]) {
      const report = buildSiteReport(workspace(), { renderDiagramSvg: () => svg });
      expect(report.files['diagrams/loja.html'], svg).toContain('Não foi possível exibir');
      expect(report.skipped.some((n) => n.includes('loja') && n.includes('SVG')), svg).toBe(true);
    }
  });

  it('caps the number of pages with a pt-BR note', () => {
    const many = Array.from({ length: 260 }, (_, i) => ({ slug: `d${i}`, title: `D${i}` }));
    const diagrams = Object.fromEntries(many.map(({ slug }) => [slug, { model: shop, layout: emptyLayout() }]));
    const files = buildSite(workspace({ manifest: { ...workspace().manifest, diagrams: many }, diagrams }), deps);
    expect(Object.keys(files).filter((p) => p.startsWith('diagrams/')).length).toBe(200);
    expect(files['index.html']).toContain('mostrando os primeiros 200');
  });

  it('handles an empty workspace', () => {
    const files = buildSite({ ...workspace(), manifest: { version: 1, name: 'Vazio', diagrams: [], docs: [], sketches: [] }, diagrams: {}, docs: {}, sketches: {} }, deps);
    expect(Object.keys(files).sort()).toEqual(['index.html', 'style.css']);
    expect(files['index.html']).toContain('Nenhum diagrama');
  });
});

describe('perspective pages', () => {
  const layered = model([
    { op: 'add_node', id: 'Usuário' },
    { op: 'add_group', id: 'Plataforma' },
    { op: 'add_node', id: 'API', parentId: 'Plataforma', tech: 'Node' },
    { op: 'add_node', id: 'DB', parentId: 'Plataforma', tech: 'Postgres' },
    { op: 'connect', from: 'Usuário', to: 'API', label: 'usa' },
    { op: 'connect', from: 'API', to: 'DB' },
  ]);
  const shared = {
    version: 1 as const,
    entities: {
      u: { id: 'u', tags: ['nivel:contexto'] }, p: { id: 'p', tags: ['nivel:contexto'] },
      a: { id: 'a', tags: ['nivel:container', 'risco:alto'] }, d: { id: 'd', tags: ['nivel:container'] },
    },
    views: { loja: { Usuário: 'u', Plataforma: 'p', API: 'a', DB: 'd' } },
  };
  const withLevels = (over: Partial<WorkspaceData> = {}) => workspace({ diagrams: { loja: { model: layered, layout: emptyLayout() } }, shared, ...over });

  it('adds nothing for a diagram without perspectives or levels (the built-in ones need levels)', () => {
    const files = buildSite(workspace(), deps);
    expect(Object.keys(files).sort()).toEqual(['diagrams/loja.html', 'docs/api.html', 'index.html', 'style.css']);
  });

  it('makes a page per perspective that shows something, linked from the diagram page', () => {
    const files = buildSite(withLevels({ perspectives: { loja: [{ id: 'riscos', name: 'Riscos <altos>', description: 'O que quebra', tags: ['risco:alto'] }, { id: 'vazia', name: 'Vazia', tags: ['risco:inexistente'] }] } }), deps);
    expect(Object.keys(files).filter((path) => path.includes('~p~')).sort()).toEqual([
      'diagrams/loja~p~c4-componentes.html', 'diagrams/loja~p~c4-containers.html', 'diagrams/loja~p~c4-contexto.html', 'diagrams/loja~p~riscos.html',
    ]);
    const page = files['diagrams/loja.html']!;
    expect(page).toContain('href="loja~p~riscos.html"');
    expect(page).toContain('Riscos &lt;altos&gt;');
    expect(page).not.toContain('loja~p~vazia');
  });

  it('draws the perspective, not the whole diagram, and lists only what it shows', () => {
    const files = buildSite(withLevels(), deps);
    const contexto = files['diagrams/loja~p~c4-contexto.html']!;
    expect(contexto).toContain('<svg');
    expect(contexto).toContain('<text>2</text>');
    expect(contexto).toContain('Usuário');
    expect(contexto).not.toContain('Postgres');
    expect(contexto).toContain('C4: Contexto');
    expect(contexto).toContain('href="loja.html"');
    expect(files['diagrams/loja~p~c4-containers.html']).toContain('Postgres');
  });

  it('escapes what the files say, and takes unsafe ids as no page', () => {
    const files = buildSite(withLevels({ perspectives: { loja: [{ id: 'a"b', name: 'x' }, { id: 'xss', name: bomb, description: bomb, tags: ['risco:alto'] }] } }), deps);
    const page = files['diagrams/loja~p~xss.html']!;
    expect(page).not.toContain('<script>alert(1)</script>');
    expect(page).not.toMatch(/<img/);
    expect(Object.keys(files).some((path) => path.includes('a"b'))).toBe(false);
  });

  it('caps the pages per diagram and says so', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, tags: ['risco:alto'] }));
    const report = buildSiteReport(withLevels({ perspectives: { loja: many } }), deps);
    expect(Object.keys(report.files).filter((path) => path.includes('~p~'))).toHaveLength(20);
    expect(report.skipped.join(' ')).toContain('Limite de perspectivas');
  });
});

