import type { ID } from '@strukt/core';
import { stableStringify } from './json';
import type { Level } from './levels';
import { slugify } from './slug';

/**
 * A named reading of a diagram: which elements to show, by tags, C4 level and explicit lists. It never changes the
 * model: the canvas, the exports and the site only look at the diagram through it. Saved per diagram in
 * `diagrams/<slug>.perspectives.json`, so it travels with the repo and the collaboration like the flows file does.
 */
export interface Perspective {
  /** Lowercase `[a-z0-9_-]`, up to 48 characters; part of the site's page names. */
  id: string;
  name: string;
  description?: string;
  /** `chave:valor` tags. Values of one key are alternatives (any of them); different keys all have to match. */
  tags?: string[];
  /** C4 levels, as alternatives (the `nivel` key of `tags`, kept apart so a preset reads as what it is). */
  levels?: Level[];
  /** Always shown, even when the filters do not match (unless hidden, or inside a hidden group). */
  include?: ID[];
  /** Never shown; a hidden group takes its members with it. */
  hide?: ID[];
  /** Groups drawn as one box: their members are not shown. */
  collapsed?: ID[];
  /** What the filters do to what does not match: `hide` (default) removes it, `dim` fades it like the tag lens. */
  mode?: 'hide' | 'dim';
  /** A connection to something that is not shown goes to its nearest shown group instead of disappearing. */
  collapse?: boolean;
}

/** Longest perspective id (part of the site's page names). */
export const PERSPECTIVE_ID_MAX = 48;

export const perspectivesPath = (slug: string) => `diagrams/${slug}.perspectives.json`;

/** What goes to disk. The lists are already clean (they were parsed, or built by the editor), so this only orders the keys. */
export const printPerspectives = (perspectives: readonly Perspective[]): string => stableStringify({ version: 1, perspectives });

const c4 = (id: string, name: string, description: string, levels: Level[], collapse = false): Perspective => ({ id, name, description, levels, ...(collapse ? { collapse } : {}) });

/** The C4 views, available in every diagram without being saved; they only show what has a `nivel:*` tag. */
export const BUILTIN_PERSPECTIVES: readonly Perspective[] = [
  c4('c4-contexto', 'C4: Contexto', 'O sistema e quem o cerca: pessoas e sistemas externos. Os grupos ficam recolhidos.', ['contexto'], true),
  c4('c4-containers', 'C4: Containers', 'As partes executáveis do sistema e o que está em volta delas.', ['contexto', 'container']),
  c4('c4-componentes', 'C4: Componentes', 'O interior dos containers: seus componentes.', ['container', 'componente']),
];

export const isBuiltinPerspective = (id: string): boolean => BUILTIN_PERSPECTIVES.some((perspective) => perspective.id === id);

/** What the diagram offers: its saved perspectives, then the built-in ones it did not override by id. */
export function allPerspectives(saved: readonly Perspective[] | undefined): Perspective[] {
  const own = saved ?? [];
  return [...own, ...BUILTIN_PERSPECTIVES.filter((builtin) => !own.some((item) => item.id === builtin.id))];
}

/** A free id for a new perspective, from its name (`riscos-altos`, then `riscos-altos-2`, …). */
export function newPerspectiveId(name: string, taken: ReadonlySet<string>): string {
  const base = slugify(name).slice(0, PERSPECTIVE_ID_MAX).replace(/-+$/, '');
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const suffix = `-${i}`;
    const candidate = `${base.slice(0, PERSPECTIVE_ID_MAX - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The lists follow an element that was renamed in the diagram; the same array when nothing mentions it. */
export function renamePerspectiveNodes(perspectives: readonly Perspective[], from: ID, to: ID): Perspective[] {
  let changed = false;
  const swap = (ids: ID[] | undefined) => {
    if (!ids?.includes(from)) return ids;
    changed = true;
    return [...new Set(ids.map((id) => (id === from ? to : id)))];
  };
  const next = perspectives.map((perspective) => {
    const include = swap(perspective.include);
    const hide = swap(perspective.hide);
    const collapsed = swap(perspective.collapsed);
    return include === perspective.include && hide === perspective.hide && collapsed === perspective.collapsed ? perspective : { ...perspective, ...(include ? { include } : {}), ...(hide ? { hide } : {}), ...(collapsed ? { collapsed } : {}) };
  });
  return changed ? next : (perspectives as Perspective[]);
}
