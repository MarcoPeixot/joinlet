/**
 * The internal address of a chat citation, `#cite/<slug>/<id>`: written by `linkCitations`, read back (strictly) by the
 * sanitizer (`docs/markdown.ts`) and the click handler. Kept apart from `citations.ts` so the sanitizer does not carry
 * the resolver.
 */
const SLUG = '[A-Za-z0-9][A-Za-z0-9_-]{0,63}';
const ENCODED_ID = '(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2}){1,600}';
const HREF = new RegExp(`^#cite/(${SLUG})/(${ENCODED_ID})$`);
const CONTROL = /[\u0000-\u001f\u007f]/;
/** `encodeURIComponent` that also takes the characters Markdown reads as link syntax. */
const encodeId = (id: string) => encodeURIComponent(id).replace(/[!'()*~]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

export const citationHref = (diagram: string, id: string): string => `#cite/${diagram}/${encodeId(id)}`;

/** The strict reading of an internal address; anything that is not exactly one is `null` (never trust an href). */
export function parseCitationHref(href: string | null | undefined): { diagram: string; id: string } | null {
  const match = typeof href === 'string' ? HREF.exec(href) : null;
  if (!match) return null;
  let id: string;
  try {
    id = decodeURIComponent(match[2]!);
  } catch {
    return null;
  }
  if (!id.trim() || CONTROL.test(id)) return null;
  return { diagram: match[1]!, id };
}


export const diagramCitationHref = (diagram:string):string => `#diagram/${diagram}`;
export function parseReferenceHref(href:string|null|undefined):{diagram:string;id:string}|null {
  const element=parseCitationHref(href);if(element)return element;
  const match=typeof href==='string'?new RegExp(`^#diagram/(${SLUG})$`).exec(href):null;
  return match?{diagram:match[1]!,id:''}:null;
}
