import { uiText } from '../i18n';
import { webHref } from '@strukt/workspace';
import { useEffect, useState } from 'react';
import type createDOMPurify from 'dompurify';
import type { marked as markedParser } from 'marked';

/**
 * Markdown → sanitized HTML, shared by workspace docs and the AI documentation modal. The text can
 * be anyone's (a doc anyone can edit, or AI output that echoes diagram content an attacker controls),
 * so the policy is an allowlist, not DOMPurify's defaults: Markdown structure only, no images (neither
 * source has a legitimate image to embed), no inline or global CSS (`style` attribute/element are both
 * dropped). Links: `http(s)` opens in a new tab, `#fragment` links are kept as-is, any other scheme
 * (javascript:, data:, doc:, …) loses its `href`. DOMPurify's default URI policy already strips
 * `javascript:`/`data:`; do not override ALLOWED_URI_REGEXP, it also checks non-URI attributes (e.g.
 * table `align`) and a stricter regex strips those too. The chat's citations are the one internal scheme:
 * `#cite/<slug>/<id>` survives only in a render that passes the check for its exact form (`citations`), never otherwise.
 */
const ALLOWED_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'strong', uiText("em"), 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a'];
const ALLOWED_ATTR = ['href', 'title', 'align', 'start'];

type Purifier = ReturnType<typeof createDOMPurify>;
let purifier: Purifier | undefined;
let parser: typeof markedParser | undefined;
let loading: Promise<void> | undefined;
/** Set around one synchronous `sanitize` call by `renderMarkdown`; the hook below reads it. */
let citationsOn: ((href: string) => boolean) | undefined;

export type HrefRule = 'web' | 'keep' | 'drop';

/** What the sanitizer does with a link's `href`: open as a web link, keep as is (an in-page address), or remove it. */
export function hrefRule(href: string | null, citations?: (href: string) => boolean): HrefRule {
  if (!href) return 'drop';
  if (webHref(href)) return 'web';
  // Any spelling of the citation prefix is held to the exact form, so a near miss is dropped, never kept as a plain fragment.
  if (/^#(?:cite|diagram)\//i.test(href)) return citations?.(href) ? 'keep' : 'drop';
  return href.startsWith('#') ? 'keep' : 'drop';
}

/**
 * DOMPurify and marked are ~100 KB nobody needs to open the canvas, so they load on demand. Awaiting
 * (or `useMarkdownReady`) this before `renderMarkdown` keeps that function synchronous; until then it
 * only returns escaped text, never unsanitized HTML. The DOMPurify instance is created here, not at
 * import time, so nothing touches `window` in Node.
 */
export function preloadMarkdown(): Promise<void> {
  loading ??= Promise.all([import('dompurify'), import('marked')]).then(([{ default: createPurify }, { marked }]) => {
    const instance = createPurify(window);
    instance.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName !== 'A') return;
      const rule = hrefRule(node.getAttribute('href'), citationsOn);
      if (rule === 'web') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      } else if (rule === 'drop') {
        node.removeAttribute('href');
      }
    });
    purifier = instance;
    parser = marked;
  });
  loading.catch(() => { loading = undefined; });
  return loading;
}

/** True once `renderMarkdown` renders real Markdown; starts the load on first use. Put it in the deps of the `useMemo` around `renderMarkdown`. */
export function useMarkdownReady(): boolean {
  const [ready, setReady] = useState(purifier !== undefined);
  useEffect(() => {
    if (ready) return;
    let live = true;
    preloadMarkdown().then(() => live && setReady(true), () => {});
    return () => { live = false; };
  }, [ready]);
  return ready;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderMarkdown(markdown: string, options: { citations?: (href: string) => boolean } = {}): string {
  if (!purifier || !parser) return `<p>${escapeHtml(markdown)}</p>`;
  citationsOn = options.citations;
  try {
    return purifier.sanitize(parser.parse(markdown, { async: false, gfm: true }), { ALLOWED_TAGS, ALLOWED_ATTR });
  } finally {
    citationsOn = undefined;
  }
}
