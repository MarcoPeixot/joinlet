import { emptyModel, own } from '@strukt/core';
import type { DiagramElement, DiagramModel, LayoutState } from '@strukt/core';
import { docSlugOf } from './links';
import { LEVELS, LEVEL_LABELS, LEVEL_KEY, levelOf } from './levels';
import { allPerspectives, isBuiltinPerspective } from './perspectives';
import type { Perspective } from './perspectives';
import { projectPerspective, resolvePerspective, sharedTagsOf } from './perspectiveView';
import { escapeHtml, plainText, renderMarkdownLite, safeHref } from './site/markdownLite';
import type { ItemEntry } from './manifest';
import type { WorkspaceData } from './workspace';

/**
 * Static architecture site (pure: path -> file content). No JavaScript, no external resources, strict CSP. Everything
 * in the workspace is untrusted: text is escaped, links are allowlisted (`http(s):`, `doc:`, `diagram:`), slugs must be
 * plain file names, and the SVG comes from an injected renderer whose output is still screened before it is inlined.
 */

export interface SiteDeps {
  /** SVG markup for one diagram (the CLI passes the escaping renderer from `@strukt/git`). */
  renderDiagramSvg(slug: string, model: DiagramModel, layout: LayoutState): string;
}

export interface SiteReport {
  files: Record<string, string>;
  /** pt-BR notes about items left out of the site (invalid file names, page caps). */
  skipped: string[];
}

export const SITE_MAX_DIAGRAMS = 200;
export const SITE_MAX_DOCS = 200;
/** Perspective pages per diagram (the saved ones first, then the built-in C4 views). */
export const SITE_MAX_PERSPECTIVES = 20;
const MAX_LISTED_ELEMENTS = 400;
const MAX_LISTED_EDGES = 800;
const MAX_SVG = 4_000_000;

const CSP = "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'";
const PERSPECTIVE_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const SAFE_SLUG = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/;
const RESERVED_STEM = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const UNSAFE_TAG = /^<(?:script|foreignObject|iframe|object|embed|image|style|animate|set[\s/>]|use[\s/>]|a[\s/>]|!\[CDATA|!ENTITY|!DOCTYPE)/i;
/** Namespaced element names (`<svg:script>`) dodge the denylist above, and the renderer never emits them. */
const NAMESPACED_TAG = /^<\/?[^\s/>]*:/;
const NAMED_ENTITIES: Record<string, string> = { colon: ':', tab: '', newline: '', nbsp: '', lpar: '(', rpar: ')' };

/** True when any attribute value, once entities/whitespace/controls are stripped, starts with a script URL scheme. */
function hasScriptUrl(tag: string): boolean {
  for (const m of tag.matchAll(/=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    const value = (m[1] ?? m[2] ?? m[3] ?? '')
      .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
      .replace(/&#(\d+);?/g, (_, d: string) => String.fromCodePoint(Math.min(parseInt(d, 10), 0x10ffff)))
      .replace(/&([a-z]+);?/gi, (all, n: string) => NAMED_ENTITIES[n.toLowerCase()] ?? all)
      // eslint-disable-next-line no-control-regex
      .replace(/[\s\u0000-\u001f\u007f-\u009f]/g, '')
      .toLowerCase();
    if (value.startsWith('javascript:') || value.startsWith('vbscript:')) return true;
  }
  return false;
}
/** Attribute names that run code or navigate; tested on the tag with its quoted values blanked, so a label like `one=` is fine. */
const UNSAFE_ATTRIBUTE = /[\s/"'](?:on[a-z]+|(?:xlink:)?href)\s*=/i;

/** Page file stem for a slug (untrusted), or `null`. `__proto__` is refused; Windows device names get a `_` prefix. */
function stemOf(slug: string): string | null {
  if (slug === '__proto__' || !SAFE_SLUG.test(slug) || slug.endsWith('.')) return null;
  return `${RESERVED_STEM.test(slug.split('.')[0]!) ? '_' : ''}${slug}`;
}

interface Named { entry: ItemEntry; stem: string }

/** Assigns unique (case/Unicode-insensitive) page stems; a later collision gets `~2`, `~3`… (`~` is not allowed in slugs). */
function assign(entries: ItemEntry[], limit: number, label: string, skipped: string[]): Named[] {
  const taken = new Set<string>();
  const fold = (n: string) => n.normalize('NFKC').toLowerCase();
  const out: Named[] = [];
  for (const entry of entries) {
    const base = stemOf(entry.slug);
    if (!base) {
      skipped.push(`${label} ${JSON.stringify(plainText(entry.slug, 40))} ignorado: o slug não é um nome de arquivo válido.`);
      continue;
    }
    if (out.length >= limit) continue;
    let stem = base;
    for (let i = 2; taken.has(fold(stem)); i++) stem = `${base}~${i}`;
    taken.add(fold(stem));
    out.push({ entry, stem });
  }
  const valid = entries.filter((e) => stemOf(e.slug)).length;
  if (valid > limit) skipped.push(`Limite de páginas: mostrando os primeiros ${limit} de ${valid} (${label}s).`);
  return out;
}

const t = (text: string | undefined, max = 200) => escapeHtml(plainText(text ?? '', max));

function page(title: string, root: string, body: string): string {
  return (
    '<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">\n<meta name="referrer" content="no-referrer">\n` +
    `<title>${t(title)}</title>\n<link rel="stylesheet" href="${root}style.css">\n</head>\n<body>\n${body}\n<footer><small>Gerado pelo Joinlet</small></footer>\n</body>\n</html>\n`
  );
}

const nav = (root: string, name: string) => `<nav><a href="${root}index.html">← ${t(name, 80)}</a></nav>`;

/**
 * Structural screen: text between tags is free (a renderer escapes `<`, so a `<` always opens a tag), but every tag must
 * close, avoid the element denylist and carry no event-handler / href attribute. An unterminated tag or quote rejects.
 */
function safeSvg(raw: string): string | null {
  if (raw.length > MAX_SVG || !/^<svg[\s>]/.test(raw)) return null;
  for (let at = raw.indexOf('<'); at !== -1; at = raw.indexOf('<', at)) {
    let quote = '';
    let end = at + 1;
    for (; end < raw.length; end += 1) {
      const c = raw[end]!;
      if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if (c === '>') break; else if (c === '<') return null;
    }
    if (end >= raw.length) return null;
    const tag = raw.slice(at, end + 1);
    if (UNSAFE_TAG.test(tag) || NAMESPACED_TAG.test(tag) || hasScriptUrl(tag) || UNSAFE_ATTRIBUTE.test(tag.replace(/"[^"]*"|'[^']*'/g, '""'))) return null;
    at = end + 1;
  }
  return raw;
}

/** The filters of a perspective in a sentence, for its page. */
function describePerspective(perspective: Perspective): string {
  const parts: string[] = [];
  if (perspective.levels?.length) parts.push(`Níveis: ${LEVELS.filter((level) => perspective.levels!.includes(level)).map((level) => LEVEL_LABELS[level]).join(', ')}`);
  const tags = (perspective.tags ?? []).filter((tag) => !tag.toLowerCase().startsWith(`${LEVEL_KEY}:`));
  if (tags.length) parts.push(`Tags: ${tags.join(', ')}`);
  if (perspective.hide?.length) parts.push(`${perspective.hide.length} oculto(s) pelo nome`);
  return parts.length ? parts.join(' · ') : 'Sem filtros: mostra tudo o que não está oculto.';
}

function elementLabel(model: DiagramModel, id: string): string {
  return plainText(own(model.elements, id)?.label ?? id, 80);
}

export function buildSiteReport(data: WorkspaceData, deps: SiteDeps): SiteReport {
  const skipped: string[] = [];
  const diagrams = assign(data.manifest.diagrams, SITE_MAX_DIAGRAMS, 'Diagrama', skipped);
  const docs = assign(data.manifest.docs, SITE_MAX_DOCS, 'Documento', skipped);
  const docStem = new Map(docs.map((d) => [d.entry.slug, d.stem]));
  const diagramStem = new Map(diagrams.map((d) => [d.entry.slug, d.stem]));
  const name = data.manifest.name;
  const files: Record<string, string> = {};
  const put = (path: string, content: string) => Object.defineProperty(files, path, { value: content, enumerable: true, writable: true, configurable: true });

  const resolveDoc = (slug: string, from: 'docs' | 'diagrams') => {
    const stem = docStem.get(slug);
    return stem === undefined || !own(data.docs, slug) ? null : `${from === 'docs' ? '' : '../docs/'}${stem}.html`;
  };
  const linkOf = (link: string | undefined): { href: string; external: boolean; text: string } | null => {
    if (!link) return null;
    if (link.startsWith('diagram:')) {
      const stem = diagramStem.get(link.slice(8));
      return stem === undefined ? null : { href: `${stem}.html`, external: false, text: 'Diagrama' };
    }
    const target = safeHref(link, { resolveDoc: (slug) => resolveDoc(slug, 'diagrams') });
    if (!target) return null;
    return { ...target, text: docSlugOf(link) ? 'Documento' : link.length > 60 ? `${link.slice(0, 59)}…` : link };
  };

  const docReferences = new Map<string, Named[]>();
  for (const d of diagrams) {
    const model = own(data.diagrams, d.entry.slug)?.model ?? emptyModel();
    for (const id of model.order.slice(0, MAX_LISTED_ELEMENTS)) {
      const slug = docSlugOf(own(model.elements, id)?.link);
      if (slug && docStem.has(slug)) docReferences.set(slug, [...(docReferences.get(slug) ?? []).filter((x) => x !== d), d]);
    }
  }

  /** The perspectives of a diagram that deserve a page: saved ones, and the built-in C4 views once levels exist. */
  const perspectivePages = (slug: string, snapshot: { model: DiagramModel; layout: LayoutState } | undefined) => {
    if (!snapshot) return [];
    const tagsOf = sharedTagsOf(data.shared, slug);
    const leveled = snapshot.model.order.some((id) => levelOf(tagsOf(id)));
    const out: { perspective: Perspective; projected: { model: DiagramModel; layout: LayoutState } }[] = [];
    let capped = false;
    for (const perspective of allPerspectives(own(data.perspectives ?? {}, slug))) {
      if (!PERSPECTIVE_ID.test(perspective.id)) continue;
      if (isBuiltinPerspective(perspective.id) && !leveled && !own(data.perspectives ?? {}, slug)?.some((saved) => saved.id === perspective.id)) continue;
      const view = resolvePerspective(snapshot.model, tagsOf, perspective);
      if (!view.counts.shown) {
        if (!isBuiltinPerspective(perspective.id)) skipped.push(`Perspectiva ${JSON.stringify(plainText(perspective.id, 40))} de ${JSON.stringify(plainText(slug, 40))} ignorada: ela não mostra nenhum elemento.`);
        continue;
      }
      if (out.length >= SITE_MAX_PERSPECTIVES) {
        capped = true;
        continue;
      }
      out.push({ perspective, projected: projectPerspective(snapshot.model, snapshot.layout, view) });
    }
    if (capped) skipped.push(`Limite de perspectivas: mostrando as primeiras ${SITE_MAX_PERSPECTIVES} de ${JSON.stringify(plainText(slug, 40))}.`);
    return out;
  };

  for (const d of diagrams) {
    const snapshot = own(data.diagrams, d.entry.slug);
    const model = snapshot?.model ?? emptyModel();
    let svg: string | null = null;
    try {
      svg = safeSvg(deps.renderDiagramSvg(d.entry.slug, model, snapshot?.layout ?? { nodes: {}, edges: {} }));
    } catch {
      svg = null;
    }
    if (svg === null) skipped.push(`Diagrama ${JSON.stringify(plainText(d.entry.slug, 40))}: o SVG foi omitido (marcação insegura, grande demais ou falha ao gerar).`);
    const sectionsOf = (shown: DiagramModel) => {
      const items = shown.order.slice(0, MAX_LISTED_ELEMENTS).flatMap((id) => {
        const el: DiagramElement | undefined = own(shown.elements, id);
        if (!el) return [];
        const link = linkOf(el.link);
        const parent = el.parentId ? ` <small>em ${t(elementLabel(shown, el.parentId), 80)}</small>` : '';
        const tech = el.tech ? ` <code>${t(el.tech, 60)}</code>` : '';
        const desc = el.description ? `<dd>${t(el.description, 400)}</dd>` : '';
        const anchor = link ? `<dd><a href="${escapeHtml(link.href)}" rel="noopener noreferrer"${link.external ? ' target="_blank"' : ''}>${t(link.text, 80)}</a></dd>` : '';
        return [`<dt>${t(el.label ?? el.id, 80)}${tech}${parent}</dt>${desc}${anchor}`];
      });
      const edges = shown.edges.slice(0, MAX_LISTED_EDGES).map((e) => {
        const label = e.label ? ` <small>(${t(e.label, 60)})</small>` : '';
        return `<li>${t(elementLabel(shown, e.from), 80)} → ${t(elementLabel(shown, e.to), 80)}${label}</li>`;
      });
      const more = shown.order.length > MAX_LISTED_ELEMENTS ? `<p><small>Mostrando os primeiros ${MAX_LISTED_ELEMENTS} de ${shown.order.length} elementos.</small></p>` : '';
      return (
        `<section><h2>Componentes</h2>${items.length ? `<dl>${items.join('')}</dl>` : '<p class="muted">Sem componentes.</p>'}${more}</section>\n` +
        `<section><h2>Conexões</h2>${edges.length ? `<ul>${edges.join('')}</ul>` : '<p class="muted">Sem conexões.</p>'}</section>`
      );
    };
    const pages = perspectivePages(d.entry.slug, snapshot);
    const perspectiveNav = pages.length
      ? `<section><h2>Perspectivas</h2><ul>${pages.map((p) => `<li><a href="${d.stem}~p~${p.perspective.id}.html">${t(p.perspective.name, 80)}</a>${p.perspective.description ? ` <small>${t(p.perspective.description, 160)}</small>` : ''}</li>`).join('')}</ul></section>\n`
      : '';
    put(
      `diagrams/${d.stem}.html`,
      page(
        `${d.entry.title} — ${name}`,
        '../',
        `${nav('../', name)}\n<main>\n<h1>${t(d.entry.title)}</h1>\n` +
          `<figure class="diagram">${svg ?? '<p class="muted">Não foi possível exibir este diagrama.</p>'}</figure>\n` +
          `${perspectiveNav}${sectionsOf(model)}\n</main>`,
      ),
    );
    for (const p of pages) {
      let drawn: string | null = null;
      try {
        drawn = safeSvg(deps.renderDiagramSvg(d.entry.slug, p.projected.model, p.projected.layout));
      } catch {
        drawn = null;
      }
      if (drawn === null) skipped.push(`Perspectiva ${JSON.stringify(plainText(p.perspective.id, 40))} de ${JSON.stringify(plainText(d.entry.slug, 40))}: o SVG foi omitido (marcação insegura, grande demais ou falha ao gerar).`);
      put(
        `diagrams/${d.stem}~p~${p.perspective.id}.html`,
        page(
          `${d.entry.title} · ${p.perspective.name} — ${name}`,
          '../',
          `${nav('../', name)}\n<main>\n<p><a href="${d.stem}.html">← ${t(d.entry.title, 120)}</a></p>\n<h1>${t(d.entry.title)} <small>· ${t(p.perspective.name, 80)}</small></h1>\n` +
            `${p.perspective.description ? `<p class="muted">${t(p.perspective.description, 300)}</p>\n` : ''}<p class="muted">${t(describePerspective(p.perspective), 300)}</p>\n` +
            `<figure class="diagram">${drawn ?? '<p class="muted">Não foi possível exibir esta perspectiva.</p>'}</figure>\n${sectionsOf(p.projected.model)}\n</main>`,
        ),
      );
    }
  }

  for (const d of docs) {
    const text = own(data.docs, d.entry.slug) ?? '';
    const refs = docReferences.get(d.entry.slug) ?? [];
    const used = refs.length
      ? `<section><h2>Usado em</h2><ul>${refs.map((r) => `<li><a href="../diagrams/${r.stem}.html">${t(r.entry.title, 120)}</a></li>`).join('')}</ul></section>`
      : '';
    put(
      `docs/${d.stem}.html`,
      page(`${d.entry.title} — ${name}`, '../', `${nav('../', name)}\n<main>\n<h1>${t(d.entry.title)}</h1>\n<article>${renderMarkdownLite(text, { resolveDoc: (slug) => resolveDoc(slug, 'docs') })}</article>\n${used}\n</main>`),
    );
  }

  const list = (entries: Named[], dir: string) => `<ul class="cards">${entries.map((e) => `<li><a href="${dir}/${e.stem}.html">${t(e.entry.title, 120)}</a></li>`).join('')}</ul>`;
  const sketches = data.manifest.sketches.filter((s) => s.slug !== '__proto__');
  const notes = skipped.length ? `<section><h2>Avisos</h2><ul>${skipped.map((s) => `<li>${t(s, 300)}</li>`).join('')}</ul></section>` : '';
  put(
    'index.html',
    page(
      name,
      '',
      `<main>\n<h1>${t(name)}</h1>\n<p class="muted">Arquitetura em ${diagrams.length} ${diagrams.length === 1 ? 'diagrama' : 'diagramas'} e ${docs.length} ${docs.length === 1 ? 'documento' : 'documentos'}.</p>\n` +
        `<section><h2>Diagramas</h2>${diagrams.length ? list(diagrams, 'diagrams') : '<p class="muted">Nenhum diagrama.</p>'}</section>\n` +
        `<section><h2>Documentos</h2>${docs.length ? list(docs, 'docs') : '<p class="muted">Nenhum documento.</p>'}</section>\n` +
        (sketches.length ? `<section><h2>Esboços</h2><p class="muted">Não incluídos no site estático.</p><ul>${sketches.map((s) => `<li>${t(s.title, 120)}</li>`).join('')}</ul></section>\n` : '') +
        `${notes}\n</main>`,
    ),
  );
  put('style.css', STYLE);
  return { files, skipped };
}

/** `buildSiteReport(...).files`: path -> content. */
export function buildSite(data: WorkspaceData, deps: SiteDeps): Record<string, string> {
  return buildSiteReport(data, deps).files;
}

const STYLE = `:root{color-scheme:light dark;--bg:#faf9f4;--panel:#fff;--text:#111827;--muted:#515b60;--border:#d3dcd2;--accent:#356b16}
@media (prefers-color-scheme: dark){:root{--bg:#0d1318;--panel:#151d23;--text:#f5f7f2;--muted:#b5bfc4;--border:#2b363e;--accent:#a3ff3d}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
main,nav,footer{max-width:960px;margin:0 auto;padding:16px}
h1{font-size:1.75rem;line-height:1.25;margin:.5rem 0}
h2{font-size:1.25rem;margin:1.5rem 0 .5rem}
h3,h4,h5,h6{margin:1.25rem 0 .5rem}
a{color:var(--accent)}
a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.muted,small{color:var(--muted)}
code,pre{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:.9em}
code{background:var(--panel);border:1px solid var(--border);border-radius:4px;padding:0 4px}
pre{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:12px;overflow:auto}
pre code{border:0;padding:0;background:none}
blockquote{margin:1rem 0;padding:0 1rem;border-left:3px solid var(--accent);color:var(--muted)}
hr{border:0;border-top:1px solid var(--border)}
figure.diagram{margin:1rem 0;padding:12px;background:#fff;border:1px solid var(--border);border-radius:12px;overflow:auto}
figure.diagram svg{display:block;max-width:100%;height:auto;margin:0 auto}
dl{margin:0}
dt{font-weight:600;margin-top:.75rem}
dd{margin:0 0 0 1rem;color:var(--muted)}
ul.cards{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
ul.cards li{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:12px 16px}
footer{color:var(--muted)}
`;
