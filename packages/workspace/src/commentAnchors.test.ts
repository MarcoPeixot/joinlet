import { describe, expect, it } from 'vitest';
import { resolveTextAnchor, textAnchor } from './commentAnchors';

const DOC = '# Pagamentos\n\nO serviço de pagamentos fala com o banco por uma fila.\n\nO serviço de cobrança fala com o banco por HTTP.\n';
const quote = (doc: string, passage: string, nth = 0) => {
  let from = -1;
  for (let i = 0; i <= nth; i++) from = doc.indexOf(passage, from + 1);
  return { from, to: from + passage.length };
};
const at = (doc: string, found: { from: number; to: number } | null) => (found ? doc.slice(found.from, found.to) : null);

describe('textAnchor', () => {
  it('keeps the passage, a little context around it and where it started', () => {
    const { from, to } = quote(DOC, 'fala com o banco por uma fila');
    const anchor = textAnchor(DOC, from, to);
    expect(anchor).toMatchObject({ type: 'text', quote: 'fala com o banco por uma fila', from });
    expect(anchor.prefix.endsWith('pagamentos ')).toBe(true);
    expect(anchor.suffix.startsWith('.\n\nO serviço')).toBe(true);
  });

  it('cuts a very long passage and its context to the limits', () => {
    const long = `${'palavra '.repeat(200)}fim`;
    const anchor = textAnchor(`antes ${long} depois`, 6, 6 + long.length);
    expect(anchor.quote.length).toBeLessThanOrEqual(500);
    expect(anchor.prefix.length).toBeLessThanOrEqual(40);
    expect(anchor.suffix.length).toBeLessThanOrEqual(40);
  });

  it('normalizes a backwards or out-of-range selection', () => {
    const anchor = textAnchor('abcdef', 4, 1);
    expect(anchor.quote).toBe('bcd');
    expect(textAnchor('abc', 0, 99).quote).toBe('abc');
  });
});

describe('resolveTextAnchor', () => {
  const anchorFor = (doc: string, passage: string, nth = 0) => textAnchor(doc, quote(doc, passage, nth).from, quote(doc, passage, nth).to);

  it('finds the passage where it was', () => {
    const anchor = anchorFor(DOC, 'fila');
    const found = resolveTextAnchor(DOC, anchor);
    expect(at(DOC, found)).toBe('fila');
    expect(found?.exact).toBe(true);
  });

  it('follows the passage when text is added or removed before it', () => {
    const anchor = anchorFor(DOC, 'cobrança');
    const edited = `Uma introdução nova, bem maior que a anterior.\n\n${DOC}`;
    expect(at(edited, resolveTextAnchor(edited, anchor))).toBe('cobrança');
    const shorter = DOC.replace('# Pagamentos\n\n', '');
    expect(at(shorter, resolveTextAnchor(shorter, anchor))).toBe('cobrança');
  });

  it('tells repeated passages apart by their context, even after the doc moved', () => {
    const second = anchorFor(DOC, 'fala com o banco', 1);
    const edited = `Intro.\n\n${DOC}\nMais um parágrafo no fim.`;
    const found = resolveTextAnchor(edited, second)!;
    expect(found.from).toBe(edited.indexOf('fala com o banco', edited.indexOf('cobrança')));
    expect(at(edited, found)).toBe('fala com o banco');
  });

  it('survives whitespace being re-flowed inside the passage', () => {
    const anchor = anchorFor(DOC, 'fala com o banco por uma fila');
    const reflowed = DOC.replace('fala com o banco por uma fila', 'fala com o banco\npor uma   fila');
    const found = resolveTextAnchor(reflowed, anchor);
    expect(found).not.toBeNull();
    expect(at(reflowed, found)).toContain('por uma   fila');
    expect(found?.exact).toBe(false);
  });

  it('survives a small edit inside the passage', () => {
    const anchor = anchorFor(DOC, 'O serviço de pagamentos fala com o banco por uma fila');
    const edited = DOC.replace('por uma fila', 'por uma fila SQS');
    const found = resolveTextAnchor(edited, anchor);
    expect(found).not.toBeNull();
    expect(at(edited, found)).toContain('O serviço de pagamentos fala com o banco por uma fila');
    const typo = DOC.replace('pagamentos fala', 'pagamento fala');
    expect(at(typo, resolveTextAnchor(typo, anchor))).toContain('serviço de pagamento fala com o banco');
  });

  it('gives up (null) when the passage is gone', () => {
    const anchor = anchorFor(DOC, 'O serviço de cobrança fala com o banco por HTTP.');
    expect(resolveTextAnchor('# Outro assunto\n\nNada a ver.\n', anchor)).toBeNull();
    expect(resolveTextAnchor('', anchor)).toBeNull();
  });

  it('never matches past the text', () => {
    const anchor = anchorFor(DOC, 'fila');
    const found = resolveTextAnchor('fila', anchor)!;
    expect(found.from).toBeGreaterThanOrEqual(0);
    expect(found.to).toBeLessThanOrEqual(4);
  });

  it('stays fast on a big doc full of the same passage', () => {
    const big = 'aaaa bbbb '.repeat(100_000);
    const anchor = textAnchor(big, 500, 509);
    const started = Date.now();
    expect(resolveTextAnchor(big, anchor)).not.toBeNull();
    const none = textAnchor(big, 500, 509);
    expect(resolveTextAnchor('x'.repeat(1_000_000), { ...none, quote: 'aaaa bbbb aaaa' })).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
