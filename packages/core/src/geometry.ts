import { own } from './ids';
import type { DiagramElement, DiagramModel, GroupEl, ID, LayoutState, NodeBox, NodeEl, Shape } from './model';
import { LEGACY_SHAPES, drawingShape } from './model';
import { childrenByParent, depthOf, depthsOf, descendantsOf } from './tree';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

export const GROUP_PADDING = { top: 44, right: 28, bottom: 28, left: 28 } as const;
export const ICON_NODE_SIZE: Size = { w: 56, h: 56 };
/** Label box rendered under icon nodes; it must fit inside the parent group. */
export const ICON_LABEL = { width: 140, height: 52, gap: 22 } as const;
export const EMPTY_GROUP_SIZE: Size = { w: 320, h: 200 };

export const SHAPE_SIZES: Record<Shape, Size> = {
  rectangle: { w: 160, h: 64 },
  oval: { w: 160, h: 64 },
  ellipse: { w: 160, h: 80 },
  circle: { w: 96, h: 96 },
  diamond: { w: 150, h: 96 },
  hexagon: { w: 160, h: 72 },
  parallelogram: { w: 170, h: 64 },
  trapezoid: { w: 170, h: 64 },
  triangle: { w: 120, h: 96 },
  star: { w: 110, h: 104 },
  document: { w: 150, h: 80 },
  cylinder: { w: 120, h: 88 },
  cloud: { w: 200, h: 120 },
  queue: { w: 180, h: 72 },
  bucket: { w: 150, h: 112 },
  actor: { w: 140, h: 144 },
  component: { w: 180, h: 80 },
  server: { w: 160, h: 104 },
  browser: { w: 180, h: 104 },
  mobile: { w: 120, h: 160 },
  package: { w: 180, h: 96 },
  note: { w: 160, h: 96 },
  process: { w: 180, h: 72 },
  delay: { w: 160, h: 72 },
};

export const SHAPE_LABEL_INSETS: Record<Shape, [number, number, number, number]> = {
  rectangle: [0, 0, 0, 0], oval: [0, 0.08, 0, 0.08], ellipse: [0.12, 0.12, 0.12, 0.12],
  circle: [0.15, 0.15, 0.15, 0.15], diamond: [0.22, 0.22, 0.22, 0.22], hexagon: [0, 0.14, 0, 0.14],
  parallelogram: [0, 0.12, 0, 0.12], trapezoid: [0, 0.1, 0, 0.1], triangle: [0.42, 0.22, 0.04, 0.22],
  star: [0.3, 0.28, 0.2, 0.28], document: [0, 0, 0.14, 0], cylinder: [0.2, 0, 0.1, 0],
  cloud: [0.32, 0.16, 0.16, 0.16], queue: [0, 0.14, 0, 0.06], bucket: [0.22, 0.12, 0.1, 0.12],
  actor: [0.58, 0, 0, 0], component: [0, 0, 0, 0.14], server: [0.34, 0.02, 0.02, 0.02],
  browser: [0.24, 0, 0, 0], mobile: [0.16, 0.06, 0.16, 0.06], package: [0.24, 0, 0, 0],
  note: [0.18, 0, 0, 0], process: [0, 0.07, 0, 0.07], delay: [0, 0.2, 0, 0],
};

export type NodeVariant = 'shape' | 'icon' | 'card' | 'table' | 'participant';

/** Eraser semantics: a node with an icon and no explicit shape renders as a standalone icon. */
export function nodeVariant(el: NodeEl): NodeVariant {
  if (el.presentation === 'table' || el.presentation === 'participant') return el.presentation;
  if (el.presentation === 'card') return 'card';
  if (el.presentation === 'icon' && el.icon) return 'icon';
  return el.icon && (!el.shape || (LEGACY_SHAPES as readonly string[]).includes(el.shape)) ? 'icon' : 'shape';
}

export function defaultSize(el: DiagramElement): Size {
  if (el.kind === 'group') return EMPTY_GROUP_SIZE;
  if (el.presentation === 'table') return tableSize(el);
  if (el.presentation === 'participant') return { w: participantSize(el).w, h: 300 };
  if (nodeVariant(el) === 'card') return cardSize(el);
  if (nodeVariant(el) === 'icon') return ICON_NODE_SIZE;
  const shape = drawingShape(el.shape);
  const base = SHAPE_SIZES[shape];
  const label = el.label ?? el.id;
  const inset = el.icon ? 52 : 24;
  const [top, right, bottom, left] = SHAPE_LABEL_INSETS[shape];
  const longest = Math.max(0, ...label.split(/\s+/).map((word) => labelTextWidth(word, 14)));
  const w = Math.max(base.w, Math.min(500, Math.ceil((longest + inset) / (1 - left - right))));
  const lines = labelLines(label, w * (1 - left - right) - inset, 14).length;
  const h = Math.max(base.h, Math.ceil((lines * 18 + 8) / (1 - top - bottom)));
  return shape === 'circle' || shape === 'star' ? { w: Math.max(w, h), h: Math.max(w, h) } : { w, h };
}

export function cardCaption(el: NodeEl, width: number): { title: string[]; technology: string[]; fontSize: number } {
  const fontSize = el.layoutRole === 'entry' ? 18 : 16;
  const textWidth = Math.max(40, width - 32 - (el.icon ? 44 : 0));
  return { title: labelLines(el.label ?? el.id, textWidth, fontSize), technology: el.tech ? labelLines(el.tech, textWidth, 13) : [], fontSize };
}

export function cardSize(el: NodeEl, width?: number): Size {
  const base = el.layoutRole === 'entry' ? 236 : 204;
  const longest = Math.max(0, ...[el.label ?? el.id, el.tech ?? ''].flatMap(text => text.split(/\s+/)).map(word => labelTextWidth(word, el.layoutRole === 'entry' ? 18 : 16)));
  const w = width ?? Math.max(base, Math.min(420, Math.ceil(longest + 32 + (el.icon ? 44 : 0))));
  const caption = cardCaption(el, w);
  return { w, h: Math.max(84, 28 + caption.title.length * 22 + (caption.technology.length ? 4 + caption.technology.length * 17 : 0)) };
}

export const TABLE_ROW_HEIGHT = 32;
export const SEQUENCE_MESSAGE_GAP = 64;

export function tableSize(el: NodeEl, width?: number): Size & { header: number } {
  const longest = Math.max(labelTextWidth(el.label ?? el.id, 16) + 64, ...((el.fields ?? []).map(field => labelTextWidth(field.name, 13) + labelTextWidth(field.type ?? '', 12) + 88)));
  const w = Math.max(width ?? 280, Math.min(560, Math.ceil(longest)));
  const caption = cardCaption(el, w);
  const header = Math.max(64, 24 + caption.title.length * 22 + caption.technology.length * 17);
  return { w, h: header + Math.max(1, el.fields?.length ?? 0) * TABLE_ROW_HEIGHT, header };
}

export function participantSize(el: NodeEl, width = 180): Size {
  const w = Math.max(width, Math.min(320, Math.ceil(labelTextWidth(el.label ?? el.id, 15) + 48)));
  const lines = labelLines(el.label ?? el.id, w - 32 - (el.icon ? 32 : 0), 15);
  return { w, h: Math.max(64, 24 + lines.length * 20 + (el.tech ? 18 : 0)) };
}

export function labelTextWidth(text: string, fontSize: number): number {
  return Array.from(text).reduce((sum, char) => sum + fontSize * (char === ' ' ? 0.35 : /[MW@#]/.test(char) ? 0.9 : char.codePointAt(0)! >= 0x2e80 ? 1 : /\p{Lu}/u.test(char) ? 0.74 : 0.62), 0);
}

/** Shared wrapping for the reserved footprint and SVG; long words gain space before they are split. */
export function labelLines(text: string, width: number, fontSize: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (labelTextWidth(candidate, fontSize) <= width) { line = candidate; continue; }
      if (line) { out.push(line); line = ''; }
      for (const char of word) {
        if (line && labelTextWidth(line + char, fontSize) > width) { out.push(line); line = ''; }
        line += char;
      }
    }
    out.push(line.trimEnd());
  }
  return out.length ? out : [''];
}

export function iconLabelSize(el: NodeEl): Size {
  const label = el.label ?? el.id;
  const longest = Math.max(0, ...label.split(/\s+/).map((word) => labelTextWidth(word, 15)));
  const w = Math.max(ICON_LABEL.width, Math.min(280, Math.ceil(longest + 8)));
  const caption = iconCaption(el, w);
  return { w, h: Math.max(ICON_LABEL.height, ICON_LABEL.gap + caption.title.length * 19 + (caption.technology.length ? 2 + caption.technology.length * 16 : 0)) };
}

export function iconCaption(el: NodeEl, width: number): { title: string[]; technology: string[] } {
  const tech = el.tech?.split(/\s+[·•|]\s+|\n/).slice(0, 2).join(' · ').trim();
  const lines = tech ? labelLines(tech, width, 12) : [];
  const technology = lines.slice(0, 2);
  if (lines.length > 2) technology[1] = `${technology[1]!.slice(0, -1).trimEnd()}…`;
  return { title: labelLines(el.label ?? el.id, width, 15), technology };
}

export function groupTitleBox(el: GroupEl, rect: Rect): Rect {
  return { x: rect.x + 8, y: rect.y + 8, w: Math.max(0, Math.min(rect.w - 16, labelTextWidth(el.label ?? el.id, 13) + 16 + (el.icon ? 21 : 0))), h: 22 };
}

export function visualBox(el: DiagramElement, r: Rect): Rect {
  if (el.kind === 'node' && nodeVariant(el) === 'icon') {
    const label = iconLabelSize(el);
    const extra = Math.max(0, (label.w - r.w) / 2);
    return { x: r.x - extra, y: r.y, w: r.w + extra * 2, h: r.h + label.h };
  }
  return r;
}

export function unionRect(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null;
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Absolute rect of every element. Groups wrap their children (deepest first);
 * `frozen` pins group rects while one of their children is being dragged.
 */
export function computeRects(
  model: DiagramModel,
  layout: LayoutState,
  frozen: Readonly<Record<ID, Rect>> = {},
): Record<ID, Rect> {
  const rects: Record<ID, Rect> = {};
  for (const id of model.order) {
    const el = model.elements[id];
    if (!el || el.kind !== 'node') continue;
    const box = own(layout.nodes, id);
    const size = defaultSize(el);
    const table = el.presentation === 'table' ? tableSize(el, box?.w) : null;
    const w = table?.w ?? (el.presentation === 'participant' ? participantSize(el, box?.w).w : box?.w ?? size.w);
    const h = table ? Math.max(table.h, box?.h ?? 0) : el.presentation==='card'?Math.max(box?.h??0,cardSize(el,w).h):box?.h??size.h;
    rects[id] = { x: box?.x ?? 0, y: box?.y ?? 0, w, h };
  }
  const participants = model.order.filter(id => model.elements[id]?.presentation === 'participant' && model.elements[id]?.kind === 'node');
  const messages = model.edges.filter(edge => participants.includes(edge.from) && participants.includes(edge.to));
  const lastMessage = Math.max(0, ...participants.map(id => rects[id]!.y + participantSize(model.elements[id] as NodeEl, rects[id]!.w).h)) + 48 + messages.length * SEQUENCE_MESSAGE_GAP;
  for (const id of participants) rects[id]!.h = Math.max(rects[id]!.h, lastMessage - rects[id]!.y);
  const depths = depthsOf(model);
  const childrenOf = childrenByParent(model);
  const groups = model.order
    .filter((id) => model.elements[id]?.kind === 'group')
    .sort((a, b) => depths.get(b)! - depths.get(a)!);
  for (const id of groups) {
    const pinned = own(frozen, id);
    if (pinned) {
      rects[id] = pinned;
      continue;
    }
    const children = childrenOf.get(id) ?? [];
    const bounds = unionRect(children.map((child) => visualBox(model.elements[child]!, rects[child]!)));
    if (!bounds) {
      const box = own(layout.nodes, id);
      rects[id] = { x: box?.x ?? 0, y: box?.y ?? 0, w: box?.w ?? EMPTY_GROUP_SIZE.w, h: box?.h ?? EMPTY_GROUP_SIZE.h };
      continue;
    }
    rects[id] = {
      x: bounds.x - GROUP_PADDING.left,
      y: bounds.y - GROUP_PADDING.top,
      w: bounds.w + GROUP_PADDING.left + GROUP_PADDING.right,
      h: bounds.h + GROUP_PADDING.top + GROUP_PADDING.bottom,
    };
  }
  return rects;
}

export function center(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function contains(r: Rect, p: { x: number; y: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function innermostGroupAt(
  model: DiagramModel,
  rects: Readonly<Record<ID, Rect>>,
  point: { x: number; y: number },
  exclude: ReadonlySet<ID>,
): ID | undefined {
  let best: ID | undefined;
  let bestDepth = -1;
  for (const id of model.order) {
    const r = rects[id];
    if (model.elements[id]?.kind !== 'group' || !r || exclude.has(id) || !contains(r, point)) continue;
    const depth = depthOf(model, id);
    if (depth > bestDepth) {
      best = id;
      bestDepth = depth;
    }
  }
  return best;
}

/**
 * New positions for everything stored under `id` after moving it by (dx, dy). Groups with children
 * are derived, so they are skipped. Only x/y are emitted: merging them keeps sizes explicitly stored
 * in the layout, and computed default sizes never become persisted state.
 */
export function translateSubtree(
  model: DiagramModel,
  rects: Readonly<Record<ID, Rect>>,
  id: ID,
  dx: number,
  dy: number,
): Record<ID, NodeBox> {
  const out: Record<ID, NodeBox> = {};
  for (const target of [id, ...descendantsOf(model, id)]) {
    const el = own(model.elements, target);
    const r = rects[target];
    if (!el || !r) continue;
    const hasChildren = el.kind === 'group' && model.order.some((other) => model.elements[other]?.parentId === target);
    if (!hasChildren) out[target] = { x: r.x + dx, y: r.y + dy };
  }
  return out;
}
