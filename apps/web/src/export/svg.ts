import { uiText } from '../i18n';
import { ICON_LABEL, cardinalityGlyph, cardCaption, computeRects, connectorStyle, depthOf, drawingShape, iconCaption, iconLabelSize, labelLines, labelTextWidth, nodeVariant, participantSize, tableSize, unionRect, visualBox } from '@strukt/core';
import type { DiagramModel, EdgeEl, GroupEl, LayoutState, NodeEl, Rect } from '@strukt/core';
import { arrowHead, cachedLabel, cachedRoute, edgeLabelSize, roundedPath, sequenceMessages, textWidth, trimEnd, trimStart } from '@strukt/layout';
import type { EdgeRouter, Point } from '@strukt/layout';
import { iconKey, iconSvg, loadIcon } from '../diagram/icons/registry';
import type { IconDef } from '../diagram/icons/registry';
import { cardColors, captionColor, edgeColor, groupColors, nodeColors } from '../diagram/palette';
import { labelBox, shapeGeometry } from '../diagram/shapes';
import { SHADOW_FILTER_ID, SHADOW_OFFSET, WATERCOLOR_DEFS, WATERCOLOR_FILTER_ID } from '../diagram/watercolor';
import { computeRoutes, routesFresh } from '../state/routing';
import { CANVAS, FONT_STACK } from '../ui/theme';
import type { Theme } from '../ui/theme';

export interface SvgOptions {
  theme: Theme;
  /** Live canvas geometry, including a drag or a filtered perspective. */
  rects?: Record<string, Rect>;
  background?: boolean;
  padding?: number;
  fontCss?: string;
  icons?: Record<string, IconDef | null>;
  /**
   * Routes every edge when `layout.edges` is stale: the app reroutes ~100 ms after commits pause, so an export
   * right after a change would otherwise draw fallback lines. Fresh cached routes are drawn as they are — the
   * canvas's own routes and label spots (the router's repair pass has a wall-clock budget, so routing again
   * under load could differ).
   */
  router?: EdgeRouter;
}

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v: number) => String(Math.round(v * 100) / 100);
const ARROW = 10;

interface Ctx {
  model: DiagramModel;
  opts: SvgOptions;
  icons: Record<string, IconDef | null>;
}

const iconFor = (ctx: Ctx, name?: string) => (name ? (ctx.icons[iconKey(name)] ?? null) : null);
const watercolorAttr = (on: boolean) => (on ? ` filter="url(#${WATERCOLOR_FILTER_ID})"` : '');
const shadowAttr = ` filter="url(#${SHADOW_FILTER_ID})"`;

function renderGroup(el: GroupEl, r: Rect, index: number, ctx: Ctx): string {
  const { model, opts } = ctx;
  const style = el.styleMode ?? model.style.styleMode;
  const font = FONT_STACK[el.typeface ?? model.style.typeface];
  const c = groupColors(el.color, el.colorMode ?? model.style.colorMode, opts.theme);
  const label = el.label ?? el.id;
  const out: string[] = [];
  const rect = (x: number, y: number, extra: string) =>
    `<rect x="${num(x)}" y="${num(y)}" width="${num(r.w)}" height="${num(r.h)}" rx="14" ${extra}/>`;
  if (style === 'shadow') {
    // CSS box-shadow only paints outside the box; the mask reproduces that under transparent groups.
    const id = `strukt-gs${index}`;
    out.push(
      `<mask id="${id}"><rect x="${num(r.x - 40)}" y="${num(r.y - 40)}" width="${num(r.w + 80)}" height="${num(r.h + 80)}" fill="#fff"/>${rect(r.x, r.y, 'fill="#000"')}</mask>`,
      `<g mask="url(#${id})">${rect(r.x, r.y + SHADOW_OFFSET, `fill="${c.shadow}"${shadowAttr}`)}</g>`,
    );
  }
  out.push(rect(r.x, r.y, `fill="${c.fill === 'transparent' ? 'none' : c.fill}" stroke="${c.stroke}" stroke-width="1"${watercolorAttr(style === 'watercolor')}`));
  const icon = iconFor(ctx, el.icon);
  const fontSize = 13;
  const chipH = 22;
  const chipX = r.x + 8;
  const chipY = r.y + 8;
  const chipW = Math.min(textWidth(label, fontSize) + 16 + (icon ? 21 : 0), r.w - 16);
  if (c.titleSurface !== 'transparent') {
    out.push(`<rect x="${num(chipX)}" y="${num(chipY)}" width="${num(chipW)}" height="${chipH}" rx="6" fill="${c.titleSurface}"/>`);
  }
  let textX = chipX + 8;
  if (icon) {
    out.push(iconSvg(icon, textX, chipY + (chipH - 15) / 2, 15, c.stroke, opts.theme));
    textX += 21;
  }
  out.push(
    `<text x="${num(textX)}" y="${num(chipY + chipH / 2)}" dominant-baseline="central" font-family="${esc(font)}" font-size="${fontSize}" font-weight="400" fill="${c.titleText}">${esc(label)}</text>`,
  );
  return out.join('');
}

/** `labelAt`: where the canvas draws the label too (placed with the routes, see computeRoutes). */
function renderEdge(edge: EdgeEl, points: Point[], labelAt: Point, ctx: Ctx, sequenceOrder?: number): { line: string; label: string } {
  const { model, opts } = ctx;
  const style = connectorStyle(edge.connector);
  const startArrow = style.startArrow && !edge.fromCardinality, endArrow = style.endArrow && !edge.toCardinality;
  const color = edgeColor(edge.color, opts.theme);
  let line = points;
  if (endArrow) line = trimEnd(line, ARROW - 1);
  if (startArrow) line = trimStart(line, ARROW - 1);
  const parts = [`<path d="${roundedPath(line)}" fill="none" stroke="${color}" stroke-width="1.25"${style.dashed ? ' stroke-dasharray="6 5"' : ''}/>`];
  const last = points.length - 1;
  if (endArrow && last > 0) parts.push(`<path d="${arrowHead(points[last], points[last - 1], ARROW)}" fill="${color}"/>`);
  if (startArrow && last > 0) parts.push(`<path d="${arrowHead(points[0], points[1], ARROW)}" fill="${color}"/>`);
  if (last > 0) for (const key of ['fromCardinality', 'toCardinality'] as const) {
    const cardinality = edge[key];
    if (!cardinality) continue;
    const glyph = cardinalityGlyph(cardinality, points[key === 'fromCardinality' ? 0 : last]!, points[key === 'fromCardinality' ? 1 : last - 1]!);
    parts.push(`<path d="${glyph.path}" fill="none" stroke="${color}" stroke-width="1.5"/>`);
    if (glyph.circle) parts.push(`<circle cx="${num(glyph.circle[0])}" cy="${num(glyph.circle[1])}" r="4.5" fill="${CANVAS[opts.theme].bg}" stroke="${color}" stroke-width="1.5"/>`);
  }
  const text = sequenceOrder ? `${sequenceOrder}. ${edge.label ?? ''}` : edge.label;
  if (!text) return { line: parts.join(''), label: '' };
  const [mx, my] = labelAt;
  const { w, h } = edgeLabelSize(text);
  const label =
    `<rect x="${num(mx - w / 2)}" y="${num(my - h / 2)}" width="${num(w)}" height="${h}" rx="${num(h / 2)}" fill="${CANVAS[opts.theme].bg}" stroke="${color}" stroke-opacity="0.22"/>` +
    `<text x="${num(mx)}" y="${num(my)}" text-anchor="middle" dominant-baseline="central" font-family="${esc(FONT_STACK[model.style.typeface])}" font-size="12" font-weight="500" fill="${color}">${esc(text)}</text>`;
  return { line: parts.join(''), label };
}

function renderNode(el: NodeEl, r: Rect, ctx: Ctx): string {
  const { model, opts } = ctx;
  const style = el.styleMode ?? model.style.styleMode;
  const font = esc(FONT_STACK[el.typeface ?? model.style.typeface]);
  const c = nodeColors(el.color, el.colorMode ?? model.style.colorMode, opts.theme);
  const label = el.label ?? el.id;
  const icon = iconFor(ctx, el.icon);
  const out = [`<g transform="translate(${num(r.x)} ${num(r.y)})">`];
  if (nodeVariant(el) === 'table') {
    const size = tableSize(el, r.w), caption = cardCaption(el, r.w), colors = cardColors(el.color, undefined, opts.theme);
    out.push(`<rect width="${num(r.w)}" height="${num(r.h)}" rx="12" fill="${colors.fill}" stroke="${colors.stroke}"/><path d="M0,${size.header} H${num(r.w)}" stroke="${colors.stroke}"/>`);
    if (icon) out.push(iconSvg(icon, 16, size.header / 2 - 14, 28, colors.icon, opts.theme));
    const x = el.icon ? 60 : 16;
    const top = (size.header - caption.title.length * 22 - caption.technology.length * 17) / 2;
    out.push(`<text x="${x}" y="${num(top + 17)}" font-family="${font}" font-size="16" font-weight="500" fill="${colors.text}">${caption.title.map((line, i) => `<tspan x="${x}" dy="${i ? 22 : 0}">${esc(line)}</tspan>`).join('')}</text>`);
    if (caption.technology.length) out.push(`<text x="${x}" y="${num(top + caption.title.length * 22 + 14)}" font-family="${font}" font-size="13" fill="${colors.muted}">${caption.technology.map((line, i) => `<tspan x="${x}" dy="${i ? 17 : 0}">${esc(line)}</tspan>`).join('')}</text>`);
    (el.fields ?? []).forEach((field, i) => {
      const y = size.header + i * 32;
      if (i) out.push(`<path d="M0,${y} H${num(r.w)}" stroke="${colors.stroke}"/>`);
      const typeWidth = Math.min(r.w * 0.42, labelTextWidth(field.type ?? '', 12));
      const fieldText = labelLines(field.name, r.w - typeWidth - 70, 13)[0] ?? '';
      const typeText = labelLines(field.type ?? '', r.w * 0.42, 12)[0] ?? '';
      out.push(`<text x="12" y="${y + 21}" font-family="${font}" font-size="10" font-weight="600" fill="${colors.icon}">${esc(field.key ?? "·")}</text><text x="46" y="${y + 21}" font-family="${font}" font-size="13" fill="${colors.text}">${esc(fieldText)}</text><text x="${num(r.w - 12)}" y="${y + 21}" text-anchor="end" font-family="${font}" font-size="12" fill="${colors.muted}">${esc(typeText)}</text>`);
    });
    if (!el.fields?.length) out.push(`<text x="16" y="${size.header + 21}" font-family="${font}" font-size="12" fill="${colors.muted}">Adicione campos nas propriedades</text>`);
  } else if (nodeVariant(el) === 'participant') {
    const size = participantSize(el, r.w), colors = cardColors(el.color, undefined, opts.theme);
    const lines = labelLines(label, r.w - 32 - (icon ? 32 : 0), 15);
    out.push(`<path d="M${num(r.w / 2)},${size.h} V${num(r.h)}" stroke="${colors.muted}" stroke-opacity="0.45" stroke-dasharray="6 5"/><rect width="${num(r.w)}" height="${size.h}" rx="10" fill="${colors.fill}" stroke="${colors.stroke}"/>`);
    if (icon) out.push(iconSvg(icon, 16, size.h / 2 - 12, 24, colors.icon, opts.theme));
    const tx = r.w / 2 + (icon ? 16 : 0), top = (size.h - lines.length * 20 - (el.tech ? 18 : 0)) / 2;
    out.push(`<text x="${num(tx)}" y="${num(top + 15)}" text-anchor="middle" font-family="${font}" font-size="15" font-weight="500" fill="${colors.text}">${lines.map((line, i) => `<tspan x="${num(tx)}" dy="${i ? 20 : 0}">${esc(line)}</tspan>`).join('')}</text>`);
    if (el.tech) out.push(`<text x="${num(tx)}" y="${num(top + lines.length * 20 + 14)}" text-anchor="middle" font-family="${font}" font-size="12" fill="${colors.muted}">${esc(labelLines(el.tech, r.w - 32, 12)[0] ?? '')}</text>`);
  } else if (nodeVariant(el) === 'card') {
    const caption = cardCaption(el, r.w), colors = cardColors(el.color, el.layoutRole, opts.theme);
    out.push(`<rect x="0" y="3" width="${num(r.w)}" height="${num(r.h)}" rx="12" fill="rgba(40,48,64,0.06)"/><rect width="${num(r.w)}" height="${num(r.h)}" rx="12" fill="${colors.fill}" stroke="${colors.stroke}"/>`);
    if (icon) out.push(iconSvg(icon,16,r.h/2-16,32,colors.icon,opts.theme));
    const x = el.icon ? 60 : 16;
    const centered = el.layoutRole === 'shared';
    const tx = centered ? (x + r.w - 16)/2 : x;
    const anchor = centered ? 'middle' : 'start';
    const textHeight=caption.title.length*22+(caption.technology.length?4+caption.technology.length*17:0);
    const top=r.h/2-textHeight/2;
    out.push(`<text x="${num(tx)}" y="${num(top+17)}" text-anchor="${anchor}" font-family="${font}" font-size="${caption.fontSize}" font-weight="500" fill="${colors.text}">${caption.title.map((line,i)=>`<tspan x="${num(tx)}" dy="${i?22:0}">${esc(line)}</tspan>`).join('')}</text>`);
    if(caption.technology.length)out.push(`<text x="${num(tx)}" y="${num(top+caption.title.length*22+17)}" text-anchor="${anchor}" font-family="${font}" font-size="13" fill="${colors.muted}">${caption.technology.map((line,i)=>`<tspan x="${num(tx)}" dy="${i?17:0}">${esc(line)}</tspan>`).join('')}</text>`);
  } else if (nodeVariant(el) === 'icon') {
    // Icon-node labels sit on the canvas, not on a fill: always use the canvas ink.
    const ink = CANVAS[opts.theme].ink;
    if (icon) out.push(iconSvg(icon, 0, 0, Math.min(r.w, r.h), el.color ? nodeColors(el.color, 'outline', opts.theme).icon : ink, opts.theme));
    const { title: lines, technology } = iconCaption(el, iconLabelSize(el).w);
    out.push(`<text x="${num(r.w / 2)}" y="${num(r.h + ICON_LABEL.gap + 15)}" text-anchor="middle" font-family="${font}" font-size="15" letter-spacing="-0.01em" fill="${ink}">${lines.length === 1 ? esc(lines[0]!) : lines.map((line, index) => `<tspan x="${num(r.w / 2)}" dy="${index ? 19 : 0}">${esc(line)}</tspan>`).join('')}</text>`);
    if (technology.length) out.push(`<text x="${num(r.w / 2)}" y="${num(r.h + ICON_LABEL.gap + lines.length * 19 + 14)}" text-anchor="middle" font-family="${font}" font-size="12" fill="${captionColor(opts.theme)}">${technology.map((line, index) => `<tspan x="${num(r.w / 2)}" dy="${index ? 16 : 0}">${esc(line)}</tspan>`).join('')}</text>`);
  } else {
    const shape = drawingShape(el.shape);
    const geo = shapeGeometry(shape, r.w, r.h);
    const box = labelBox(shape, r.w, r.h);
    const fill = c.fill === 'transparent' ? 'none' : c.fill;
    if (style === 'shadow' && fill !== 'none') out.push(`<path d="${geo.d}" transform="translate(0 ${SHADOW_OFFSET})" fill="${c.shadow}"${shadowAttr}/>`);
    out.push(`<path d="${geo.d}" fill="${fill}" stroke="${c.stroke}" stroke-width="1"${watercolorAttr(style === 'watercolor')}/>`);
    if (geo.detail) out.push(`<path d="${geo.detail}" fill="none" stroke="${c.stroke}" stroke-width="1"/>`);
    const fontSize = 14;
    const lines = labelLines(label, Math.max(24, box.w - 24 - (icon ? 28 : 0)), fontSize);
    const tw = Math.max(...lines.map((line) => labelTextWidth(line, fontSize)));
    let x = box.x + box.w / 2 - ((icon ? 28 : 0) + tw) / 2;
    const cy = box.y + box.h / 2;
    if (icon) {
      out.push(iconSvg(icon, x, cy - 10, 20, c.icon, opts.theme));
      x += 28;
    }
    out.push(`<text x="${num(x + tw / 2)}" y="${num(cy - (lines.length - 1) * 9)}" text-anchor="middle" dominant-baseline="central" font-family="${font}" font-size="${fontSize}" fill="${c.text}">${lines.length === 1 ? esc(lines[0]!) : lines.map((line, index) => `<tspan x="${num(x + tw / 2)}" dy="${index ? 18 : 0}">${esc(line)}</tspan>`).join('')}</text>`);
  }
  out.push('</g>');
  return out.join('');
}

/** Every icon the diagram uses, resolved (the SVG renderer is synchronous). */
export async function loadDiagramIcons(model: DiagramModel): Promise<Record<string, IconDef | null>> {
  const names = [...new Set(model.order.flatMap((id) => (model.elements[id]?.icon ? [iconKey(model.elements[id].icon)] : [])))];
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, await loadIcon(name)] as const)));
}

export function renderDiagramSvg(model: DiagramModel, layout: LayoutState, opts: SvgOptions): string {
  const ctx: Ctx = { model, opts, icons: opts.icons ?? {} };
  const rects = opts.rects ?? computeRects(model, layout);
  const routes = opts.router && !routesFresh(model, layout, rects) ? computeRoutes(model, rects, opts.router) : layout.edges;
  const pad = opts.padding ?? 32;
  const bounds =
    unionRect(model.order.flatMap((id) => (model.elements[id] && rects[id] ? [visualBox(model.elements[id], rects[id])] : []))) ??
    { x: 0, y: 0, w: 0, h: 0 };
  const vx = bounds.x - pad;
  const vy = bounds.y - pad;
  const vw = bounds.w + pad * 2;
  const vh = bounds.h + pad * 2;

  const parts: string[] = [];
  if (opts.fontCss) parts.push(`<style>${opts.fontCss}</style>`);
  parts.push(WATERCOLOR_DEFS);
  if (opts.background !== false) parts.push(`<rect x="${num(vx)}" y="${num(vy)}" width="${num(vw)}" height="${num(vh)}" fill="${CANVAS[opts.theme].bg}"/>`);
  const groups = model.order.filter((id) => model.elements[id]?.kind === 'group').sort((a, b) => depthOf(model, a) - depthOf(model, b));
  groups.forEach((id, index) => parts.push(renderGroup(model.elements[id] as GroupEl, rects[id]!, index, ctx)));
  const labels: string[] = [];
  const sequence = sequenceMessages(model, rects);
  for (const edge of model.edges) {
    const a = rects[edge.from];
    const b = rects[edge.to];
    if (!a || !b) continue;
    const message = sequence[edge.id];
    const points = message?.points ?? cachedRoute(routes, edge, a, b, model);
    const rendered = renderEdge(edge, points, message?.label ?? cachedLabel(routes, edge, a, b, points), ctx, message?.order);
    parts.push(rendered.line);
    labels.push(rendered.label);
  }
  for (const id of model.order) {
    const el = model.elements[id];
    if (el?.kind === 'node' && rects[id]) parts.push(renderNode(el, rects[id], ctx));
  }
  parts.push(...labels);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(vw)}" height="${num(vh)}" viewBox="${num(vx)} ${num(vy)} ${num(vw)} ${num(vh)}">${parts.join('')}</svg>`;
}
