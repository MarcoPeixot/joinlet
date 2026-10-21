/**
 * Minimal, safe Markdown -> HTML for the static site (pure TS, no DOM, no dependencies).
 *
 * Safety comes from construction, not from filtering: ALL text is escaped, no raw HTML passes through, and the only
 * tags ever emitted are h2-h6, p, ul, ol, li, pre, code, strong, em, blockquote, hr, br and `a` (href = validated
 * http(s) URL or a trusted relative doc path). No images, no other schemes. Every scan is linear: input, line and
 * nesting sizes are capped, and a marker that fails to find its closer is never retried.
 */

export interface MarkdownLiteOptions {
  /** Relative href of the page for `doc:<slug>`, or `null` when that doc does not exist (link degrades to text). */
  resolveDoc(slug: string): string | null;
}

const MAX_INPUT = 512_000;
const MAX_LINE = 20_000;
const MAX_DEPTH = 3;
const MAX_LINK_ATTEMPTS = 200;
const MAX_URL = 2000;

// Everything except \n: C0 (tabs become spaces), DEL/C1, bidi and zero-width controls, line/paragraph separators, non-characters.
// eslint-disable-next-line no-control-regex
const STRIPPED = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f؜​-‏‪-‮⁠-⁩﻿￹-￿]/g;
const LONE_SURROGATES = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
// eslint-disable-next-line no-control-regex
const BAD_URL_CHAR = /[\s\u0000-\u001f\u007f-\u009f<>"'`\\]/;
const HTTP_URL = /^https?:\/\/./i;
const DOC_SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** The one HTML escaper (text and attribute values). */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function normalize(text: string): { text: string; truncated: boolean } {
  const truncated = text.length > MAX_INPUT;
  const clean = (truncated ? text.slice(0, MAX_INPUT) : text)
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(STRIPPED, '')
    .replace(LONE_SURROGATES, '');
  return { text: clean, truncated };
}

interface Scan {
  noLink: boolean;
  noClose: Record<string, boolean>;
  attempts: number;
  noBacktick: boolean;
}

/** Validated link target: http(s) URL as-is, or `doc:<slug>` resolved through `opts` (else `null`: not clickable). */
export function safeHref(url: string, opts: MarkdownLiteOptions): { href: string; external: boolean } | null {
  if (url.length > MAX_URL) return null;
  if (HTTP_URL.test(url) && !BAD_URL_CHAR.test(url)) return { href: url, external: true };
  if (url.startsWith('doc:')) {
    const slug = url.slice(4);
    if (!DOC_SLUG.test(slug)) return null;
    const href = opts.resolveDoc(slug);
    return href === null ? null : { href, external: false };
  }
  return null;
}

/** Single-line plain text for titles/labels: control characters removed, whitespace collapsed, clipped to `max` characters. */
export function plainText(text: string, max = 200): string {
  const head = text.length > max * 4 ? text.slice(0, max * 4) : text;
  const clean = head.replace(/\s+/g, ' ').replace(STRIPPED, '').replace(LONE_SURROGATES, '').trim();
  const chars = Array.from(clean);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}

const SPECIAL = /[`[*]/g;

function inline(s: string, depth: number, opts: MarkdownLiteOptions): string {
  const scan: Scan = { noLink: false, noClose: {}, attempts: 0, noBacktick: false };
  const out: string[] = [];
  let i = 0;
  let text = 0; // start of the pending plain run
  const flush = (end: number) => {
    if (end > text) out.push(escapeHtml(s.slice(text, end)));
  };
  SPECIAL.lastIndex = 0;
  while (i < s.length) {
    SPECIAL.lastIndex = i;
    const found = SPECIAL.exec(s);
    if (!found) break;
    const at = found.index;
    const c = s[at]!;
    i = at + 1;
    if (c === '`') {
      const end = scan.noBacktick ? -1 : s.indexOf('`', at + 1);
      if (end < 0) scan.noBacktick = true;
      else if (end > at + 1) {
        flush(at);
        out.push(`<code>${escapeHtml(s.slice(at + 1, end))}</code>`);
        i = text = end + 1;
      }
      continue;
    }
    if (c === '[') {
      if (scan.noLink || scan.attempts >= MAX_LINK_ATTEMPTS) continue;
      scan.attempts++;
      const mid = s.indexOf('](', at + 1);
      const close = mid < 0 ? -1 : s.indexOf(')', mid + 2);
      if (close < 0) {
        scan.noLink = true;
        continue;
      }
      if (s.lastIndexOf('[', mid - 1) !== at) continue;
      const label = s.slice(at + 1, mid);
      const target = safeHref(s.slice(mid + 2, close), opts);
      flush(at);
      if (target) {
        const extra = target.external ? ' target="_blank"' : '';
        out.push(`<a href="${escapeHtml(target.href)}" rel="noopener noreferrer"${extra}>${escapeHtml(label)}</a>`);
      } else out.push(escapeHtml(label));
      i = text = close + 1;
      continue;
    }
    // '*' or '**'
    const marker = s.startsWith('**', at) ? '**' : '*';
    if (marker === '**') i = at + 2;
    if (depth >= MAX_DEPTH || scan.noClose[marker]) continue;
    const end = s.indexOf(marker, at + marker.length);
    if (end < 0) {
      scan.noClose[marker] = true;
      continue;
    }
    const inner = s.slice(at + marker.length, end);
    if (!inner.trim() || inner[0] === ' ' || inner[inner.length - 1] === ' ') continue;
    flush(at);
    const tag = marker === '**' ? 'strong' : 'em';
    out.push(`<${tag}>${inline(inner, depth + 1, opts)}</${tag}>`);
    i = text = end + marker.length;
  }
  flush(s.length);
  return out.join('');
}

const FENCE = /^ {0,3}```/;
const HEADING = /^(#{1,6}) +(.*)$/;
const HR = /^ {0,3}(?:-{3,}|\*{3,}|_{3,}) *$/;
const BULLET = /^ {0,3}[-*+] +(.*)$/;
const ORDERED = /^ {0,3}\d{1,9}[.)] +(.*)$/;
const QUOTE = /^ {0,3}> ?(.*)$/;

const startsBlock = (line: string) => FENCE.test(line) || HEADING.test(line) || HR.test(line) || BULLET.test(line) || ORDERED.test(line) || QUOTE.test(line);

/** `Title ##` -> `Title` (closing hashes need a space before them); linear, unlike `/ +#+ *$/` on a long run of spaces. */
function stripClosingHashes(text: string): string {
  const trimmed = text.trim();
  let end = trimmed.length;
  while (end > 0 && trimmed[end - 1] === '#') end -= 1;
  return end < trimmed.length && end > 0 && trimmed[end - 1] === ' ' ? trimmed.slice(0, end).trimEnd() : trimmed;
}

export function renderMarkdownLite(markdown: string, opts: MarkdownLiteOptions): string {
  const { text, truncated } = normalize(markdown);
  const lines = text.split('\n');
  const out: string[] = [];
  let cutLine = false;
  const cap = (line: string): string => {
    if (line.length <= MAX_LINE) return line;
    cutLine = true;
    return line.slice(0, MAX_LINE);
  };
  let i = 0;
  while (i < lines.length) {
    const line = cap(lines[i]!);
    if (!line.trim()) {
      i++;
    } else if (FENCE.test(line)) {
      const body: string[] = [];
      for (i++; i < lines.length && !FENCE.test(lines[i]!); i++) body.push(cap(lines[i]!));
      i++; // closing fence (or EOF for an unbalanced one)
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
    } else if (HEADING.test(line)) {
      const [, hashes, rest] = HEADING.exec(line)!;
      const level = Math.min(hashes!.length + 1, 6);
      out.push(`<h${level}>${inline(stripClosingHashes(rest!), 0, opts)}</h${level}>`);
      i++;
    } else if (HR.test(line)) {
      out.push('<hr>');
      i++;
    } else if (QUOTE.test(line)) {
      const body: string[] = [];
      for (; i < lines.length && QUOTE.test(cap(lines[i]!)); i++) body.push(QUOTE.exec(cap(lines[i]!))![1]!);
      out.push(`<blockquote><p>${inline(body.join('\n'), 0, opts)}</p></blockquote>`);
    } else if (BULLET.test(line) || ORDERED.test(line)) {
      const re = BULLET.test(line) ? BULLET : ORDERED;
      const tag = re === BULLET ? 'ul' : 'ol';
      const items: string[] = [];
      for (; i < lines.length; i++) {
        const m = re.exec(cap(lines[i]!));
        if (!m) break;
        items.push(`<li>${inline(m[1]!, 0, opts)}</li>`);
      }
      out.push(`<${tag}>${items.join('')}</${tag}>`);
    } else {
      const body: string[] = [];
      for (; i < lines.length && lines[i]!.trim() && (body.length === 0 || !startsBlock(cap(lines[i]!))); i++) body.push(cap(lines[i]!));
      out.push(`<p>${inline(body.join('\n'), 0, opts)}</p>`);
    }
  }
  if (truncated || cutLine) out.push('<p><em>… conteúdo truncado (documento grande demais para o site).</em></p>');
  return out.join('');
}
