/** Reconciles sidebar navigation/deletion with the two mounted document slots. */
export interface DocumentPanes { source: unknown; slugs: string[]; active: number }
export function reconcilePanes(state: DocumentPanes, slug: string, available: readonly string[], source: unknown): DocumentPanes {
  if (state.source !== source) return { source, slugs: [slug], active: 0 };
  let slugs = state.slugs.filter((item) => available.includes(item));
  let active = Math.max(0, Math.min(state.active, slugs.length - 1));
  const existing = slugs.indexOf(slug);
  if (existing >= 0) active = existing;
  else { slugs = slugs.length ? slugs.map((item, index) => index === active ? slug : item) : [slug]; }
  return active === state.active && slugs.length === state.slugs.length && slugs.every((item, index) => item === state.slugs[index]) ? state : { source, slugs, active };
}
