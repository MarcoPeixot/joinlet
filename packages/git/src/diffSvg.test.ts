import { describe, expect, it } from 'vitest';
import { emptyModel } from '@strukt/core';
import type { DiagramModel, EdgeEl, LayoutState } from '@strukt/core';
import { assignDiffSvgNames, diffSvgFileName, renderDiagramSvg, renderDiffSvg } from './diffSvg';

const ADDED = '#30a050';
const REMOVED = '#bd413a';
const CHANGED = '#c38424';

function model(nodes: { id: string; label?: string; parentId?: string; kind?: 'node' | 'group' }[], edges: [string, string, string?][] = []): DiagramModel {
  const base = emptyModel();
  const elements: DiagramModel['elements'] = {};
  for (const n of nodes) elements[n.id] = { kind: n.kind ?? 'node', id: n.id, ...(n.label !== undefined ? { label: n.label } : {}), ...(n.parentId ? { parentId: n.parentId } : {}) } as never;
  const list: EdgeEl[] = edges.map(([from, to, label], i) => ({ id: `e${i}`, from, to, connector: '>', ...(label ? { label } : {}) }));
  return { ...base, elements, order: nodes.map((n) => n.id), edges: list };
}

const layout = (nodes: Record<string, { x: number; y: number }>): LayoutState => ({ nodes, edges: {} });

const ALLOWED_TAGS = new Set(['svg', 'g', 'rect', 'path', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc']);
const ALLOWED_ATTRS = new Set([
  'xmlns', 'viewBox', 'width', 'height', 'role', 'aria-label', 'x', 'y', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'fill-opacity', 'd', 'points', 'x1', 'y1', 'x2', 'y2', 'transform', 'font-family', 'font-size',
  'font-weight', 'text-anchor', 'dominant-baseline', 'opacity',
]);

function assertSafe(svg: string): void {
  expect(svg.startsWith('<svg ')).toBe(true);
  expect(svg).not.toMatch(/<!|<\?|href|xlink|@import|url\(|javascript:|<script|foreignObject/i);
  const stack: string[] = [];
  for (const m of svg.matchAll(/<(\/?)([A-Za-z][\w-]*)((?:\s+[\w:-]+="[^"<>]*")*)\s*(\/?)>/g)) {
    const [, close, name, attrs, self] = m;
    expect(ALLOWED_TAGS.has(name!)).toBe(true);
    for (const a of attrs!.matchAll(/\s([\w:-]+)="/g)) expect(ALLOWED_ATTRS.has(a[1]!)).toBe(true);
    if (close) expect(stack.pop()).toBe(name);
    else if (!self) stack.push(name!);
  }
  expect(stack).toEqual([]);
  // every '<' in the document starts a matched, allowed tag (no smuggled markup in text or attributes)
  const tags = [...svg.matchAll(/<(\/?)([A-Za-z][\w-]*)((?:\s+[\w:-]+="[^"<>]*")*)\s*(\/?)>/g)].length;
  expect(svg.split('<').length - 1).toBe(tags);
  // eslint-disable-next-line no-control-regex
  expect(svg).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f‪-‮⁦-⁩]/);
}

describe('renderDiffSvg', () => {
  const before = model([{ id: 'api' }, { id: 'db' }, { id: 'old' }], [['api', 'db'], ['api', 'old']]);
  const after = model([{ id: 'api', label: 'API v2' }, { id: 'db' }, { id: 'cache' }], [['api', 'db'], ['api', 'cache']]);
  const lb = layout({ api: { x: 0, y: 0 }, db: { x: 300, y: 0 }, old: { x: 300, y: 200 } });
  const la = layout({ api: { x: 0, y: 0 }, db: { x: 300, y: 0 }, cache: { x: 300, y: 200 } });

  it('colors added, changed and removed elements and titles it in pt-BR', () => {
    const svg = renderDiffSvg(before, after, lb, la, { title: 'Loja' });
    assertSafe(svg);
    expect(svg).toContain(ADDED);
    expect(svg).toContain(CHANGED);
    expect(svg).toContain(REMOVED);
    expect(svg).toContain('stroke-dasharray');
    expect(svg).toContain('Loja');
    expect(svg).toContain('Adicionado');
    expect(svg).toContain('Removido');
    expect(svg).toContain('Alterado');
    expect(svg).toContain('API v2');
    expect(svg).toContain('old');
  });

  it('draws removed elements at their BEFORE position', () => {
    const far = layout({ api: { x: 0, y: 0 }, db: { x: 300, y: 0 }, old: { x: 300, y: 400 } });
    const svg = renderDiffSvg(before, after, far, la);
    const y = (color: string, n: number) => Number(/\sy="([\d.-]+)"/.exec([...svg.matchAll(new RegExp(`<rect [^>]*stroke="${color}"[^>]*rx="6"[^>]*>|<rect [^>]*rx="6"[^>]*stroke="${color}"[^>]*>`, 'g'))][n]![0])![1]);
    const dbY = Number(/<rect x="(\d+)" y="([\d.-]+)"[^>]*stroke="#8a8a8a"/.exec(svg)![2]);
    expect(y(REMOVED, 0) - dbY).toBe(400);
  });

  it('nudges a removed element that would sit exactly under its replacement', () => {
    const svg = renderDiffSvg(before, after, lb, la);
    const ys = [...svg.matchAll(/<rect [^>]*rx="6"[^>]*stroke="#(?:bd413a|30a050)"/g)].map((m) => /\sx="([\d.-]+)" y="([\d.-]+)"/.exec(m[0])!.slice(1).join(','));
    expect(new Set(ys).size).toBe(2);
  });

  it('is deterministic', () => {
    expect(renderDiffSvg(before, after, lb, la)).toBe(renderDiffSvg(before, after, lb, la));
    expect(renderDiffSvg(before, after)).toBe(renderDiffSvg(before, after));
  });

  it('auto-places elements without layout, without overlap', () => {
    const svg = renderDiffSvg(before, after);
    assertSafe(svg);
    const rects = [...svg.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)" rx="6"/g)].map((m) => m.slice(1).map(Number) as [number, number, number, number]);
    expect(rects.length).toBe(4);
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const [ax, ay, aw, ah] = rects[i]!;
      const [bx, by, bw, bh] = rects[j]!;
      expect(ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah).toBe(false);
    }
  });

  it('draws changed edges (added green, removed red dashed)', () => {
    const svg = renderDiffSvg(before, after, lb, la);
    expect(svg).toMatch(/<line [^>]*stroke="#30a050"/);
    expect(svg).toMatch(/<line [^>]*stroke="#bd413a"[^>]*stroke-dasharray/);
  });

  it('returns a valid SVG saying "sem mudanças" for an empty diff', () => {
    const svg = renderDiffSvg(before, before, lb, lb);
    assertSafe(svg);
    expect(svg).toContain('sem mudanças');
    expect(svg).not.toContain(ADDED);
  });

  it('handles two empty models', () => {
    const svg = renderDiffSvg(emptyModel(), emptyModel());
    assertSafe(svg);
    expect(svg).toContain('sem mudanças');
  });

  it('survives hostile ids (constructor, toString, hasOwnProperty) and missing layout entries', () => {
    const a = model([{ id: 'constructor' }, { id: 'toString' }], [['constructor', 'toString']]);
    const b = model([{ id: 'constructor', label: 'x' }, { id: 'toString' }, { id: 'hasOwnProperty' }], [['constructor', 'hasOwnProperty']]);
    const svg = renderDiffSvg(a, b, layout({ toString: { x: 5, y: 5 } }), layout({ constructor: { x: 1, y: 1 } }));
    assertSafe(svg);
    expect(svg).toContain('hasOwnProperty');
  });

  it('never emits a __proto__ element and does not throw', () => {
    const a = model([{ id: 'a' }]);
    const b = model([{ id: 'a' }, { id: '__proto__' }]);
    assertSafe(renderDiffSvg(a, b));
  });

  it('tolerates hostile layout numbers', () => {
    const svg = renderDiffSvg(before, after, lb, { nodes: { api: { x: NaN, y: Infinity, w: -5, h: 1e300 }, db: { x: 1e300, y: -1e300 } }, edges: {} });
    assertSafe(svg);
    expect(svg).not.toMatch(/NaN|Infinity|e\+/);
    const w = Number(/<svg [^>]*width="([\d.]+)"/.exec(svg)![1]);
    const h = Number(/<svg [^>]*height="([\d.]+)"/.exec(svg)![1]);
    expect(w).toBeLessThanOrEqual(4000);
    expect(h).toBeLessThanOrEqual(4000);
  });

  describe('escaping', () => {
    const evil = [
      '<script>alert(1)</script>',
      '"onload="alert(1)',
      "' onmouseover='x",
      'a & b &amp; &#x3c;',
      ']]>',
      'ctl\u0000\u0001\u0008\u001f\u007fend',
      'rtl‮evil‬⁦x⁩‏',
      '</text><rect fill="red"/>',
      '<!-- c --><![CDATA[x]]>',
    ];
    for (const label of evil) {
      it(`escapes ${JSON.stringify(label).slice(0, 40)}`, () => {
        const svg = renderDiffSvg(model([]), model([{ id: 'n1', label }], [['n1', 'n1', label]]), undefined, layout({ n1: { x: 0, y: 0 } }), { title: label });
        assertSafe(svg);
        expect(svg).not.toContain('<script');
        expect(svg).not.toContain('</script');
      });
    }

    it('escapes markup characters to entities', () => {
      const svg = renderDiffSvg(model([]), model([{ id: 'n', label: `<b>&"'` }]));
      expect(svg).toContain('&lt;b&gt;&amp;&quot;&#39;');
    });

    it('truncates a 10k-char label', () => {
      const svg = renderDiffSvg(model([]), model([{ id: 'n', label: 'x'.repeat(10_000) }]));
      assertSafe(svg);
      expect(svg.length).toBeLessThan(6000);
      expect(svg).toContain('…');
    });

    it('does not split surrogate pairs when truncating', () => {
      const svg = renderDiffSvg(model([]), model([{ id: 'n', label: '😀'.repeat(200) }]));
      expect(svg).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
    });
  });

  it('caps huge diagrams at 400 drawn elements with a "+N" note', () => {
    const many = model(Array.from({ length: 3000 }, (_, i) => ({ id: `n${i}` })), Array.from({ length: 3000 }, (_, i) => [`n${i}`, `n${(i + 1) % 3000}`] as [string, string]));
    const svg = renderDiffSvg(emptyModel(), many);
    assertSafe(svg);
    expect((svg.match(/rx="6"/g) ?? []).length).toBeLessThanOrEqual(400);
    expect(svg).toContain('+2600');
    expect(svg.length).toBeLessThan(400_000);
    const w = Number(/<svg [^>]*width="([\d.]+)"/.exec(svg)![1]);
    expect(w).toBeLessThanOrEqual(4000);
  });

  it('draws groups around their children', () => {
    const a = model([{ id: 'g', kind: 'group' }, { id: 'a', parentId: 'g' }]);
    const b = model([{ id: 'g', kind: 'group' }, { id: 'a', parentId: 'g' }, { id: 'b', parentId: 'g' }]);
    const svg = renderDiffSvg(a, b);
    assertSafe(svg);
    expect(svg).toContain(ADDED);
  });
});

describe('diffSvgFileName', () => {
  it('accepts plain slugs', () => {
    expect(diffSvgFileName('api')).toBe('api.diff.svg');
    expect(diffSvgFileName('my-diagram_2.v1')).toBe('my-diagram_2.v1.diff.svg');
  });
  it('refuses separators, leading dots, empties and odd characters', () => {
    for (const slug of ['../x', 'a/b', 'a\\b', '.hidden', '..', '', 'a b', 'a\u0000b', 'x'.repeat(200), 'ç', 'a:b']) expect(diffSvgFileName(slug)).toBeNull();
  });
});

describe('diffSvgFileName reserved names', () => {
  it('prefixes Windows reserved device names, with or without extension, any case', () => {
    for (const slug of ['CON', 'con', 'PRN', 'aux', 'NUL', 'COM1', 'com9', 'LPT1', 'lpt9', 'con.v1', 'NUL.x']) {
      expect(diffSvgFileName(slug)).toBe(`_${slug}.diff.svg`);
    }
    expect(diffSvgFileName('COM0')).toBe('COM0.diff.svg');
    expect(diffSvgFileName('console')).toBe('console.diff.svg');
  });
});

describe('assignDiffSvgNames', () => {
  it('keeps unique names as-is and nulls invalid slugs', () => {
    expect(assignDiffSvgNames(['api', '../x'])).toEqual([{ slug: 'api', name: 'api.diff.svg' }, { slug: '../x', name: null }]);
  });
  it('disambiguates names that collide case-insensitively, by input order', () => {
    const r = assignDiffSvgNames(['A', 'a', 'a2', 'A']);
    expect(r.map((x) => x.name)).toEqual(['A.diff.svg', 'a~2.diff.svg', 'a2.diff.svg', 'A~3.diff.svg']);
    expect(new Set(r.map((x) => x.name!.toLowerCase())).size).toBe(4);
  });
  it('does not collide a prefixed reserved name with a real slug', () => {
    const r = assignDiffSvgNames(['CON', '_con']);
    expect(new Set(r.map((x) => x.name!.toLowerCase())).size).toBe(2);
  });
});

describe('renderDiagramSvg', () => {
  it('draws the whole diagram plainly: no diff header, legend or "sem mudanças"', () => {
    const svg = renderDiagramSvg(model([{ id: 'a', label: 'API' }, { id: 'b', label: '<b>DB</b>' }], [['a', 'b', 'lê']]), layout({ a: { x: 0, y: 0 }, b: { x: 300, y: 0 } }), { title: 'Loja' });
    expect(svg).toContain('API');
    expect(svg).toContain('&lt;b&gt;DB&lt;/b&gt;');
    expect(svg).toContain('lê');
    expect(svg).not.toContain('sem mudanças');
    expect(svg).not.toContain('Diff visual');
    expect(svg).not.toContain('Adicionados');
    expect(svg).not.toContain('<script');
    expect(renderDiagramSvg(emptyModel(), undefined)).toContain('<svg');
  });
});
