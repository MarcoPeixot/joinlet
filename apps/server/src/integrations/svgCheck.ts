/**
 * The diagram SVG comes from the browser (the exporter needs the app's routing, icons and fonts, none of which exist
 * on the server). It is attached to Notion/Confluence pages, so it must be inert: refuse (never rewrite) anything
 * active, external or not well-formed. Tags are read by a small strict scanner (quoted values only), linear in the
 * size of the input, so a `>` inside an attribute value cannot hide an attribute and hostile input cannot stall it.
 */

export const MAX_SVG = 3 * 1024 * 1024;

const FORBIDDEN_TAGS = new Set(['script', 'foreignobject', 'iframe', 'embed', 'object', 'animate', 'animatemotion', 'animatetransform', 'set', 'handler', 'listener', 'audio', 'video']);
const DECLARATION = /<!\s*(?:DOCTYPE|ENTITY|ELEMENT|ATTLIST)\b/i;
const NAME = /[A-Za-z][\w:.-]*/y;
const SPACE = /\s+/y;
const ATTR = /([^\s=/>"'<]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
const END = /\s*(\/?)>/y;
const SAFE_HREF = /^(?:#[\w.:-]+|data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+)$/;
const URL_FN = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
const SAFE_URL = /^(?:#[\w.:-]+|data:(?:image\/(?:png|jpe?g|gif|webp)|font\/(?:woff2?|ttf|otf)|application\/(?:font-woff2?|x-font-[\w-]+|vnd\.ms-fontobject));base64,[A-Za-z0-9+/=]+)$/;
const EXTERNAL = 'O SVG referencia um recurso externo, o que não é aceito.';
const MALFORMED = 'O SVG está malformado.';

function checkCss(css: string): true | string {
  if (/@import\b/i.test(css)) return 'O SVG importa estilos externos, o que não é aceito.';
  for (const match of css.matchAll(URL_FN)) if (!SAFE_URL.test(match[2] ?? '')) return EXTERNAL;
  return true;
}

const at = (re: RegExp, text: string, index: number): RegExpExecArray | null => {
  re.lastIndex = index;
  return re.exec(text);
};

/** `true` when the SVG is safe to attach, else the pt-BR reason. */
export function checkSvg(svg: unknown): true | string {
  if (typeof svg !== 'string' || !svg.trim()) return 'Envie o SVG do diagrama como texto.';
  if (svg.length >= MAX_SVG) return 'O SVG do diagrama é grande demais.';
  const head = svg.replace(/^﻿/, '').trimStart().replace(/^<\?xml[^>]*\?>\s*/i, '');
  if (!/^<svg[\s>]/i.test(head)) return 'O anexo precisa ser um SVG (começando em <svg>).';
  if (DECLARATION.test(svg)) return 'O SVG tem declarações (DOCTYPE/ENTITY) que não são aceitas.';

  let lower: string | undefined;
  let i = 0;
  while ((i = svg.indexOf('<', i)) !== -1) {
    const next = svg[i + 1];
    if (next === '!') {
      const [open, close] = svg.startsWith('<!--', i) ? ['<!--', '-->'] : svg.startsWith('<![CDATA[', i) ? ['<![CDATA[', ']]>'] : [null, null];
      const end = open ? svg.indexOf(close!, i + open.length) : -1;
      if (end === -1) return MALFORMED;
      i = end + close!.length;
      continue;
    }
    if (next === '?') {
      const end = svg.indexOf('?>', i + 2);
      if (end === -1) return MALFORMED;
      i = end + 2;
      continue;
    }
    if (next === '/') {
      const end = svg.indexOf('>', i);
      if (end === -1) return MALFORMED;
      i = end + 1;
      continue;
    }
    const name = at(NAME, svg, i + 1);
    if (!name) return MALFORMED;
    const tag = name[0].toLowerCase().replace(/^.*:/, '');
    if (FORBIDDEN_TAGS.has(tag)) return 'O SVG tem elementos ativos (script, foreignObject, animação…) que não são aceitos.';
    let j = i + 1 + name[0].length;
    for (;;) {
      const space = at(SPACE, svg, j);
      if (space) j += space[0].length;
      const attr = at(ATTR, svg, j);
      if (!attr) break;
      if (!space) return MALFORMED;
      j += attr[0].length;
      const key = attr[1]!.toLowerCase();
      const value = attr[2] ?? attr[3] ?? '';
      if (key.startsWith('on')) return 'O SVG tem manipuladores de evento que não são aceitos.';
      if (key === 'href' || key.endsWith(':href')) {
        if (!SAFE_HREF.test(value)) return EXTERNAL;
      } else if (/url\(|@import|javascript:/i.test(value)) {
        const css = checkCss(value);
        if (css !== true) return css;
        if (/javascript:/i.test(value)) return 'O SVG tem endereços javascript:, que não são aceitos.';
      }
    }
    const end = at(END, svg, j);
    if (!end) return MALFORMED;
    i = j + end[0].length;
    if (tag === 'style' && !end[1]) {
      lower ??= svg.toLowerCase();
      const close = lower.indexOf('</style', i);
      if (close === -1) return MALFORMED;
      const css = checkCss(svg.slice(i, close));
      if (css !== true) return css;
      i = close;
    }
  }
  return true;
}
