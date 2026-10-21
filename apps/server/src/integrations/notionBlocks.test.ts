import { describe, expect, it } from 'vitest';
import { chunkBlocks, imageBlock, notionBlocks, notionRichText } from './notionBlocks';
import type { NotionBlock } from './notionBlocks';

const text = (content: string, extra: Record<string, unknown> = {}) => ({ type: 'text', text: { content }, ...extra });
const types = (blocks: NotionBlock[]) => blocks.map((b) => b.type);

describe('notionRichText', () => {
  it('maps styles to annotations and links to link objects', () => {
    expect(notionRichText('a **b** `c` ~~d~~ [e](https://x.com)')).toEqual([
      text('a '),
      text('b', { annotations: { bold: true } }),
      text(' '),
      text('c', { annotations: { code: true } }),
      text(' '),
      text('d', { annotations: { strikethrough: true } }),
      text(' '),
      { type: 'text', text: { content: 'e', link: { url: 'https://x.com' } } },
    ]);
  });

  it('splits content over 2000 characters without cutting a surrogate pair', () => {
    const long = `${'a'.repeat(1_999)}😀${'b'.repeat(10)}`;
    const parts = notionRichText(long);
    expect(parts.every((p) => p.text.content.length <= 2_000)).toBe(true);
    expect(parts.map((p) => p.text.content).join('')).toBe(long);
    expect(parts.every((p) => !/[\uD800-\uDBFF]$/.test(p.text.content) && !/^[\uDC00-\uDFFF]/.test(p.text.content))).toBe(true);
  });

  it('keeps at most 100 elements, folding the overflow into plain text', () => {
    const many = Array.from({ length: 150 }, (_, i) => `**b${i}** x`).join(' ');
    const parts = notionRichText(many);
    expect(parts.length).toBeLessThanOrEqual(100);
    const joined = parts.map((p) => p.text.content).join('');
    expect(joined).toContain('b149');
  });

  it('returns nothing for empty text', () => {
    expect(notionRichText('')).toEqual([]);
  });
});

describe('notionBlocks', () => {
  it('converts headings (levels 4-6 become heading_3) and paragraphs', () => {
    const { blocks } = notionBlocks('# A\n\n## B\n\n### C\n\n#### D\n\n###### E\n\ntexto');
    expect(types(blocks)).toEqual(['heading_1', 'heading_2', 'heading_3', 'heading_3', 'heading_3', 'paragraph']);
    expect(blocks[0]).toEqual({ object: 'block', type: 'heading_1', heading_1: { rich_text: [text('A')] } });
    expect(blocks[5]).toEqual({ object: 'block', type: 'paragraph', paragraph: { rich_text: [text('texto')] } });
  });

  it('converts lists, numbered lists and tasks, with nested children', () => {
    const { blocks } = notionBlocks('- a\n  - a1\n1. um\n- [x] feito\n- [ ] fazer');
    expect(types(blocks)).toEqual(['bulleted_list_item', 'numbered_list_item', 'to_do', 'to_do']);
    expect(blocks[0]).toMatchObject({ bulleted_list_item: { rich_text: [text('a')], children: [{ type: 'bulleted_list_item', bulleted_list_item: { rich_text: [text('a1')] } }] } });
    expect(blocks[2]).toMatchObject({ to_do: { checked: true, rich_text: [text('feito')] } });
    expect(blocks[3]).toMatchObject({ to_do: { checked: false } });
  });

  it('flattens nesting beyond what one request accepts, and says so', () => {
    const { blocks, warnings } = notionBlocks('- a\n  - b\n    - c\n      - d');
    const level2 = (blocks[0] as unknown as { bulleted_list_item: { children: NotionBlock[] } }).bulleted_list_item.children;
    expect(level2.every((child) => !('children' in (child as Record<string, Record<string, unknown>>).bulleted_list_item!))).toBe(true);
    expect(level2.length).toBe(3);
    expect(warnings.join(' ')).toMatch(/aninhad/i);
  });

  it('converts code with a known language, mapping aliases and defaulting to plain text', () => {
    const lang = (md: string) => (notionBlocks(md).blocks[0] as unknown as { code: { language: string } }).code.language;
    expect(lang('```ts\nx\n```')).toBe('typescript');
    expect(lang('```js\nx\n```')).toBe('javascript');
    expect(lang('```yml\nx\n```')).toBe('yaml');
    expect(lang('```sh\nx\n```')).toBe('shell');
    expect(lang('```mermaid\nx\n```')).toBe('mermaid');
    expect(lang('```TypeScript\nx\n```')).toBe('typescript');
    expect(lang('```klingon\nx\n```')).toBe('plain text');
    expect(lang('```\nx\n```')).toBe('plain text');
    expect(lang('```__proto__\nx\n```')).toBe('plain text');
    expect(notionBlocks('```\na\n\n  b\n```').blocks[0]).toEqual({ object: 'block', type: 'code', code: { rich_text: [text('a\n\n  b')], language: 'plain text' } });
  });

  it('splits a long code block into several rich_text pieces', () => {
    const { blocks } = notionBlocks(`\`\`\`\n${'x'.repeat(5_000)}\n\`\`\``);
    const parts = (blocks[0] as unknown as { code: { rich_text: { text: { content: string } }[] } }).code.rich_text;
    expect(parts.map((p) => p.text.content.length)).toEqual([2_000, 2_000, 1_000]);
  });

  it('converts a table with a header row and normalised width', () => {
    const { blocks } = notionBlocks('| A | B |\n|---|---|\n| 1 | **2** |\n| 3 |');
    expect(blocks).toHaveLength(1);
    const table = blocks[0] as unknown as { type: string; table: { table_width: number; has_column_header: boolean; has_row_header: boolean; children: { type: string; table_row: { cells: unknown[][] } }[] } };
    expect(table.type).toBe('table');
    expect(table.table).toMatchObject({ table_width: 2, has_column_header: true, has_row_header: false });
    expect(table.table.children).toHaveLength(3);
    expect(table.table.children[0]).toEqual({ object: 'block', type: 'table_row', table_row: { cells: [[text('A')], [text('B')]] } });
    expect(table.table.children[1]!.table_row.cells[1]).toEqual([text('2', { annotations: { bold: true } })]);
    expect(table.table.children[2]!.table_row.cells[1]).toEqual([]);
  });

  it('caps a table at 99 rows and reports it', () => {
    const rows = Array.from({ length: 150 }, (_, i) => `| ${i} |`).join('\n');
    const { blocks, warnings } = notionBlocks(`| N |\n|---|\n${rows}`);
    expect((blocks[0] as unknown as { table: { children: unknown[] } }).table.children).toHaveLength(100);
    expect(warnings.join(' ')).toMatch(/tabela/i);
  });

  it('converts quotes and rules', () => {
    const { blocks } = notionBlocks('> citado\n\n---\n');
    expect(types(blocks)).toEqual(['quote', 'divider']);
    expect(blocks[1]).toEqual({ object: 'block', type: 'divider', divider: {} });
  });

  it('never emits a link with a scheme Notion would reject', () => {
    const { blocks } = notionBlocks('[a](javascript:alert(1)) [b](https://ok.com)');
    const parts = (blocks[0] as unknown as { paragraph: { rich_text: { text: { link?: { url: string } } }[] } }).paragraph.rich_text;
    expect(parts.flatMap((p) => (p.text.link ? [p.text.link.url] : []))).toEqual(['https://ok.com']);
  });

  it('turns an empty document into no blocks', () => {
    expect(notionBlocks('').blocks).toEqual([]);
  });

  it('converts a realistic architecture doc', () => {
    const md = '# Pagamentos\n\nO serviço **API** fala com o `DB`.\n\n## Decisões\n\n1. Usar Postgres\n2. Fila SQS\n\n```sql\nselect 1;\n```\n\n| Serviço | Dono |\n|---|---|\n| API | Time A |\n';
    expect(types(notionBlocks(md).blocks)).toEqual(['heading_1', 'paragraph', 'heading_2', 'numbered_list_item', 'numbered_list_item', 'code', 'table']);
  });
});

describe('imageBlock', () => {
  it('references an uploaded file', () => {
    expect(imageBlock('abc-123')).toEqual({ object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: 'abc-123' } } });
  });
});

describe('chunkBlocks', () => {
  const para = (n: number): NotionBlock => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [text(String(n))] } });

  it('keeps every chunk within 100 top-level blocks and preserves the order', () => {
    const blocks = Array.from({ length: 250 }, (_, i) => para(i));
    const chunks = chunkBlocks(blocks);
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(chunks.flat()).toEqual(blocks);
  });

  it('also bounds the total number of blocks including nested ones', () => {
    const { blocks } = notionBlocks(Array.from({ length: 60 }, (_, i) => `- item ${i}\n  - a\n  - b\n  - c\n  - d\n  - e\n  - f`).join('\n'));
    const chunks = chunkBlocks(blocks);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toHaveLength(60);
  });

  it('returns no chunks for no blocks', () => {
    expect(chunkBlocks([])).toEqual([]);
  });
});
