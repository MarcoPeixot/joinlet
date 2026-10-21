const MAX_LENGTH = 60;

/** File-name slug for a title: lowercase ASCII, pt-BR accents folded (NFKD), words joined by `-`. */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LENGTH)
    .replace(/-+$/, '');
  return slug || 'sem-titulo';
}

/** `slugify(title)`, numbered (`-2`, `-3`, …) until it is not in `taken`. */
export function uniqueSlug(title: string, taken: ReadonlySet<string>): string {
  const base = slugify(title);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}
