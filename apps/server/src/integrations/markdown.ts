/**
 * The Markdown subset the publishers understand (títulos, parágrafos, listas com aninhamento e tarefas, código,
 * tabelas, citações, régua; inline: negrito, itálico, tachado, código, links http(s)). Both Notion and Confluence
 * render from this one tree. Everything else (HTML cru, imagens, notas de rodapé, definições de link) degrades to
 * plain text, never to markup. The parser is line-based and linear: hostile input cannot make it quadratic.
 */

export interface Span {
  text: string;
  bold?: true;
  italic?: true;
  strike?: true;
  code?: true;
  href?: string;
}

export interface ListItem {
  text: string;
  checked?: boolean;
  children: Block[];
}
export type ListBlock = { type: 'list'; ordered: boolean; items: ListItem[] };
export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: 'paragraph'; text: string }
  | ListBlock
  | { type: 'code'; lang: string; code: string }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'quote'; text: string }
  | { type: 'rule' };

// ---------------------------------------------------------------- inline

type Style = { bold?: true; italic?: true; strike?: true; href?: string };

const MAX_DEPTH = 8;
const MAX_URL = 2_000;
const MAX_TITLE = 500;
const PUNCT = /[!-/:-@[-`{-~]/;
const isSpace = (ch: string | undefined) => ch === undefined || ch === ' ' || ch === '\t' || ch === '\n';
const isWord = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** Only http(s) URLs become links (Notion and Confluence both refuse the rest, and `javascript:` must never survive). */
export function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (!url || url.length > MAX_URL || /[\s\u0000-\u001f<>"\\]/.test(url) || !/^https?:\/\//i.test(url)) return null;
  try {
    return new URL(url).protocol === 'https:' || new URL(url).protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

const sameStyle = (a: Span, b: Span) => a.bold === b.bold && a.italic === b.italic && a.strike === b.strike && a.code === b.code && a.href === b.href;

function emit(out: Span[], text: string, style: Style, code?: true): void {
  if (!text) return;
  out.push({ text, ...(style.bold ? { bold: true as const } : {}), ...(style.italic ? { italic: true as const } : {}), ...(style.strike ? { strike: true as const } : {}), ...(code ? { code } : {}), ...(style.href ? { href: style.href } : {}) });
}

/** The closing run for `ch` repeated `len`: a run of at least `len`, preceded by non-space (and, for `_`, not followed by a word). */
function findCloser(text: string, from: number, ch: string, len: number): { at: number; end: number } | null {
  let j = text.indexOf(ch, from);
  while (j !== -1) {
    let end = j;
    while (text[end] === ch) end++;
    const run = end - j;
    if (run >= len) {
      const at = end - len;
      if (!isSpace(text[at - 1]) && (ch !== '_' || !isWord(text[end])) && at >= from) return { at, end };
    }
    j = text.indexOf(ch, end);
  }
  return null;
}

function findBacktickClose(text: string, from: number, n: number): number {
  let j = text.indexOf('`', from);
  while (j !== -1) {
    let end = j;
    while (text[end] === '`') end++;
    if (end - j === n) return j;
    j = text.indexOf('`', end);
  }
  return -1;
}

/** Index of the `]` that closes each `[` (a single stack pass, honouring backslash escapes). */
function bracketMatches(text: string): Map<number, number> {
  const matches = new Map<number, number>();
  const stack: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') i++;
    else if (ch === '[') stack.push(i);
    else if (ch === ']' && stack.length) matches.set(stack.pop()!, i);
  }
  return matches;
}

/** `(url "title")` starting at `open`: the URL and the index after `)`, or null. Bounded, so unclosed `(` stays cheap. */
function parseDestination(text: string, open: number): { url: string; end: number } | null {
  let i = open + 1;
  while (text[i] === ' ' && i < open + 20) i++;
  const start = i;
  let depth = 0;
  const limit = Math.min(text.length, i + MAX_URL);
  while (i < limit) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < limit) i += 2;
    else if (ch === '(') { depth++; i++; }
    else if (ch === ')') {
      if (depth === 0) break;
      depth--;
      i++;
    } else if (ch === ' ' || ch === '\n' || ch === '\t') break;
    else i++;
  }
  if (i >= limit) return null;
  const url = text.slice(start, i).replace(/^<|>$/g, '').replace(/\\([!-/:-@[-`{-~])/g, '$1');
  while (text[i] === ' ') i++;
  if (text[i] === '"' || text[i] === "'") {
    const quote = text[i]!;
    const close = text.indexOf(quote, i + 1);
    if (close === -1 || close - i > MAX_TITLE) return null;
    i = close + 1;
    while (text[i] === ' ') i++;
  }
  return text[i] === ')' ? { url, end: i + 1 } : null;
}

function walk(text: string, style: Style, depth: number, out: Span[]): void {
  const brackets = bracketMatches(text);
  const failedFrom = new Map<string, number>();
  const failedTicks = new Set<number>();
  let buf = '';
  const flush = () => {
    emit(out, buf, style);
    buf = '';
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\\' && i + 1 < text.length && PUNCT.test(text[i + 1]!)) {
      buf += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      let n = 0;
      while (text[i + n] === '`') n++;
      const close = failedTicks.has(n) ? -1 : findBacktickClose(text, i + n, n);
      if (close === -1) {
        failedTicks.add(n);
        buf += '`'.repeat(n);
        i += n;
        continue;
      }
      let inner = text.slice(i + n, close).replace(/\n/g, ' ');
      if (inner.length > 1 && inner.startsWith(' ') && inner.endsWith(' ') && inner.trim()) inner = inner.slice(1, -1);
      flush();
      emit(out, inner, style, true);
      i = close + n;
      continue;
    }
    if (ch === '!' && text[i + 1] === '[' && !style.href) {
      const close = brackets.get(i + 1);
      const dest = close !== undefined && text[close + 1] === '(' ? parseDestination(text, close + 1) : null;
      if (close !== undefined && dest) {
        flush();
        if (depth < MAX_DEPTH) walk(text.slice(i + 2, close), style, depth + 1, out);
        else emit(out, text.slice(i + 2, close), style);
        i = dest.end;
        continue;
      }
    }
    if (ch === '[' && !style.href && depth < MAX_DEPTH) {
      const close = brackets.get(i);
      const dest = close !== undefined && text[close + 1] === '(' ? parseDestination(text, close + 1) : null;
      if (close !== undefined && dest) {
        flush();
        const href = safeHref(dest.url);
        walk(text.slice(i + 1, close), href ? { ...style, href } : style, depth + 1, out);
        i = dest.end;
        continue;
      }
    }
    if (ch === '<') {
      const match = /^<(https?:\/\/[^\s<>]{1,2000})>/.exec(text.slice(i, i + 2_010));
      const href = match ? safeHref(match[1]!) : null;
      if (match && href) {
        flush();
        emit(out, match[1]!, { ...style, href });
        i += match[0].length;
        continue;
      }
    }
    if (ch === '*' || ch === '_' || ch === '~') {
      let run = 0;
      while (text[i + run] === ch) run++;
      const maxLen = ch === '~' ? (run >= 2 ? 2 : 0) : Math.min(run, 3);
      let used = false;
      for (let len = maxLen; len >= (ch === '~' ? 2 : 1) && !used && depth < MAX_DEPTH; len--) {
        const opensOk = !isSpace(text[i + run]) && (ch !== '_' || !isWord(text[i - 1]));
        const key = `${ch}${len}`;
        if (!opensOk || (failedFrom.get(key) ?? Infinity) <= i) continue;
        const closer = findCloser(text, i + run, ch, len);
        if (!closer) {
          failedFrom.set(key, i);
          continue;
        }
        // `***a***` is bold + italic; the opener may be longer than the delimiter it uses (`**a`): the rest stays text.
        const opener = i + run - len;
        buf += text.slice(i, opener);
        flush();
        const inner: Style = { ...style, ...(ch === '~' ? { strike: true as const } : len === 3 ? { bold: true as const, italic: true as const } : len === 2 ? { bold: true as const } : { italic: true as const }) };
        walk(text.slice(opener + len, closer.at), inner, depth + 1, out);
        i = closer.end;
        used = true;
      }
      if (!used) {
        buf += ch.repeat(run);
        i += run;
      }
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
}

/** Inline Markdown → styled spans (adjacent spans with the same style are merged). */
export function parseInline(text: string): Span[] {
  const out: Span[] = [];
  walk(text, {}, 0, out);
  const merged: Span[] = [];
  for (const span of out) {
    const last = merged[merged.length - 1];
    if (last && sameStyle(last, span)) last.text += span.text;
    else merged.push({ ...span });
  }
  return merged;
}

// ---------------------------------------------------------------- blocks

const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;

function expandLead(line: string): string {
  let n = 0;
  while (line[n] === ' ' || line[n] === '\t') n++;
  if (!line.slice(0, n).includes('\t')) return line;
  return line.slice(0, n).replace(/\t/g, '    ') + line.slice(n);
}

const isBlank = (line: string) => line.trim() === '';

function atx(line: string): { level: 1 | 2 | 3 | 4 | 5 | 6; text: string } | null {
  const match = /^ {0,3}(#{1,6})(?:[ \t]|$)/.exec(line);
  if (!match) return null;
  let body = line.slice(match[0].length).trim();
  let end = body.length;
  while (end > 0 && body[end - 1] === '#') end--;
  if (end < body.length && (end === 0 || body[end - 1] === ' ' || body[end - 1] === '\t')) body = body.slice(0, end).trimEnd();
  return { level: match[1]!.length as 1 | 2 | 3 | 4 | 5 | 6, text: body };
}

interface Marker {
  indent: number;
  ordered: boolean;
  start: number;
  text: string;
}

function listMarker(line: string): Marker | null {
  let indent = 0;
  while (line[indent] === ' ') indent++;
  const ch = line[indent];
  let at = indent;
  let ordered = false;
  let start = 0;
  if (ch === '-' || ch === '*' || ch === '+') at++;
  else if (ch !== undefined && ch >= '0' && ch <= '9') {
    while (at < indent + 10 && line[at] !== undefined && line[at]! >= '0' && line[at]! <= '9') at++;
    if (at - indent > 9 || (line[at] !== '.' && line[at] !== ')')) return null;
    start = Number(line.slice(indent, at));
    at++;
    ordered = true;
  } else return null;
  if (line[at] !== undefined && line[at] !== ' ' && line[at] !== '\t') return null;
  return { indent, ordered, start, text: line.slice(at).trim() };
}

function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '\\' && text[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (ch === '|') {
      cells.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

const isDelimiterRow = (cells: string[]) => cells.every((cell) => /^:?-+:?$/.test(cell));

function tableAt(lines: string[], i: number): { header: string[]; width: number } | null {
  const head = lines[i]!;
  const next = lines[i + 1];
  if (next === undefined || !head.includes('|') || !next.includes('|') || !/^[\s|:-]+$/.test(next)) return null;
  const header = splitRow(head);
  const delimiter = splitRow(next);
  return delimiter.length === header.length && isDelimiterRow(delimiter) ? { header, width: header.length } : null;
}

const hardBreak = (line: string) => / {2,}$/.test(line) || line.endsWith('\\');
const joinLines = (lines: string[]) => {
  let text = '';
  lines.forEach((line, index) => {
    const body = line.trim();
    if (index > 0) text += hardBreak(lines[index - 1]!) ? '\n' : ' ';
    text += body.endsWith('\\') && hardBreak(line) ? body.slice(0, -1) : body;
  });
  return text;
};

/** Block-level Markdown → a flat tree (lists carry their nested lists as children). */
export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  const startsBlock = (line: string, index: number): boolean => {
    const text = expandLead(line);
    if (FENCE.test(text) || atx(text) || RULE.test(text) || /^ {0,3}>/.test(text)) return true;
    const marker = listMarker(text);
    if (marker && (!marker.ordered || marker.start === 1) && marker.indent < 4) return true;
    return tableAt(lines, index) !== null;
  };

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i]!;
    if (isBlank(raw)) {
      i++;
      continue;
    }
    const line = expandLead(raw);

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const indent = line.length - line.trimStart().length;
      const body: string[] = [];
      i++;
      const close = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`);
      while (i < lines.length && !close.test(expandLead(lines[i]!))) {
        const content = lines[i]!;
        let strip = 0;
        while (strip < indent && content[strip] === ' ') strip++;
        body.push(content.slice(strip));
        i++;
      }
      i++;
      blocks.push({ type: 'code', lang: fence[2] ?? '', code: body.join('\n') });
      continue;
    }

    const heading = atx(line);
    if (heading) {
      if (heading.text) blocks.push({ type: 'heading', ...heading });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }

    const table = tableAt(lines, i);
    if (table) {
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && !isBlank(lines[i]!) && lines[i]!.includes('|') && !startsBlock(lines[i]!, i)) {
        const cells = splitRow(lines[i]!);
        rows.push(Array.from({ length: table.width }, (_, column) => cells[column] ?? ''));
        i++;
      }
      blocks.push({ type: 'table', header: table.header, rows });
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^ {0,3}>/.test(expandLead(lines[i]!))) {
        quoted.push(expandLead(lines[i]!).replace(/^ {0,3}> ?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', text: joinLines(quoted.filter((l) => l.trim() !== '')) });
      continue;
    }

    const first = listMarker(line);
    if (first && first.indent < 4) {
      const flat: (Marker & { checked?: boolean })[] = [];
      while (i < lines.length) {
        const current = expandLead(lines[i]!);
        if (isBlank(current)) {
          let k = i + 1;
          while (k < lines.length && isBlank(lines[k]!)) k++;
          const after = k < lines.length ? listMarker(expandLead(lines[k]!)) : null;
          if (!after) break;
          i = k;
          continue;
        }
        const marker = listMarker(current);
        if (marker && !RULE.test(current)) {
          const task = /^\[([ xX])\][ \t]+(.*)$|^\[([ xX])\]$/.exec(marker.text);
          flat.push(task ? { ...marker, text: (task[2] ?? '').trim(), checked: (task[1] ?? task[3]) !== ' ' } : marker);
          i++;
          continue;
        }
        if (startsBlock(lines[i]!, i)) break;
        const last = flat[flat.length - 1]!;
        last.text = `${last.text}${hardBreak(lines[i - 1] ?? '') ? '\n' : ' '}${current.trim()}`;
        i++;
      }
      blocks.push(...buildLists(flat));
      continue;
    }

    const paragraph: string[] = [line];
    i++;
    let setext: 1 | 2 | null = null;
    while (i < lines.length && !isBlank(lines[i]!)) {
      const next = expandLead(lines[i]!);
      const under = SETEXT.exec(next);
      if (under) {
        setext = under[1]![0] === '=' ? 1 : 2;
        i++;
        break;
      }
      if (startsBlock(lines[i]!, i)) break;
      paragraph.push(next);
      i++;
    }
    const text = joinLines(paragraph);
    blocks.push(setext ? { type: 'heading', level: setext, text } : { type: 'paragraph', text });
  }
  return blocks;
}

function buildLists(flat: (Marker & { checked?: boolean })[]): Block[] {
  const root: Block[] = [];
  interface Level {
    indent: number;
    list: ListBlock;
    container: Block[];
  }
  const stack: Level[] = [];
  for (const marker of flat) {
    while (stack.length && marker.indent < stack[stack.length - 1]!.indent) stack.pop();
    let top = stack[stack.length - 1];
    if (top && marker.indent >= top.indent + 2) {
      const parent = top.list.items[top.list.items.length - 1]!;
      const list: ListBlock = { type: 'list', ordered: marker.ordered, items: [] };
      parent.children.push(list);
      top = { indent: marker.indent, list, container: parent.children };
      stack.push(top);
    } else if (!top || top.list.ordered !== marker.ordered) {
      const container = top ? top.container : root;
      const list: ListBlock = { type: 'list', ordered: marker.ordered, items: [] };
      container.push(list);
      top = { indent: top ? top.indent : marker.indent, list, container };
      if (stack.length) stack[stack.length - 1] = top;
      else stack.push(top);
    }
    top.list.items.push({ text: marker.text, ...(marker.checked === undefined ? {} : { checked: marker.checked }), children: [] });
  }
  return root;
}
