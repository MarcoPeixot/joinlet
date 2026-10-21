let active: { slug: string; flush(): void; fit(ids: string[]): void } | null = null;
export function registerSketch(slug: string, flush: () => void, fit: (ids: string[]) => void) {
  const entry = { slug, flush, fit }; active = entry;
  return () => { if (active === entry) active = null; };
}
export function flushSketchEdits() { active?.flush(); }

export function fitSketch(slug: string, ids: string[] = []) { if (active?.slug === slug) active.fit(ids); }
