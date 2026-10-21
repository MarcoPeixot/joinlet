import { own } from '@strukt/core';
import type { ID } from '@strukt/core';
import type { DiagramSnapshot } from './diagram';
import type { ItemEntry } from './manifest';

/** A diagram element points at a workspace doc through its Eraser `link` property: `link: "doc:<slug>"`. */
export const DOC_LINK_PREFIX = 'doc:';
export const DIAGRAM_LINK_PREFIX = 'diagram:';

export const docLink = (slug: string) => `${DOC_LINK_PREFIX}${slug}`;
export const diagramLink = (slug: string) => `${DIAGRAM_LINK_PREFIX}${slug}`;

export function diagramSlugOf(link: string | undefined): string | null {
  if (!link?.startsWith(DIAGRAM_LINK_PREFIX)) return null;
  return link.slice(DIAGRAM_LINK_PREFIX.length) || null;
}

export function docSlugOf(link: string | undefined): string | null {
  if (!link?.startsWith(DOC_LINK_PREFIX)) return null;
  return link.slice(DOC_LINK_PREFIX.length) || null;
}

/** Only `http(s):` links become clickable web links; any other scheme (javascript:, data:, …) is never an href. */
export function webHref(link: string | undefined | null): string | null {
  return link && /^https?:\/\//i.test(link.trim()) ? link.trim() : null;
}

export interface DocReference {
  diagram: string;
  diagramTitle: string;
  id: ID;
  label: string;
}

/** Elements linked to `docSlug` across `diagrams`, in sidebar order, then declaration order. */
export function referencesTo(docSlug: string, diagrams: Readonly<Record<string, DiagramSnapshot>>, order: readonly ItemEntry[]): DocReference[] {
  return order.flatMap(({ slug, title }) => {
    const model = own(diagrams, slug)?.model;
    if (!model) return [];
    return model.order.flatMap((id) => {
      const el = model.elements[id];
      return el && docSlugOf(el.link) === docSlug ? [{ diagram: slug, diagramTitle: title, id, label: el.label ?? id }] : [];
    });
  });
}
