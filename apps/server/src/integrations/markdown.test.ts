import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline } from './markdown';

describe('parseInline', () => {
  it('reads plain text as one span', () => {
    expect(parseInline('olá mundo')).toEqual([{ text: 'olá mundo' }]);
    expect(parseInline('')).toEqual([]);
  });

  it('reads bold, italic, strike and code, with the nesting they allow', () => {
    expect(parseInline('a **b** c')).toEqual([{ text: 'a ' }, { text: 'b', bold: true }, { text: ' c' }]);
    expect(parseInline('a *b* _c_ __d__')).toEqual([{ text: 'a ' }, { text: 'b', italic: true }, { text: ' ' }, { text: 'c', italic: true }, { text: ' ' }, { text: 'd', bold: true }]);
    expect(parseInline('~~x~~')).toEqual([{ text: 'x', strike: true }]);
    expect(parseInline('**a *b* c**')).toEqual([{ text: 'a ', bold: true }, { text: 'b', bold: true, italic: true }, { text: ' c', bold: true }]);
    expect(parseInline('`a *b*` e')).toEqual([{ text: 'a *b*', code: true }, { text: ' e' }]);
    expect(parseInline('``a ` b``')).toEqual([{ text: 'a ` b', code: true }]);
  });

  it('keeps intra-word underscores and lone markers as text', () => {
    expect(parseInline('snake_case_name')).toEqual([{ text: 'snake_case_name' }]);
    expect(parseInline('2 * 3 * 4')).toEqual([{ text: '2 * 3 * 4' }]);
    expect(parseInline('**sem fecho')).toEqual([{ text: '**sem fecho' }]);
    expect(parseInline('`sem fecho')).toEqual([{ text: '`sem fecho' }]);
  });

  it('honours backslash escapes', () => {
    expect(parseInline('\\*não\\* \\[x\\]')).toEqual([{ text: '*não* [x]' }]);
    expect(parseInline('a\\\\b')).toEqual([{ text: 'a\\b' }]);
  });

  it('reads links and autolinks, with formatting inside the label', () => {
    expect(parseInline('[site](https://exemplo.com/a?b=1)')).toEqual([{ text: 'site', href: 'https://exemplo.com/a?b=1' }]);
    expect(parseInline('[**site**](https://x.com "título")')).toEqual([{ text: 'site', bold: true, href: 'https://x.com' }]);
    expect(parseInline('<https://x.com/y>')).toEqual([{ text: 'https://x.com/y', href: 'https://x.com/y' }]);
    expect(parseInline('[a](https://x.com/(par))')).toEqual([{ text: 'a', href: 'https://x.com/(par)' }]);
  });

  it('only links http(s): other schemes keep the label as text', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'doc:arquitetura', '//evil.com', 'ftp://x.com', ' JaVaScRiPt:alert(1)']) {
      expect(parseInline(`[clique](${url})`), url).toEqual([{ text: 'clique' }]);
    }
    expect(parseInline('<javascript:alert(1)>')).toEqual([{ text: '<javascript:alert(1)>' }]);
  });

  it('turns an image into its alt text', () => {
    expect(parseInline('veja ![diagrama](https://x.com/a.png) aqui')).toEqual([{ text: 'veja diagrama aqui' }]);
  });

  it('treats raw HTML as text', () => {
    expect(parseInline('<script>x</script>')).toEqual([{ text: '<script>x</script>' }]);
  });

  it('merges neighbours with the same style', () => {
    expect(parseInline('a \\* b')).toEqual([{ text: 'a * b' }]);
  });

  it('stays fast on hostile input (no quadratic scans)', () => {
    const started = performance.now();
    for (const bad of ['*'.repeat(50_000), '['.repeat(50_000), '`'.repeat(50_000), '**a'.repeat(20_000), '[a](b'.repeat(10_000), '_a '.repeat(20_000), '~~'.repeat(25_000), `${'*a '.repeat(15_000)}*`, '<'.repeat(50_000), `${'['.repeat(10_000)}x${']'.repeat(10_000)}`]) parseInline(bad);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('does not recurse without bound', () => {
    expect(() => parseInline(`${'**_'.repeat(5_000)}x${'_**'.repeat(5_000)}`)).not.toThrow();
    expect(() => parseInline(`${'[a]('.repeat(5_000)}x`)).not.toThrow();
  });
});

describe('parseBlocks', () => {
  it('reads headings (ATX and setext), paragraphs and rules', () => {
    const blocks = parseBlocks('# Título\n\nUm parágrafo\nem duas linhas.\n\n## Sub ##\n\nTexto\n===\n\nOutro\n---\n\n***\n');
    expect(blocks).toEqual([
      { type: 'heading', level: 1, text: 'Título' },
      { type: 'paragraph', text: 'Um parágrafo em duas linhas.' },
      { type: 'heading', level: 2, text: 'Sub' },
      { type: 'heading', level: 1, text: 'Texto' },
      { type: 'heading', level: 2, text: 'Outro' },
      { type: 'rule' },
    ]);
  });

  it('turns a trailing two-space or backslash break into a newline', () => {
    expect(parseBlocks('a  \nb\\\nc')).toEqual([{ type: 'paragraph', text: 'a\nb\nc' }]);
  });

  it('reads fenced code with its language, keeping the content verbatim', () => {
    expect(parseBlocks('```ts\nconst a = 1;\n\n  b();\n```\ndepois')).toEqual([
      { type: 'code', lang: 'ts', code: 'const a = 1;\n\n  b();' },
      { type: 'paragraph', text: 'depois' },
    ]);
    expect(parseBlocks('~~~\n```\n~~~')).toEqual([{ type: 'code', lang: '', code: '```' }]);
    expect(parseBlocks('````md\n```\nx\n```\n````')).toEqual([{ type: 'code', lang: 'md', code: '```\nx\n```' }]);
  });

  it('runs an unterminated fence to the end instead of dropping text', () => {
    expect(parseBlocks('```\nsem fim\nainda')).toEqual([{ type: 'code', lang: '', code: 'sem fim\nainda' }]);
  });

  it('reads lists with nesting, ordered/unordered switches and task items', () => {
    const blocks = parseBlocks('- a\n  - a1\n  - a2\n    - a2x\n- b\n\n1. um\n2. dois\n\n- [ ] fazer\n- [x] feito\n');
    expect(blocks).toEqual([
      {
        type: 'list',
        ordered: false,
        items: [
          { text: 'a', children: [{ type: 'list', ordered: false, items: [{ text: 'a1', children: [] }, { text: 'a2', children: [{ type: 'list', ordered: false, items: [{ text: 'a2x', children: [] }] }] }] }] },
          { text: 'b', children: [] },
        ],
      },
      { type: 'list', ordered: true, items: [{ text: 'um', children: [] }, { text: 'dois', children: [] }] },
      { type: 'list', ordered: false, items: [{ text: 'fazer', checked: false, children: [] }, { text: 'feito', checked: true, children: [] }] },
    ]);
  });

  it('joins a list item continuation line and ends the list at the next block', () => {
    expect(parseBlocks('- a\n  continua\n- b\npara')).toEqual([
      { type: 'list', ordered: false, items: [{ text: 'a continua', children: [] }, { text: 'b para', children: [] }] },
    ]);
    expect(parseBlocks('- a\n\npara')).toEqual([
      { type: 'list', ordered: false, items: [{ text: 'a', children: [] }] },
      { type: 'paragraph', text: 'para' },
    ]);
  });

  it('keeps a list going across a blank line when the next item follows', () => {
    expect(parseBlocks('- a\n\n- b')).toEqual([{ type: 'list', ordered: false, items: [{ text: 'a', children: [] }, { text: 'b', children: [] }] }]);
  });

  it('reads pipe tables, with alignment row, escaped pipes and ragged rows', () => {
    const blocks = parseBlocks('| Nome | Tipo |\n| :--- | ---: |\n| API | `svc` |\n| a \\| b |\n| x | y | z |\n');
    expect(blocks).toEqual([{ type: 'table', header: ['Nome', 'Tipo'], rows: [['API', '`svc`'], ['a | b', ''], ['x', 'y']] }]);
    expect(parseBlocks('Nome | Tipo\n--- | ---\na | b')).toEqual([{ type: 'table', header: ['Nome', 'Tipo'], rows: [['a', 'b']] }]);
  });

  it('does not mistake a line with a pipe for a table without the delimiter row', () => {
    expect(parseBlocks('a | b\nc | d')).toEqual([{ type: 'paragraph', text: 'a | b c | d' }]);
    expect(parseBlocks('| a | b |\n| -- |')).toEqual([{ type: 'paragraph', text: '| a | b | | -- |' }]);
  });

  it('reads block quotes', () => {
    expect(parseBlocks('> uma\n> citação\n\nfim')).toEqual([{ type: 'quote', text: 'uma citação' }, { type: 'paragraph', text: 'fim' }]);
  });

  it('keeps raw HTML and unknown syntax as paragraph text', () => {
    expect(parseBlocks('<div>oi</div>\n\n<!-- nota -->')).toEqual([{ type: 'paragraph', text: '<div>oi</div>' }, { type: 'paragraph', text: '<!-- nota -->' }]);
  });

  it('handles CRLF, tabs and a BOM', () => {
    expect(parseBlocks('﻿# A\r\n\r\n-\tx\r\n')).toEqual([{ type: 'heading', level: 1, text: 'A' }, { type: 'list', ordered: false, items: [{ text: 'x', children: [] }] }]);
  });

  it('returns nothing for blank input', () => {
    expect(parseBlocks('')).toEqual([]);
    expect(parseBlocks('\n  \n')).toEqual([]);
  });

  it('is linear on hostile structure', () => {
    const started = performance.now();
    parseBlocks('- a\n'.repeat(20_000));
    parseBlocks(Array.from({ length: 2_000 }, (_, i) => `${'  '.repeat(i % 40)}- x`).join('\n'));
    parseBlocks('| a |\n'.repeat(20_000));
    parseBlocks('> '.repeat(20_000));
    parseBlocks('```\n'.repeat(20_000));
    parseBlocks('| a | b |\n| - | - |\n'.repeat(5_000));
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
