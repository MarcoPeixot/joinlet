import { compareModels, computeRects, defaultSize, emptyModel, own } from '@strukt/core';
import { anyChange } from './diff';
import type { Side } from './diff';
import type { DiagramElement, DiagramModel, EdgeEl, ID, LayoutState, NodeBox, Rect } from '@strukt/core';

/**
 * Visual before/after of a semantic diff as a static SVG (pure, no DOM, no ELK).
 *
 * The input is UNTRUSTED repo content, so the output is built only from an allowlist of tags and numeric/enum
 * attributes; every piece of user text goes through `esc`, and ids never reach an attribute.
 */

// Same hues as the app's diff overlay (`PALETTE` in apps/web/src/diagram/palette.ts: green, red, orange).
const COLORS = { added: '#30a050', removed: '#bd413a', changed: '#c38424', same: '#8a8a8a' } as const;
const INK = '#242424';
const FONT = 'Geist, system-ui, sans-serif';

const MAX_ELEMENTS = 400;
const MAX_EDGES = 800;
const MAX_CANVAS = 4000;
const MAX_LABEL = 60;
const COORD_LIMIT = 100_000;
const MARGIN = 24;
const HEADER = 60;
const FOOTER = 48;

type State = keyof typeof COLORS;

export interface DiffSvgOptions {
  /** Diagram title shown in the header. */
  title?: string;
  /** Drawn-element cap (default 400). */
  maxElements?: number;
  /** Plain diagram (no diff header, summary or legend); used by `renderDiagramSvg`. */
  plain?: boolean;
}

// Control chars (keeping nothing: tabs/newlines become spaces), C1, bidi controls, line/paragraph separators, non-characters.
// eslint-disable-next-line no-control-regex
const WHITESPACE_CONTROLS = /[\t\n\r\u0085\u2028\u2029]/g;
// eslint-disable-next-line no-control-regex
const STRIPPED = /[\u0000-\u001f\u007f-\u009f؜​-‏‪-‮⁠-⁩﻿￹-￿]/g;
const LONE_SURROGATES = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** The one XML escaper: strips unsafe characters, then escapes `& < > " '`. */
function esc(text: string): string {
  return text
    .replace(WHITESPACE_CONTROLS, ' ')
    .replace(STRIPPED, '')
    .replace(LONE_SURROGATES, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Truncates by code points (before escaping) with an ellipsis. */
function clip(text: string, max: number): string {
  const head = text.length > max * 2 ? text.slice(0, max * 2) : text;
  const chars = Array.from(head.replace(WHITESPACE_CONTROLS, ' ').replace(STRIPPED, '').replace(LONE_SURROGATES, ''));
  return chars.length > max || text.length > head.length ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}

const safe = (n: unknown, fallback = 0): number => (typeof n === 'number' && Number.isFinite(n) ? Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, n)) : fallback);
const num = (n: number): string => String(Math.round(safe(n) * 10) / 10 + 0);

// ---------------------------------------------------------------- layout

interface Pos { x: number; y: number; w?: number; h?: number }

function sanitizeLayout(layout: LayoutState | undefined): Record<ID, Pos> {
  const nodes: Record<ID, Pos> = {};
  if (!layout) return nodes;
  for (const id of Object.keys(layout.nodes)) {
    const box: NodeBox | undefined = own(layout.nodes, id);
    if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y)) continue;
    const pos: Pos = { x: safe(box.x), y: safe(box.y) };
    if (Number.isFinite(box.w) && box.w! > 0) pos.w = Math.min(box.w!, 2000);
    if (Number.isFinite(box.h) && box.h! > 0) pos.h = Math.min(box.h!, 2000);
    Object.defineProperty(nodes, id, { value: pos, enumerable: true, writable: true, configurable: true });
  }
  return nodes;
}

const asLayout = (nodes: Record<ID, Pos>): LayoutState => ({ nodes, edges: {} });

function needsPosition(model: DiagramModel, id: ID, nodes: Record<ID, Pos>): boolean {
  const el = own(model.elements, id);
  if (!el || own(nodes, id)) return false;
  if (el.kind === 'node') return true;
  return !model.order.some((other) => own(model.elements, other)?.parentId === id);
}

/** Simple deterministic layered placement (longest path, chunked columns) for elements the layout does not position. */
function placeMissing(model: DiagramModel, nodes: Record<ID, Pos>, origin?: { x: number; y: number }): void {
  const missing = model.order.filter((id) => needsPosition(model, id, nodes));
  if (!missing.length) return;
  const set = new Set(missing);
  const layer = new Map(missing.map((id) => [id, 0]));
  const links = model.edges.filter((edge) => set.has(edge.from) && set.has(edge.to) && edge.from !== edge.to);
  for (let pass = 0; pass < Math.min(missing.length, 40); pass++) {
    let moved = false;
    for (const edge of links) {
      const next = Math.min(layer.get(edge.from)! + 1, missing.length);
      if (next > layer.get(edge.to)!) {
        layer.set(edge.to, next);
        moved = true;
      }
    }
    if (!moved) break;
  }
  let ox = origin?.x;
  let oy = origin?.y;
  if (ox === undefined || oy === undefined) {
    const placed = Object.values(nodes);
    ox = placed.length ? Math.min(...placed.map((p) => p.x)) : 0;
    oy = placed.length ? Math.max(...placed.map((p) => p.y + (p.h ?? 64))) + 80 : 0;
  }
  const byLayer = new Map<number, ID[]>();
  for (const id of missing) byLayer.set(layer.get(id)!, [...(byLayer.get(layer.get(id)!) ?? []), id]);
  const ROWS = 10;
  let x = ox;
  for (const key of [...byLayer.keys()].sort((a, b) => a - b)) {
    const ids = byLayer.get(key)!;
    for (let start = 0; start < ids.length; start += ROWS) {
      let y = oy;
      let widest = 0;
      for (const id of ids.slice(start, start + ROWS)) {
        const size = sizeOf(own(model.elements, id)!);
        Object.defineProperty(nodes, id, { value: { x, y }, enumerable: true, writable: true, configurable: true });
        y += size.h + 40;
        widest = Math.max(widest, size.w);
      }
      x += widest + 80;
    }
  }
}

function sizeOf(el: DiagramElement): { w: number; h: number } {
  const size = defaultSize(el);
  return { w: safe(size?.w, 160) || 160, h: safe(size?.h, 64) || 64 };
}

function rectsOf(model: DiagramModel, nodes: Record<ID, Pos>): Record<ID, Rect> {
  const raw = computeRects(model, asLayout(nodes));
  const out: Record<ID, Rect> = {};
  for (const id of model.order) {
    const rect = own(raw, id);
    const el = own(model.elements, id);
    if (!rect || !el) continue;
    const size = sizeOf(el);
    const w = safe(rect.w, size.w);
    const h = safe(rect.h, size.h);
    Object.defineProperty(out, id, {
      value: { x: safe(rect.x), y: safe(rect.y), w: w > 0 ? w : size.w, h: h > 0 ? h : size.h },
      enumerable: true, writable: true, configurable: true,
    });
  }
  return out;
}

/** Copy without the `__proto__` id (and edges touching it): it is never a valid key, and would corrupt plain-object maps. */
function withoutProto(model: DiagramModel): DiagramModel {
  if (!model.order.includes('__proto__') && !Object.hasOwn(model.elements, '__proto__') && !model.edges.some((e) => e.from === '__proto__' || e.to === '__proto__')) return model;
  const elements: DiagramModel['elements'] = {};
  for (const id of model.order) {
    const el = own(model.elements, id);
    if (id !== '__proto__' && el) Object.defineProperty(elements, id, { value: el, enumerable: true, writable: true, configurable: true });
  }
  return {
    ...model,
    elements,
    order: model.order.filter((id) => id !== '__proto__'),
    edges: model.edges.filter((e) => e.from !== '__proto__' && e.to !== '__proto__'),
  };
}

// ---------------------------------------------------------------- drawing

interface Shape { key: number; el: DiagramElement; rect: Rect; state: State }

const STATE_TAG: Record<State, string> = { added: 'Adicionado', removed: 'Removido', changed: 'Alterado', same: '' };
const FILL_OPACITY: Record<State, string> = { added: '0.14', removed: '0.10', changed: '0.16', same: '0.05' };

function clipToRect(rect: Rect, toward: { x: number; y: number }): { x: number; y: number } {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const scale = Math.min(dx ? rect.w / 2 / Math.abs(dx) : Infinity, dy ? rect.h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

function arrowHead(tip: { x: number; y: number }, from: { x: number; y: number }, color: string): string {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const size = 9;
  const a = { x: tip.x - size * Math.cos(angle - 0.4), y: tip.y - size * Math.sin(angle - 0.4) };
  const b = { x: tip.x - size * Math.cos(angle + 0.4), y: tip.y - size * Math.sin(angle + 0.4) };
  return `<polygon points="${num(tip.x)},${num(tip.y)} ${num(a.x)},${num(a.y)} ${num(b.x)},${num(b.y)}" fill="${color}"/>`;
}

function drawEdge(edge: EdgeEl, a: Rect, b: Rect, state: State): string {
  const color = COLORS[state];
  const dash = state === 'removed' ? ' stroke-dasharray="6 4"' : '';
  const parts: string[] = [];
  const label = edge.label ? clip(edge.label, 30) : '';
  if (edge.from === edge.to) {
    const x = a.x + a.w;
    const y = a.y + a.h / 2;
    parts.push(`<path d="M ${num(x)} ${num(y - 8)} C ${num(x + 40)} ${num(y - 30)} ${num(x + 40)} ${num(y + 30)} ${num(x)} ${num(y + 8)}" fill="none" stroke="${color}" stroke-width="2"${dash}/>`);
    parts.push(arrowHead({ x, y: y + 8 }, { x: x + 20, y: y + 20 }, color));
    if (label) parts.push(`<text x="${num(x + 44)}" y="${num(y + 4)}" font-size="11" fill="${color}">${esc(label)}</text>`);
    return parts.join('');
  }
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const p1 = clipToRect(a, cb);
  const p2 = clipToRect(b, ca);
  parts.push(`<line x1="${num(p1.x)}" y1="${num(p1.y)}" x2="${num(p2.x)}" y2="${num(p2.y)}" stroke="${color}" stroke-width="2"${dash}/>`);
  if (edge.connector === '>' || edge.connector === '<>' || edge.connector === '-->') parts.push(arrowHead(p2, p1, color));
  if (edge.connector === '<' || edge.connector === '<>') parts.push(arrowHead(p1, p2, color));
  if (label) {
    parts.push(`<text x="${num((p1.x + p2.x) / 2)}" y="${num((p1.y + p2.y) / 2 - 5)}" font-size="11" text-anchor="middle" fill="${color}">${esc(label)}</text>`);
  }
  return parts.join('');
}

function drawShape(shape: Shape): string {
  const { el, rect, state } = shape;
  const color = COLORS[state];
  const dash = state === 'removed' ? ' stroke-dasharray="6 4"' : '';
  const isGroup = el.kind === 'group';
  const text = clip(el.label ?? el.id, Math.max(6, Math.min(MAX_LABEL, Math.floor(rect.w / 7))));
  const out = [
    `<rect x="${num(rect.x)}" y="${num(rect.y)}" width="${num(rect.w)}" height="${num(rect.h)}" rx="${isGroup ? 10 : 6}" fill="${color}" fill-opacity="${isGroup ? '0.04' : FILL_OPACITY[state]}" stroke="${color}" stroke-width="${state === 'same' ? 1 : 2}"${dash}/>`,
    isGroup
      ? `<text x="${num(rect.x + 12)}" y="${num(rect.y + 22)}" font-size="13" font-weight="600" fill="${INK}">${esc(text)}</text>`
      : `<text x="${num(rect.x + rect.w / 2)}" y="${num(rect.y + rect.h / 2 + 4)}" font-size="13" text-anchor="middle" fill="${INK}">${esc(text)}</text>`,
  ];
  if (STATE_TAG[state]) out.push(`<text x="${num(rect.x)}" y="${num(rect.y - 5)}" font-size="10" font-weight="600" fill="${color}">${STATE_TAG[state]}</text>`);
  return out.join('');
}

function frame(width: number, height: number, label: string, body: string): string {
  const scale = Math.min(1, MAX_CANVAS / width, MAX_CANVAS / height);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(width)} ${num(height)}" width="${num(width * scale)}" height="${num(height * scale)}" role="img" aria-label="${esc(label)}" font-family="${FONT}">` +
    `<title>${esc(label)}</title>` +
    `<rect x="0" y="0" width="${num(width)}" height="${num(height)}" fill="#ffffff"/>` +
    body +
    '</svg>'
  );
}

/**
 * Renders the after layout with additions (green), changes (amber) and removed elements (red, dashed, at their BEFORE
 * position), plus connection changes, a legend and a pt-BR title. Missing positions are auto-placed deterministically.
 */
export function renderDiffSvg(
  beforeModel: DiagramModel,
  afterModel: DiagramModel,
  layoutBefore?: LayoutState,
  layoutAfter?: LayoutState,
  opts: DiffSvgOptions = {},
): string {
  const before = withoutProto(beforeModel);
  const after = withoutProto(afterModel);
  const changes = compareModels(before, after);
  const plain = opts.plain === true;
  const heading = plain ? clip(opts.title ?? 'Diagrama', MAX_LABEL) : `Diff visual — ${clip(opts.title ?? 'Diagrama', MAX_LABEL)}`;
  if (!plain && !anyChange(changes)) {
    return frame(520, 110, heading, `<text x="24" y="40" font-size="16" font-weight="600" fill="${INK}">${esc(heading)}</text><text x="24" y="74" font-size="13" fill="${COLORS.same}">Diagrama sem mudanças</text>`);
  }

  const posAfter = sanitizeLayout(layoutAfter);
  placeMissing(after, posAfter);
  const posBefore = sanitizeLayout(layoutBefore);
  for (const id of before.order) {
    const shared = own(posAfter, id);
    if (!own(posBefore, id) && shared && own(after.elements, id)?.kind === own(before.elements, id)?.kind) {
      Object.defineProperty(posBefore, id, { value: { x: shared.x, y: shared.y }, enumerable: true, writable: true, configurable: true });
    }
  }
  const all = [...Object.values(posAfter), ...Object.values(posBefore)];
  placeMissing(before, posBefore, { x: all.length ? Math.min(...all.map((p) => p.x)) : 0, y: all.length ? Math.max(...all.map((p) => p.y + (p.h ?? 64))) + 80 : 0 });

  const rectsAfter = rectsOf(after, posAfter);
  const rectsBefore = rectsOf(before, posBefore);

  const stateOf = (kind: 'elements' | 'edges') => {
    const c = changes[kind];
    return { added: new Set(c.added), removed: new Set(c.removed), changed: new Set(c.changed) };
  };
  const elStates = stateOf('elements');
  const edgeStates = stateOf('edges');

  const candidates: Shape[] = [];
  after.order.forEach((id) => {
    const el = own(after.elements, id);
    const rect = own(rectsAfter, id);
    if (el && rect) candidates.push({ key: candidates.length, el, rect, state: elStates.added.has(id) ? 'added' : elStates.changed.has(id) ? 'changed' : 'same' });
  });
  before.order.forEach((id) => {
    const el = own(before.elements, id);
    const rect = own(rectsBefore, id);
    if (el && rect && elStates.removed.has(id)) candidates.push({ key: candidates.length, el, rect, state: 'removed' });
  });
  const limit = Math.max(1, Math.min(opts.maxElements ?? MAX_ELEMENTS, MAX_ELEMENTS));
  const drawn = [...candidates.filter((s) => s.state !== 'same'), ...candidates.filter((s) => s.state === 'same')].slice(0, limit).sort((a, b) => a.key - b.key);
  const hidden = candidates.length - drawn.length;

  // A replacement lands where the removed element was: nudge the removed one diagonally so both stay readable.
  const placedRects: Rect[] = drawn.filter((s) => s.state !== 'removed' && s.el.kind === 'node').map((s) => s.rect);
  for (const shape of drawn) {
    if (shape.state !== 'removed' || shape.el.kind !== 'node') continue;
    let rect = shape.rect;
    for (let step = 0; step < 6 && placedRects.some((o) => o.x < rect.x + rect.w && rect.x < o.x + o.w && o.y < rect.y + rect.h && rect.y < o.y + o.h); step++) {
      rect = { ...rect, x: rect.x + 24, y: rect.y + 24 };
    }
    shape.rect = rect;
    placedRects.push(rect);
  }

  // Rect lookup for edges: only elements actually drawn.
  const drawnAfter = new Map<ID, Rect>();
  const drawnBefore = new Map<ID, Rect>();
  for (const shape of drawn) (shape.state === 'removed' ? drawnBefore : drawnAfter).set(shape.el.id, shape.rect);
  const rectFor = (id: ID) => drawnAfter.get(id) ?? drawnBefore.get(id);

  const edgeItems: { edge: EdgeEl; state: State }[] = [
    ...after.edges.map((edge) => ({ edge, state: (edgeStates.added.has(edge.id) ? 'added' : edgeStates.changed.has(edge.id) ? 'changed' : 'same') as State })),
    ...before.edges.filter((edge) => edgeStates.removed.has(edge.id)).map((edge) => ({ edge, state: 'removed' as State })),
  ];
  const edgeParts: string[] = [];
  let edgeCount = 0;
  const ordered = [...edgeItems.filter((i) => i.state !== 'same'), ...edgeItems.filter((i) => i.state === 'same')];
  for (const { edge, state } of ordered) {
    if (edgeCount >= MAX_EDGES) break;
    const a = rectFor(edge.from);
    const b = rectFor(edge.to);
    if (!a || !b) continue;
    edgeParts.push(drawEdge(edge, a, b, state));
    edgeCount++;
  }

  const groups = drawn.filter((s) => s.el.kind === 'group').sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h);
  const nodes = drawn.filter((s) => s.el.kind !== 'group');

  const rects = drawn.map((s) => s.rect);
  const minX = rects.length ? Math.min(...rects.map((r) => r.x)) : 0;
  const minY = rects.length ? Math.min(...rects.map((r) => r.y - 14)) : 0;
  const maxX = rects.length ? Math.max(...rects.map((r) => r.x + r.w)) : 0;
  const maxY = rects.length ? Math.max(...rects.map((r) => r.y + r.h)) : 0;
  const contentW = Math.max(1, maxX - minX);
  const contentH = Math.max(1, maxY - minY);
  const width = Math.max(contentW + MARGIN * 2 + 60, plain ? 240 : 560);
  const head = plain ? 0 : HEADER;
  const height = head + contentH + MARGIN + (plain ? 0 : FOOTER);

  const count = (state: State) => candidates.filter((s) => s.state === state).length;
  const summary = [`Adicionados: ${count('added')}`, `Alterados: ${count('changed')}`, `Removidos: ${count('removed')}`].join(' · ') + (changes.style ? ' · estilo alterado' : '');

  const legendY = height - 26;
  const legend = (['added', 'changed', 'removed', 'same'] as const)
    .map((state, i) => {
      const x = MARGIN + i * 130;
      const name = state === 'same' ? 'Sem mudança' : STATE_TAG[state];
      return `<rect x="${x}" y="${legendY - 11}" width="14" height="14" rx="3" fill="${COLORS[state]}" fill-opacity="0.35" stroke="${COLORS[state]}" stroke-width="2"${state === 'removed' ? ' stroke-dasharray="4 3"' : ''}/><text x="${x + 20}" y="${legendY}" font-size="12" fill="${INK}">${name}</text>`;
    })
    .join('');
  const note = hidden > 0 ? `<text x="${num(width - MARGIN)}" y="${legendY}" font-size="12" text-anchor="end" fill="${COLORS.same}">… +${hidden} elementos não exibidos</text>` : '';

  const header = plain ? '' : `<text x="${MARGIN}" y="30" font-size="16" font-weight="600" fill="${INK}">${esc(heading)}</text><text x="${MARGIN}" y="50" font-size="12" fill="${COLORS.same}">${esc(summary)}</text>`;
  const body =
    header +
    `<g transform="translate(${num(MARGIN + 30 - minX)} ${num(head - minY)})">${groups.map(drawShape).join('')}${edgeParts.join('')}${nodes.map(drawShape).join('')}</g>` +
    (plain ? '' : legend) +
    (plain && hidden > 0 ? `<text x="${num(width - MARGIN)}" y="${num(height - 8)}" font-size="12" text-anchor="end" fill="${COLORS.same}">… +${hidden} elementos não exibidos</text>` : plain ? '' : note);
  return frame(width, height, heading, body);
}

/** Plain SVG of one diagram (same escaper, caps and placement as the diff SVG; nothing marked as changed). */
export function renderDiagramSvg(model: DiagramModel, layout?: LayoutState, opts: Omit<DiffSvgOptions, 'plain'> = {}): string {
  return renderDiffSvg(model, model, layout, layout, { ...opts, plain: true });
}

const RESERVED_STEM = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** `<slug>.diff.svg`, or `null` when the slug (untrusted, from a manifest) is not a plain file name. Windows device names get a `_` prefix. */
export function diffSvgFileName(slug: string): string | null {
  if (slug === '__proto__' || slug.endsWith('.') || !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/.test(slug)) return null;
  const reserved = RESERVED_STEM.test(slug.split('.')[0]!);
  return `${reserved ? '_' : ''}${slug}.diff.svg`;
}

/**
 * Names for a batch of slugs, unique even on case-insensitive filesystems: a later slug whose name collides
 * (case/Unicode-folded) with an earlier one gets `~2`, `~3`… (`~` is not allowed in slugs, so no real slug can clash).
 */
export function assignDiffSvgNames(slugs: string[]): { slug: string; name: string | null }[] {
  const taken = new Set<string>();
  const fold = (n: string) => n.normalize('NFKC').toLowerCase();
  return slugs.map((slug) => {
    const base = diffSvgFileName(slug);
    if (!base) return { slug, name: null };
    let name = base;
    for (let i = 2; taken.has(fold(name)); i++) name = base.replace(/\.diff\.svg$/, `~${i}.diff.svg`);
    taken.add(fold(name));
    return { slug, name };
  });
}

export interface DiagramSvg { slug: string; title: string; svg: string }

/** One SVG per diagram whose model changed between the two sides (slugs sorted; untrusted, see `diffSvgFileName`). */
export function renderDiffSvgs(from: Side, to: Side): DiagramSvg[] {
  const titles = new Map<string, string>();
  for (const d of [...to.data.manifest.diagrams, ...from.data.manifest.diagrams]) titles.set(d.slug, d.title);
  const out: DiagramSvg[] = [];
  for (const slug of [...titles.keys()].sort()) {
    const prev = own(from.data.diagrams, slug);
    const next = own(to.data.diagrams, slug);
    const beforeModel = prev?.model ?? emptyModel();
    const afterModel = next?.model ?? emptyModel();
    if (!anyChange(compareModels(beforeModel, afterModel))) continue;
    const title = titles.get(slug)!;
    out.push({ slug, title, svg: renderDiffSvg(beforeModel, afterModel, prev?.layout, next?.layout, { title }) });
  }
  return out;
}
