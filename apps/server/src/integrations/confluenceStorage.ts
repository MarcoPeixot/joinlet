import { parseBlocks, parseInline } from './markdown';
import type { Block, ListBlock, Span } from './markdown';

/** Markdown → Confluence storage format (XHTML + `ac:` macros), built only from the subset in `markdown.ts`. */

/** XML 1.0 forbids most control characters (and lone surrogates); the author's text must never break the page. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function escapeXml(text: string): string {
  return text
    .replace(FORBIDDEN, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const LANGUAGES = new Map<string, string>([
  ...['actionscript3', 'bash', 'csharp', 'coldfusion', 'cpp', 'css', 'delphi', 'diff', 'erlang', 'groovy', 'html', 'java', 'javafx', 'javascript', 'perl', 'php', 'powershell', 'python', 'ruby', 'scala', 'sql', 'vb', 'xml', 'yaml'].map((name): [string, string] => [name, name]),
  ['js', 'javascript'], ['jsx', 'javascript'], ['ts', 'javascript'], ['tsx', 'javascript'], ['typescript', 'javascript'], ['json', 'javascript'],
  ['sh', 'bash'], ['shell', 'bash'], ['zsh', 'bash'], ['yml', 'yaml'], ['py', 'python'], ['rb', 'ruby'], ['cs', 'csharp'], ['c++', 'cpp'], ['c', 'cpp'],
  ['ps1', 'powershell'], ['svg', 'xml'],
]);

/** A fence's language word → one the Confluence code macro lists, or null (macro without a language). */
export function confluenceLanguage(raw: string): string | null {
  return LANGUAGES.get(raw.toLowerCase()) ?? null;
}

export interface Attachment {
  filename: string;
  alt: string;
}

export function attachmentImage({ filename, alt }: Attachment): string {
  return `<ac:image ac:alt="${escapeXml(alt)}"><ri:attachment ri:filename="${escapeXml(filename)}" /></ac:image>`;
}

const cdata = (text: string) => `<![CDATA[${text.replace(FORBIDDEN, '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

function inline(text: string): string {
  return parseInline(text).map(span).join('').replace(/\n/g, '<br />');
}

function span(part: Span): string {
  let html = escapeXml(part.text);
  if (part.code) html = `<code>${html}</code>`;
  if (part.strike) html = `<span style="text-decoration: line-through;">${html}</span>`;
  if (part.italic) html = `<em>${html}</em>`;
  if (part.bold) html = `<strong>${html}</strong>`;
  if (part.href) html = `<a href="${escapeXml(part.href)}">${html}</a>`;
  return html;
}

function list(node: ListBlock, ctx: Ctx): string {
  if (node.items.length && node.items.every((item) => item.checked !== undefined)) {
    const tasks = node.items.map((item) => `<ac:task><ac:task-id>${++ctx.tasks}</ac:task-id><ac:task-status>${item.checked ? 'complete' : 'incomplete'}</ac:task-status><ac:task-body>${inline(item.text)}</ac:task-body></ac:task>`);
    return `<ac:task-list>${tasks.join('')}</ac:task-list>`;
  }
  const tag = node.ordered ? 'ol' : 'ul';
  const items = node.items.map((item) => {
    const prefix = item.checked === undefined ? '' : item.checked ? '☑ ' : '☐ ';
    return `<li>${escapeXml(prefix)}${inline(item.text)}${item.children.map((child) => render(child, ctx)).join('')}</li>`;
  });
  return `<${tag}>${items.join('')}</${tag}>`;
}

interface Ctx {
  /** Confluence wants a page-unique id on every task. */
  tasks: number;
}

function render(node: Block, ctx: Ctx): string {
  switch (node.type) {
    case 'heading':
      return `<h${node.level}>${inline(node.text)}</h${node.level}>`;
    case 'paragraph':
      return `<p>${inline(node.text)}</p>`;
    case 'quote':
      return `<blockquote><p>${inline(node.text)}</p></blockquote>`;
    case 'rule':
      return '<hr />';
    case 'list':
      return list(node, ctx);
    case 'code': {
      const language = confluenceLanguage(node.lang);
      return `<ac:structured-macro ac:name="code">${language ? `<ac:parameter ac:name="language">${language}</ac:parameter>` : ''}<ac:plain-text-body>${cdata(node.code)}</ac:plain-text-body></ac:structured-macro>`;
    }
    case 'table': {
      const head = `<tr>${node.header.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr>`;
      const rows = node.rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`);
      return `<table><tbody>${head}${rows.join('')}</tbody></table>`;
    }
  }
}

export function toStorage(markdown: string, options: { attachment?: Attachment } = {}): string {
  const ctx: Ctx = { tasks: 0 };
  const body = parseBlocks(markdown).map((node) => render(node, ctx)).join('');
  return options.attachment ? `<p>${attachmentImage(options.attachment)}</p>${body}` : body;
}
