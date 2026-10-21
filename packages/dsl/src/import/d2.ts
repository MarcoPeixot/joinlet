import type { Connector, Direction, Shape } from '@strukt/core';
import { ModelBuilder, cleanText, tooBigResult } from './common';
import type { EdgeItem, ImportResult } from './common';

const MAX_DEPTH = 50;
const MAX_TOKENS = 300_000;
const MAX_LINE = 20_000;
const MAX_CHAIN = 50;

const SHAPES: Record<string, Shape> = {
  rectangle: 'rectangle', square: 'rectangle', package: 'package', step: 'process', callout: 'note', text: 'rectangle',
  cylinder: 'cylinder', stored_data: 'cylinder', queue: 'queue', oval: 'oval', circle: 'circle', diamond: 'diamond',
  document: 'document', page: 'note', hexagon: 'hexagon', parallelogram: 'parallelogram', cloud: 'cloud',
  person: 'actor', ellipse: 'ellipse', star: 'star', trapezoid: 'trapezoid', triangle: 'triangle',
};
/** Shapes that carry their own body syntax: the node is kept, its fields are not imported. */
const BODY_SHAPES = new Set(['sql_table', 'class', 'image', 'code', 'sequence_diagram']);
const KEYWORDS = new Set([
  'shape', 'label', 'icon', 'style', 'classes', 'class', 'near', 'link', 'tooltip', 'direction', 'width', 'height', 'top', 'left',
  'grid-rows', 'grid-columns', 'grid-gap', 'vertical-gap', 'horizontal-gap', 'constraint', 'vars', 'layers', 'scenarios', 'steps',
  'source-arrowhead', 'target-arrowhead', 'font-size',
]);
const DIRECTIONS: Record<string, Direction> = { right: 'right', down: 'down', left: 'left', up: 'up' };
const CONNECTORS: [string, Connector][] = [['<->', '<>'], ['->', '>'], ['<-', '<'], ['--', '-']];

type Tok = { t: 'stmt'; text: string; line: number } | { t: 'open'; text: string; line: number } | { t: 'close'; line: number };
type Scope =
  | { kind: 'node'; id: string; body: boolean }
  | { kind: 'edge'; edges: EdgeItem[] }
  | { kind: 'ignore' };

/** Splits the text into statements and braces, dropping comments, `|block|` strings and respecting quotes. */
function tokenize(text: string, b: ModelBuilder): Tok[] {
  const tokens: Tok[] = [];
  let cur = '';
  let inked = false; // `cur` holds a non-whitespace character (tracked, never re-derived with `cur.trim()` per character)
  const cap = MAX_LINE * 2;
  let line = 1;
  let startLine = 1;
  let truncated = false;
  /** Appends to the current statement; anything past the cap is dropped so `cur` (and every scan of it) stays bounded. */
  const append = (piece: string) => {
    inked = true;
    if (cur.length < cap) cur += cur.length + piece.length > cap ? piece.slice(0, cap - cur.length) : piece;
  };
  const flush = () => {
    const stmt = cur.trim();
    cur = '';
    inked = false;
    if (stmt) tokens.push({ t: 'stmt', text: stmt.length > MAX_LINE ? stmt.slice(0, MAX_LINE) : stmt, line: startLine });
    startLine = line;
  };
  const n = text.length;
  for (let i = 0; i < n; i += 1) {
    if (tokens.length > MAX_TOKENS) { truncated = true; break; }
    const c = text[i]!;
    if (c === '\n') { flush(); line += 1; startLine = line; continue; }
    if (c === '\r') continue;
    if (!inked) startLine = line;
    if (c === '#') { const end = text.indexOf('\n', i); i = end < 0 ? n : end - 1; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      append(text.slice(i, Math.min(j + 1, n, i + cap)).replace(/\n$/, ''));
      i = text[j] === '\n' ? j - 1 : j;
      continue;
    }
    if (c === '|') {
      const end = text.indexOf('|', i + 1);
      const stop = end < 0 ? n : end + 1;
      for (let k = i; k < stop; k += 1) if (text[k] === '\n') line += 1;
      append('""');
      i = stop - 1;
      b.warnOnce('block-string', line, 'Bloco de texto (|...|) ignorado.');
      continue;
    }
    if (c === '$' && text[i + 1] === '{') { const end = text.indexOf('}', i); const stop = end < 0 ? n : end + 1; append(text.slice(i, Math.min(stop, i + cap)).replace(/\n/g, ' ')); i = stop - 1; continue; }
    if (c === ';') { flush(); continue; }
    if (c === '{') { const head = cur.trim(); cur = ''; inked = false; tokens.push({ t: 'open', text: head.length > MAX_LINE ? head.slice(0, MAX_LINE) : head, line: startLine }); startLine = line; continue; }
    if (c === '}') { flush(); tokens.push({ t: 'close', line }); continue; }
    if (c === ' ' || c === '\t') { if (inked) append(c); else if (cur.length < cap) cur += c; continue; }
    append(c);
  }
  flush();
  if (truncated) b.warn(line, 'Entrada muito longa: o restante do arquivo D2 foi ignorado.');
  return tokens;
}

/** Splits at a top-level (unquoted) separator; returns the pieces without the quotes' contents being split. */
function splitTop(text: string, sep: string): string[] {
  const parts: string[] = [];
  let quote = '';
  let last = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quote) { if (c === '\\') i += 1; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (text.startsWith(sep, i)) { parts.push(text.slice(last, i)); last = i + sep.length; i += sep.length - 1; }
  }
  parts.push(text.slice(last));
  return parts;
}

function unquote(text: string): string {
  const t = text.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t.at(-1) === t[0]) return t.slice(1, -1).replace(/\\(.)/g, '$1');
  return t;
}

function splitPath(text: string): string[] {
  return splitTop(text, '.').map(unquote).filter(Boolean);
}

/** Finds `->`, `<-`, `<->`, `--` outside quotes: returns the operands and the connectors between them. */
function splitEdge(head: string): { parts: string[]; connectors: Connector[] } | null {
  const parts: string[] = [];
  const connectors: Connector[] = [];
  let quote = '';
  let last = 0;
  for (let i = 0; i < head.length; i += 1) {
    const c = head[i]!;
    if (quote) { if (c === '\\') i += 1; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    const hit = CONNECTORS.find(([token]) => head.startsWith(token, i));
    if (!hit) continue;
    parts.push(head.slice(last, i));
    connectors.push(hit[1]);
    i += hit[0].length - 1;
    last = i + 1;
    if (parts.length > MAX_CHAIN) return { parts, connectors };
  }
  if (!connectors.length) return null;
  parts.push(head.slice(last));
  return { parts, connectors };
}

export function importD2(text: string): ImportResult {
  const big = tooBigResult(text);
  if (big) return big;
  const b = new ModelBuilder();
  try {
    run(text, b);
  } catch {
    b.warn(1, 'Não foi possível ler o arquivo D2 por completo.');
  }
  return b.build();
}

function run(text: string, b: ModelBuilder): void {
  const tokens = tokenize(text, b);
  const stack: Scope[] = [];
  const top = (): Scope | undefined => stack.at(-1);
  const base = (): string => {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const scope = stack[i]!;
      if (scope.kind === 'node') return scope.id;
      if (scope.kind === 'ignore') return '';
    }
    return '';
  };

  /** Resolves a dotted path relative to the current container, creating each ancestor as a group. */
  const ensure = (path: string[], line: number): string | null => {
    let prefix = base();
    let segs = path;
    while (segs[0] === '_') { prefix = prefix.includes('.') ? prefix.slice(0, prefix.lastIndexOf('.')) : ''; segs = segs.slice(1); }
    if (!segs.length) return prefix || null;
    let parent = prefix;
    for (const [index, seg] of segs.entries()) {
      const id = parent ? `${parent}.${seg}` : seg;
      const canonical = b.has(id) ? cleanText(id) : b.add(id, { label: seg, ...(parent ? { parentId: parent } : {}) }, line);
      if (canonical === null) return null;
      if (index < segs.length - 1) b.setGroup(canonical);
      parent = canonical;
    }
    if (prefix) b.setGroup(prefix);
    return parent;
  };

  const ignoring = (kind: string, line: number, what = kind) => b.warnOnce(`ignored:${kind}`, line, `Construção D2 "${what}" ignorada.`);

  const setShape = (id: string, value: string, line: number): boolean => {
    const key = unquote(value).toLowerCase();
    if (BODY_SHAPES.has(key)) { ignoring(`shape:${key}`, line, `shape: ${key}`); return true; }
    const shape = Object.hasOwn(SHAPES, key) ? SHAPES[key] : undefined;
    if (shape) { if (!b.isGroup(id)) b.update(id, { shape }); } else ignoring(`shape:${key}`, line, `shape: ${cleanText(key, 40)}`);
    return false;
  };

  /** Applies `prop: value` to the node `id` (or the diagram when `id` is empty). Returns true when the node is a body shape. */
  const applyProp = (id: string, prop: string, value: string, line: number): boolean => {
    if (prop === 'shape' && id) return setShape(id, value, line);
    if (prop === 'label' && id && value) { b.update(id, { label: unquote(value) }); return false; }
    if (prop === 'direction' && !id) { const dir = Object.hasOwn(DIRECTIONS, unquote(value)) ? DIRECTIONS[unquote(value)] : undefined; if (dir) b.direction = dir; return false; }
    ignoring(prop, line);
    return false;
  };

  const declare = (head: string, line: number, block: boolean): Scope | null => {
    const pieces = splitTop(head, ':');
    const keyPart = pieces[0]!.trim();
    const value = pieces.slice(1).join(':').trim();
    if (keyPart.startsWith('...') || keyPart.startsWith('@') || value.startsWith('@')) { ignoring('import', line, 'import (@arquivo)'); return block ? { kind: 'ignore' } : null; }

    const edge = splitEdge(keyPart);
    if (edge) {
      if (edge.parts.length > MAX_CHAIN || edge.parts.some((part) => !part.trim())) {
        b.warnOnce('bad-edge', line, 'Conexão D2 não reconhecida foi ignorada.');
        return block ? { kind: 'ignore' } : null;
      }
      const ids = edge.parts.map((part) => {
        const path = splitPath(part);
        if (path.includes('__proto__')) { b.warnOnce('reserved', line, 'O nome "__proto__" é reservado e foi ignorado.'); return null; }
        return path.length ? ensure(path, line) : null;
      });
      const made: EdgeItem[] = [];
      for (const [index, connector] of edge.connectors.entries()) {
        const from = ids[index];
        const to = ids[index + 1];
        if (from && to) {
          const item = b.connect(from, to, connector, value ? unquote(value) : undefined, line);
          if (item) made.push(item);
        }
      }
      return block ? { kind: 'edge', edges: made } : null;
    }

    const path = splitPath(keyPart);
    if (!path.length) { b.warnOnce('unknown', line, 'Construção D2 não reconhecida foi ignorada.'); return block ? { kind: 'ignore' } : null; }
    if (path.includes('__proto__')) { b.warnOnce('reserved', line, 'O nome "__proto__" é reservado e foi ignorado.'); return block ? { kind: 'ignore' } : null; }

    const kw = path.findIndex((seg) => KEYWORDS.has(seg));
    if (kw >= 0) {
      const prop = path[kw]!;
      const target = kw === 0 ? (base() || '') : ensure(path.slice(0, kw), line);
      if (kw === path.length - 1 && !block) { applyProp(target ?? '', prop, value, line); return null; }
      if (kw === path.length - 1 && block && (prop === 'label' || prop === 'shape' || prop === 'direction')) { applyProp(target ?? '', prop, value, line); return { kind: 'ignore' }; }
      ignoring(prop, line);
      return block ? { kind: 'ignore' } : null;
    }

    const id = ensure(path, line);
    if (!id) return block ? { kind: 'ignore' } : null;
    if (value && !value.startsWith('{')) b.update(id, { label: unquote(value) });
    return block ? { kind: 'node', id, body: false } : null;
  };

  for (const token of tokens) {
    const scope = top();
    if (token.t === 'close') { stack.pop(); continue; }
    if (token.t === 'open') {
      if (stack.length >= MAX_DEPTH) {
        b.warnOnce('depth', token.line, `Aninhamento além de ${MAX_DEPTH} níveis de profundidade ignorado.`);
        stack.push({ kind: 'ignore' });
        continue;
      }
      if (scope?.kind === 'ignore' || (scope?.kind === 'node' && scope.body)) { stack.push({ kind: 'ignore' }); continue; }
      if (scope?.kind === 'edge') { const key = token.text.split(':')[0]!.trim(); if (key !== 'label') ignoring(key || 'bloco', token.line); stack.push({ kind: 'ignore' }); continue; }
      stack.push(token.text ? declare(token.text, token.line, true) ?? { kind: 'ignore' } : { kind: 'ignore' });
      continue;
    }
    if (scope?.kind === 'ignore') continue;
    if (scope?.kind === 'edge') {
      const [key, ...rest] = splitTop(token.text, ':');
      if (key!.trim() === 'label') { const label = unquote(rest.join(':')); for (const e of scope.edges) if (label) e.label = cleanText(label); }
      else ignoring(key!.trim().split('.')[0] || 'propriedade', token.line);
      continue;
    }
    if (scope?.kind === 'node' && scope.body) continue;
    // `shape: sql_table` turns the enclosing node into a body shape: its fields are not elements.
    if (scope?.kind === 'node') {
      const [key, ...rest] = splitTop(token.text, ':');
      if (key!.trim() === 'shape') {
        if (applyProp(scope.id, 'shape', rest.join(':').trim(), token.line)) scope.body = true;
        continue;
      }
    }
    declare(token.text, token.line, false);
  }
}
