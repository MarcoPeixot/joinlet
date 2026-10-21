import { parseBlocks, parseInline } from './markdown';
import type { Block, ListBlock } from './markdown';

/** Markdown → the block objects of the Notion API (`POST /v1/pages` children), within Notion's documented limits. */

export interface RichText {
  type: 'text';
  text: { content: string; link?: { url: string } };
  annotations?: { bold?: true; italic?: true; strikethrough?: true; code?: true };
}
export interface NotionBlock {
  object: 'block';
  type: string;
  [key: string]: unknown;
}

const MAX_CONTENT = 2_000;
const MAX_RICH_TEXT = 100;
const MAX_CHILDREN = 100;
const MAX_TABLE_WIDTH = 50;
const MAX_REQUEST_BLOCKS = 400;

const LANGUAGES = new Set(
  ['abap', 'abc', 'agda', 'arduino', 'ascii art', 'assembly', 'bash', 'basic', 'bnf', 'c', 'c#', 'c++', 'clojure', 'coffeescript', 'coq', 'css', 'dart', 'dhall', 'diff', 'docker', 'ebnf', 'elixir', 'elm', 'erlang', 'f#', 'flow', 'fortran', 'gherkin', 'glsl', 'go', 'graphql', 'groovy', 'haskell', 'hcl', 'html', 'idris', 'java', 'javascript', 'json', 'julia', 'kotlin', 'latex', 'less', 'lisp', 'livescript', 'llvm ir', 'lua', 'makefile', 'markdown', 'markup', 'matlab', 'mathematica', 'mermaid', 'nix', 'notion formula', 'objective-c', 'ocaml', 'pascal', 'perl', 'php', 'plain text', 'powershell', 'prolog', 'protobuf', 'purescript', 'python', 'r', 'racket', 'reason', 'ruby', 'rust', 'sass', 'scala', 'scheme', 'scss', 'shell', 'smalltext', 'solidity', 'sql', 'swift', 'toml', 'typescript', 'vb.net', 'verilog', 'vhdl', 'visual basic', 'webassembly', 'xml', 'yaml'],
);
const ALIASES = new Map<string, string>([
  ['js', 'javascript'], ['jsx', 'javascript'], ['mjs', 'javascript'], ['cjs', 'javascript'], ['ts', 'typescript'], ['tsx', 'typescript'],
  ['sh', 'shell'], ['zsh', 'shell'], ['console', 'shell'], ['yml', 'yaml'], ['py', 'python'], ['rb', 'ruby'], ['md', 'markdown'],
  ['cs', 'c#'], ['csharp', 'c#'], ['cpp', 'c++'], ['tf', 'hcl'], ['terraform', 'hcl'], ['dockerfile', 'docker'], ['golang', 'go'],
  ['rs', 'rust'], ['kt', 'kotlin'], ['objc', 'objective-c'], ['text', 'plain text'], ['txt', 'plain text'], ['plaintext', 'plain text'], ['svg', 'xml'],
]);

/** A fence's language word → a language Notion accepts; anything else is plain text (never throws on odd input). */
export function notionLanguage(raw: string): string {
  const key = raw.toLowerCase();
  const mapped = ALIASES.get(key) ?? key;
  return LANGUAGES.has(mapped) ? mapped : 'plain text';
}

/** Cuts at `limit` UTF-16 units without splitting a surrogate pair. */
function pieces(content: string, limit = MAX_CONTENT): string[] {
  const out: string[] = [];
  let at = 0;
  while (at < content.length) {
    let end = Math.min(content.length, at + limit);
    if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1]!)) end--;
    out.push(content.slice(at, end));
    at = end;
  }
  return out;
}

export function notionRichText(markdown: string): RichText[] {
  const parts: RichText[] = [];
  for (const span of parseInline(markdown)) {
    const annotations = {
      ...(span.bold ? { bold: true as const } : {}),
      ...(span.italic ? { italic: true as const } : {}),
      ...(span.strike ? { strikethrough: true as const } : {}),
      ...(span.code ? { code: true as const } : {}),
    };
    for (const content of pieces(span.text)) {
      parts.push({ type: 'text', text: { content, ...(span.href ? { link: { url: span.href } } : {}) }, ...(Object.keys(annotations).length ? { annotations } : {}) });
    }
  }
  if (parts.length <= MAX_RICH_TEXT) return parts;
  // Notion takes 100 elements per rich_text array: the overflow keeps its words, not its formatting.
  const keep = parts.slice(0, MAX_RICH_TEXT - 1);
  const rest = parts.slice(MAX_RICH_TEXT - 1).map((part) => part.text.content).join('');
  return [...keep, ...pieces(rest).map((content): RichText => ({ type: 'text', text: { content } }))].slice(0, MAX_RICH_TEXT);
}

const block = (type: string, body: Record<string, unknown>): NotionBlock => ({ object: 'block', type, [type]: body });

export function imageBlock(fileUploadId: string): NotionBlock {
  return block('image', { type: 'file_upload', file_upload: { id: fileUploadId } });
}

interface Ctx {
  warnings: Set<string>;
}

const cap = <T>(items: T[], ctx: Ctx, what: string): T[] => {
  if (items.length <= MAX_CHILDREN) return items;
  ctx.warnings.add(`${what} truncada em ${MAX_CHILDREN} itens (limite do Notion).`);
  return items.slice(0, MAX_CHILDREN);
};

function listBlocks(list: ListBlock, depth: number, ctx: Ctx): NotionBlock[] {
  const out: NotionBlock[] = [];
  for (const item of list.items) {
    const type = item.checked !== undefined ? 'to_do' : list.ordered ? 'numbered_list_item' : 'bulleted_list_item';
    const body: Record<string, unknown> = { rich_text: notionRichText(item.text), ...(item.checked !== undefined ? { checked: item.checked } : {}) };
    const nested = item.children.filter((child): child is ListBlock => child.type === 'list');
    if (depth === 0 && nested.length) {
      body.children = cap(nested.flatMap((child) => listBlocks(child, 1, ctx)), ctx, 'Lista');
      out.push(block(type, body));
    } else {
      out.push(block(type, body));
      if (nested.length) {
        // One request nests two levels: deeper items stay in the list, flattened under their level-1 parent.
        ctx.warnings.add('Listas aninhadas além de 2 níveis foram achatadas.');
        out.push(...nested.flatMap((child) => listBlocks(child, 1, ctx)));
      }
    }
  }
  return out;
}

function convert(node: Block, ctx: Ctx): NotionBlock[] {
  switch (node.type) {
    case 'heading': {
      const type = `heading_${Math.min(node.level, 3)}`;
      return [block(type, { rich_text: notionRichText(node.text) })];
    }
    case 'paragraph':
      return node.text.trim() ? [block('paragraph', { rich_text: notionRichText(node.text) })] : [];
    case 'quote':
      return [block('quote', { rich_text: notionRichText(node.text) })];
    case 'rule':
      return [block('divider', {})];
    case 'code': {
      const rich = pieces(node.code).map((content): RichText => ({ type: 'text', text: { content } }));
      if (rich.length > MAX_RICH_TEXT) ctx.warnings.add('Bloco de código truncado (limite do Notion).');
      return [block('code', { rich_text: rich.slice(0, MAX_RICH_TEXT), language: notionLanguage(node.lang) })];
    }
    case 'list':
      return listBlocks(node, 0, ctx);
    case 'table': {
      const width = Math.min(node.header.length, MAX_TABLE_WIDTH);
      if (node.header.length > MAX_TABLE_WIDTH) ctx.warnings.add(`Tabela cortada em ${MAX_TABLE_WIDTH} colunas.`);
      const row = (cells: string[]) => block('table_row', { cells: Array.from({ length: width }, (_, column) => notionRichText(cells[column] ?? '')) });
      const rows = [row(node.header), ...node.rows.map(row)];
      if (rows.length > MAX_CHILDREN) ctx.warnings.add(`Tabela truncada em ${MAX_CHILDREN - 1} linhas (limite do Notion).`);
      return [block('table', { table_width: width, has_column_header: true, has_row_header: false, children: rows.slice(0, MAX_CHILDREN) })];
    }
  }
}

export function notionBlocks(markdown: string): { blocks: NotionBlock[]; warnings: string[] } {
  const ctx: Ctx = { warnings: new Set() };
  const blocks = parseBlocks(markdown).flatMap((node) => convert(node, ctx));
  return { blocks, warnings: [...ctx.warnings] };
}

const count = (node: NotionBlock): number => {
  const body = node[node.type] as { children?: NotionBlock[] } | undefined;
  return 1 + (body?.children?.reduce((sum, child) => sum + count(child), 0) ?? 0);
};

/** Groups top-level blocks into requests: at most 100 each, and at most 400 blocks counting the nested ones. */
export function chunkBlocks(blocks: NotionBlock[]): NotionBlock[][] {
  const chunks: NotionBlock[][] = [];
  let current: NotionBlock[] = [];
  let total = 0;
  for (const item of blocks) {
    const size = count(item);
    if (current.length && (current.length >= MAX_CHILDREN || total + size > MAX_REQUEST_BLOCKS)) {
      chunks.push(current);
      current = [];
      total = 0;
    }
    current.push(item);
    total += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
