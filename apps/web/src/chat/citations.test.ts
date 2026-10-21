import { emptyModel } from '@strukt/core';
import type { DiagramModel } from '@strukt/core';
import { parseDiagramJson } from '@strukt/json';
import { describe, expect, it } from 'vitest';
import { citationHref, linkCitations, parseCitationHref, workspaceResolver } from './citations';
import type { CitationTarget } from './citations';

const model = (json: unknown): DiagramModel => parseDiagramJson(JSON.stringify(json)).model;

const checkout = model({ version: 1, nodes: [{ id: 'API Gateway', label: 'Gateway' }, { id: 'DB' }, { id: 'toString' }] });
const billing = model({ version: 1, nodes: [{ id: 'Ledger', label: 'Livro [caixa]' }, { id: 'DB' }] });
const diagrams = [
  { slug: 'checkout', title: 'Checkout', model: checkout },
  { slug: 'billing', title: 'Cobrança', model: billing },
];

describe('citationHref / parseCitationHref', () => {
  it('round-trips ids with spaces, accents, parentheses and slashes', () => {
    for (const id of ['API Gateway', 'Pagamento (v2)', 'a/b', 'Ação', "o'neil", 'x*y!', '100%', 'a#b']) {
      const href = citationHref('checkout', id);
      expect(href).toMatch(/^#cite\/checkout\/[A-Za-z0-9\-_.%]+$/);
      expect(parseCitationHref(href)).toEqual({ diagram: 'checkout', id });
    }
  });

  it.each([
    '#cite/checkout',
    '#cite//x',
    '#cite/checkout/',
    '#cite/../etc/x',
    '#cite/a/b/c',
    '#cite/a/b c',
    '#cite/a/<b>',
    '#cite/a/b"onclick=alert(1)',
    '#cite/a/%zz',
    '#cite/a/%E0%A4%A',
    '#cite/-a/b',
    '#CITE/a/b',
    'javascript:alert(1)',
    'https://x.test/#cite/a/b',
    '#cite/a/b\n',
    `#cite/a/${'x'.repeat(700)}`,
    `#cite/${'a'.repeat(200)}/b`,
    '',
  ])('refuses %j', (href) => {
    expect(parseCitationHref(href)).toBeNull();
  });

  it('refuses control characters and empty ids hidden behind percent-encoding', () => {
    expect(parseCitationHref('#cite/a/%00')).toBeNull();
    expect(parseCitationHref('#cite/a/%0A')).toBeNull();
    expect(parseCitationHref('#cite/a/%20%20')).toBeNull();
  });
});

describe('workspaceResolver', () => {
  const resolve = workspaceResolver(diagrams, 'checkout');

  it('resolves [[Id]] against the open diagram and shows the element label', () => {
    expect(resolve('API Gateway')).toEqual<CitationTarget>({ diagram: 'checkout', id: 'API Gateway', label: 'Gateway', diagramTitle: 'Checkout' });
    expect(resolve('DB')).toMatchObject({ diagram: 'checkout', id: 'DB', label: 'DB' });
  });

  it('resolves [[slug#Id]] to another diagram', () => {
    expect(resolve('billing#Ledger')).toEqual<CitationTarget>({ diagram: 'billing', id: 'Ledger', label: 'Livro [caixa]', diagramTitle: 'Cobrança' });
    expect(resolve('billing#DB')).toMatchObject({ diagram: 'billing' });
  });

  it('falls back to the only other diagram that has the id (the chat outlives the open diagram)', () => {
    expect(resolve('Ledger')).toMatchObject({ diagram: 'billing', id: 'Ledger' });
    const onBilling = workspaceResolver(diagrams, 'billing');
    expect(onBilling('DB')).toMatchObject({ diagram: 'billing' });
    expect(onBilling('API Gateway')).toMatchObject({ diagram: 'checkout' });
    // An id two diagrams share, with none of them open, is ambiguous: it stays text.
    expect(workspaceResolver(diagrams, null)('DB')).toBeNull();
  });

  it('leaves unknown ids, diagrams and malformed references as text', () => {
    for (const ref of ['Nada', 'nada#DB', 'billing#Nada', '#DB', 'billing#', '', ' ', 'a#b#c']) expect(resolve(ref)).toBeNull();
  });

  it('only matches own elements: inherited names are not elements, but real elements called like them are', () => {
    expect(resolve('constructor')).toBeNull();
    expect(resolve('__proto__')).toBeNull();
    expect(resolve('hasOwnProperty')).toBeNull();
    expect(resolve('checkout#__proto__')).toBeNull();
    expect(resolve('toString')).toMatchObject({ diagram: 'checkout', id: 'toString' });
    expect(workspaceResolver([{ slug: '__proto__', title: 'x', model: checkout }], null)('__proto__#DB')).toBeNull();
    expect(workspaceResolver([{ slug: 'constructor', title: 'x', model: checkout }], null)('constructor#DB')).toMatchObject({ diagram: 'constructor' });
  });

  it('copes with an empty workspace', () => {
    expect(workspaceResolver([], null)('DB')).toBeNull();
    expect(workspaceResolver([{ slug: 'e', title: 'E', model: emptyModel() }], 'e')('DB')).toBeNull();
  });
});

describe('linkCitations', () => {
  const resolve = workspaceResolver(diagrams, 'checkout');
  const link = (text: string) => linkCitations(text, resolve);

  it('turns a known citation into a link to the internal address, labelled with the element name', () => {
    expect(link('O [[API Gateway]] chama o [[DB]].')).toBe('O [Gateway](#cite/checkout/API%20Gateway) chama o [DB](#cite/checkout/DB).');
  });

  it('adds the diagram title when it is another diagram, and escapes the label', () => {
    expect(link('Veja [[billing#Ledger]].')).toBe('Veja [Livro \\[caixa\\]](#cite/billing/Ledger "Cobrança").');
  });

  it('keeps unknown ids as plain text', () => {
    expect(link('Fale do [[Inventado]] e do [[DB]].')).toBe('Fale do [[Inventado]] e do [DB](#cite/checkout/DB).');
  });

  it('does not touch code: fenced blocks, tilde fences, inline code and longer backtick spans', () => {
    const text = ['Antes [[DB]]', '```', '[[DB]]', '```', '~~~~', '[[DB]]', '~~~~', 'Inline `[[DB]]` e ``a [[DB]] b`` fim', 'Depois [[DB]]'].join('\n');
    const out = link(text).split('\n');
    expect(out[0]).toBe('Antes [DB](#cite/checkout/DB)');
    expect(out[2]).toBe('[[DB]]');
    expect(out[5]).toBe('[[DB]]');
    expect(out[7]).toBe('Inline `[[DB]]` e ``a [[DB]] b`` fim');
    expect(out[8]).toBe('Depois [DB](#cite/checkout/DB)');
  });

  it('treats an unclosed fence as code up to the end', () => {
    expect(link('x\n```\n[[DB]]\nmais [[DB]]')).toBe('x\n```\n[[DB]]\nmais [[DB]]');
  });

  it('is not fooled by a fence closed with a shorter marker', () => {
    expect(link('````\n```\n[[DB]]\n````\n[[DB]]')).toBe('````\n```\n[[DB]]\n````\n[DB](#cite/checkout/DB)');
  });

  it('never lets a label or title break out of the link markup', () => {
    const hostile = model({ version: 1, nodes: [{ id: 'x', label: 'a](javascript:alert(1)) [b' }, { id: 'y', label: 'line1\nline2 <img src=x onerror=alert(1)> `c` *d* _e_' }] });
    const out = linkCitations('[[x]] [[y]]', workspaceResolver([{ slug: 'checkout', title: 'T"; onclick="x', model: hostile }], 'checkout'));
    expect(out).toBe('[a\\]\\(javascript:alert\\(1\\)\\) \\[b](#cite/checkout/x) [line1 line2 \\<img src=x onerror=alert\\(1\\)\\> \\`c\\` \\*d\\* \\_e\\_](#cite/checkout/y)');
    const titled = linkCitations('[[other#x]]', workspaceResolver([{ slug: 'checkout', title: 'a', model: hostile }, { slug: 'other', title: 'T"; onclick="x\n[y](javascript:1)', model: hostile }], 'checkout'));
    expect(titled).toContain('"T\\"; onclick=\\"x \\[y\\]\\(javascript:1\\)"');
    expect(titled.split('\n')).toHaveLength(1);
  });

  it('does not match across lines, nested brackets or very long references', () => {
    expect(link('[[DB\n]]')).toBe('[[DB\n]]');
    expect(link('[[[DB]]]')).toBe('[[[DB]]]'.replace('[[DB]]', '[DB](#cite/checkout/DB)'));
    expect(link('[[[[DB]]]]')).toContain('[[[[DB]]]]'.replace('[[DB]]', '[DB](#cite/checkout/DB)'));
    expect(link(`[[${'a'.repeat(300)}]]`)).toBe(`[[${'a'.repeat(300)}]]`);
  });

  it('leaves existing Markdown links and an empty or huge text alone', () => {
    expect(link('[texto](https://x.test) e [[ ]] e [[]]')).toBe('[texto](https://x.test) e [[ ]] e [[]]');
    expect(link('')).toBe('');
    const huge = `${'[[DB]] '.repeat(30_000)}`;
    expect(link(huge)).toBe(huge);
  });

  it('runs in linear time on hostile input', () => {
    const inputs = [
      '`'.repeat(20_000),
      Array.from({ length: 150 }, (_, i) => '`'.repeat(i + 1)).join(' ') + ' [[DB]]',
      '[['.repeat(40_000),
      ']]'.repeat(40_000),
      '```\n'.repeat(20_000),
      `${'~~~ '.repeat(10_000)}[[DB]]`,
      '[[a'.repeat(30_000),
    ];
    const started = performance.now();
    for (const input of inputs) link(input);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

it('resolves unique labels and accents to actual IDs without guessing ambiguous names',()=>{
 const source=model({version:1,nodes:[{id:'gateway-1',label:'Gateway de API'},{id:'a',label:'Nó'},{id:'b',label:'Nó'}]});
 const resolve=workspaceResolver([{slug:'arquitetura',title:'Arquitetura',model:source}],null);
 expect(resolve('Arquitetura#gateway de api')).toMatchObject({diagram:'arquitetura',id:'gateway-1'});
 expect(resolve('arquitetura#No')).toBeNull();
 expect(resolve('diagrama:arquitetura')).toMatchObject({diagram:'arquitetura',id:'',label:'Arquitetura'});
 expect(linkCitations('[[diagram:arquitetura]]',resolve)).toContain('(#diagram/arquitetura)');
});
