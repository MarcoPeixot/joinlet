import { uiText } from '../../i18n';
/**
 * The icon picker's catalog: every name the registry resolves, in categories, with search. The data (lucide
 * names, simple-icons titles, the logos subset) loads on demand; nothing here reaches the initial bundle
 * except through `loadIconCatalog()`.
 */
import { own } from '@strukt/core';
import { CLOUD_ICONS } from '@strukt/core/cloud';
import { ARCHITECTURE_LABELS, CATEGORIES, CATEGORY_KEYWORDS, LOGO_WORDS, PT_WORDS } from './catalogText';
import { ALIASES, ICON_SUGGESTIONS, iconKey, lucideKeys } from './registry';

export type IconSource = 'lucide' | 'simple-icons' | 'logos' | 'official-cloud' | 'specialist';

export interface IconEntry {
  /** Exactly the `icon` value an element gets; `loadIcon(name)` resolves it. */
  name: string;
  label: string;
  category: string;
  keywords: string[];
  source: IconSource;
}

export interface IconCategory {
  id: string;
  label: string;
  /** Sidebar heading; categories without one lead the list. */
  group?: string;
  count: number;
}

export interface IconCatalog {
  entries: IconEntry[];
  categories: IconCategory[];
}

export interface IconSection {
  id: string;
  title: string;
  entries: IconEntry[];
}

interface Sources {
  /** lucide name → category id (`lucide-categories.json`). */
  lucide: Record<string, string>;
  /** Keys of lucide's `icons` (canonical names and deprecated aliases, PascalCase), as the registry looks them up. */
  lucideKeys: string[];
  /** category id → curated brand names (`brand-categories.json`). */
  brands: Record<string, string[]>;
  simple: { slug: string; title: string }[];
  /** Icon names of `logos-subset.json`. */
  logos: string[];
  specialist?: { name: string; label: string; category: string; keywords: string[] }[];
}

const CLOUD_PREFIXES: [prefix: string, category: string][] = [
  ['aws', 'aws'],
  ['google-cloud', 'gcp'],
  ['azure', 'azure'],
  ['microsoft-azure', 'azure'],
  ['kubernetes', 'kubernetes'],
];
const USED_LIMIT = 12;

/** Lowercase words without diacritics or punctuation: "Autenticação/Node.js" → "autenticacao node js". */
const words = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const compact = (text: string) => words(text).replace(/ /g, '');
const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

const lucideLabel = (name: string) => capitalize(name.replace(/-/g, ' '));
const ptWords = (name: string) => [...new Set(name.split('-').flatMap((word) => own(PT_WORDS, word) ?? []))];

function logoLabel(name: string): string {
  const parts = name.split('-');
  return (parts[0] === 'aws' && parts.length > 1 ? parts.slice(1) : parts).map((word) => own(LOGO_WORDS, word) ?? capitalize(word)).join(' ');
}

const cloudCategory = (name: string) => CLOUD_PREFIXES.find(([prefix]) => name === prefix || name.startsWith(`${prefix}-`))?.[1];

/** `lucide:split` → ['lucide', 'split']. */
function aliasTarget(target: string): [string, string] {
  const colon = target.indexOf(':');
  return [target.slice(0, colon), target.slice(colon + 1)];
}

const pascal = (name: string) => name.split('-').map(capitalize).join('');
const SOURCE_OF_PREFIX: Record<string, IconSource> = { lucide: 'lucide', si: 'simple-icons', logos: 'logos' };

function buildIconCatalog(sources: Sources): IconCatalog {
  const lucideKeys = new Set(sources.lucideKeys);
  const titles = new Map(sources.simple.map((icon) => [icon.slug, icon.title]));
  const logoNames = new Set(sources.logos);
  // Mirrors registry.resolve: aliases, then lucide (deprecated names too: `grab`), then simple-icons (by the
  // name without punctuation), then logos. `alias` = the name draws another entry's glyph.
  const resolvesTo = (name: string): IconSource | 'alias' | null => {
    const target = own(ALIASES, name);
    if (target) {
      const [prefix, targetName] = aliasTarget(target);
      return targetName === name ? (own(SOURCE_OF_PREFIX, prefix) ?? null) : 'alias';
    }
    if (lucideKeys.has(pascal(name))) return 'lucide';
    if (titles.has(name.replace(/[^a-z0-9]/g, ''))) return 'simple-icons';
    return logoNames.has(name) ? 'logos' : null;
  };

  const buckets = new Map<string, IconEntry[]>(CATEGORIES.map((c) => [c.id, []]));
  const byName = new Map<string, IconEntry>();
  const add = (entry: IconEntry) => {
    if (byName.has(entry.name)) return;
    if (!buckets.has(entry.category)) entry.category = 'misc';
    byName.set(entry.name, entry);
    buckets.get(entry.category)!.push(entry);
  };
  const simpleEntry = (slug: string, category: string): IconEntry => ({ name: slug, label: titles.get(slug)!, category, keywords: [], source: 'simple-icons' });
  const logoEntry = (name: string, category: string): IconEntry => ({ name, label: logoLabel(name), category, keywords: [], source: 'logos' });

  // Eraser generic names (api, queue…) are entries of their own; brand aliases (postgres…) are keywords of the brand.
  const brandAliases = new Map<string, string[]>();
  for (const [alias, target] of Object.entries(ALIASES)) {
    const [prefix, name] = aliasTarget(target);
    if (prefix !== 'lucide') {
      if (alias !== name) brandAliases.set(name, [...(brandAliases.get(name) ?? []), alias]);
      continue;
    }
    const twin = buckets.get('architecture')!.find((e) => compact(e.name) === compact(alias));
    if (twin) twin.keywords.push(alias);
    else add({ name: alias, label: own(ARCHITECTURE_LABELS, alias) ?? lucideLabel(alias), category: 'architecture', keywords: [name, ...ptWords(name)], source: 'lucide' });
  }

  // `azure` already resolves to the `azure-icon` mark.
  const logos = sources.logos.filter((name) => !(name.endsWith('-icon') && logoNames.has(name.slice(0, -'-icon'.length))));
  for (const name of logos) {
    const category = cloudCategory(name);
    if (category && resolvesTo(name) === 'logos') add(logoEntry(name, category));
  }
  for (const [category, names] of Object.entries(sources.brands)) {
    for (const name of names) {
      const source = resolvesTo(name);
      if (source === 'simple-icons' && titles.has(name)) add(simpleEntry(name, category));
      else if (source === 'logos') add(logoEntry(name, category));
    }
  }
  for (const { slug } of sources.simple) if (resolvesTo(slug) === 'simple-icons' && titles.has(slug)) add(simpleEntry(slug, 'brands'));
  for (const name of logos) if (resolvesTo(name) === 'logos') add(logoEntry(name, 'brands'));
  for (const [name, category] of Object.entries(sources.lucide)) {
    const key = resolvesTo(name) === 'lucide' ? name : `lucide:${name}`;
    add({ name: key, label: lucideLabel(name), category, keywords: ptWords(name), source: 'lucide' });
  }
  for (const [name, aliases] of brandAliases) byName.get(name)?.keywords.push(...aliases);
  for (const icon of CLOUD_ICONS) {
    add({
      name: icon.name,
      label: icon.label,
      category: icon.provider,
      keywords: [icon.family, icon.kind, icon.legacy ? 'legacy console' : 'official oficial'],
      source: 'official-cloud',
    });
  }
  for (const icon of sources.specialist ?? []) add({ ...icon, label: uiText(icon.label), source: 'specialist' });

  return {
    entries: CATEGORIES.flatMap((c) => buckets.get(c.id)!),
    categories: CATEGORIES.filter((c) => buckets.get(c.id)!.length).map((c) => ({ ...c, count: buckets.get(c.id)!.length })),
  };
}

let loading: Promise<IconCatalog> | null = null;

export function loadIconCatalog(): Promise<IconCatalog> {
  loading ??= Promise.all([
    import('./lucide-categories.json'),
    lucideKeys(),
    import('./brand-categories.json'),
    // Slugs and titles only: the package itself (~5 MB) loads when a brand is drawn, never to list or search.
    import('./simple-index.json'),
    import('./logos-subset.json'),
    import('./specialist-icons.json'),
  ]).then(
    ([lucide, keys, brands, simple, logos, specialist]) =>
      buildIconCatalog({
        lucide: lucide.default as Record<string, string>,
        lucideKeys: keys,
        brands: brands.default as Record<string, string[]>,
        simple: (simple.default as [string, string][]).map(([slug, title]) => ({ slug, title })),
        logos: Object.keys(logos.default.icons),
        specialist: specialist.default,
      }),
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

interface Prepared {
  entry: IconEntry;
  nameWords: string;
  nameCompact: string;
  labelWords: string;
  labelCompact: string;
  /** Name, label and keywords, fields separated by `|` (tokens never contain one): a token may match anywhere. */
  haystack: string;
  /** Category label and keywords, with a leading space: a token must start one of its words. */
  categoryWords: string;
}

const preparedCache = new WeakMap<IconCatalog, Prepared[]>();
const nameCache = new WeakMap<IconCatalog, Map<string, IconEntry>>();

function prepared(catalog: IconCatalog): Prepared[] {
  let list = preparedCache.get(catalog);
  if (!list) {
    const categoryText = new Map(catalog.categories.map((c) => [c.id, words([c.label, ...(own(CATEGORY_KEYWORDS, c.id) ?? [])].join(' '))]));
    list = catalog.entries.map((entry) => {
      const [nameWords, labelWords] = [words(entry.name), words(entry.label)];
      const [nameCompact, labelCompact] = [nameWords.replace(/ /g, ''), labelWords.replace(/ /g, '')];
      const keywords = entry.keywords.flatMap((k) => [words(k), compact(k)]);
      const haystack = [nameWords, nameCompact, labelWords, labelCompact, ...keywords].join('|');
      return { entry, nameWords, nameCompact, labelWords, labelCompact, haystack, categoryWords: ` ${categoryText.get(entry.category) ?? ''}` };
    });
    preparedCache.set(catalog, list);
  }
  return list;
}

/** 0 exact · 1 starts with the query as a whole word · 2 prefix · 3 a word starts with it · 4 contains. */
function rank(p: Prepared, query: string, queryCompact: string): number {
  if (p.nameCompact === queryCompact || p.labelCompact === queryCompact) return 0;
  if (p.entry.keywords.some((keyword) => {
    const target = own(ALIASES, keyword);
    return target && compact(keyword) === queryCompact && aliasTarget(target)[1] === p.entry.name;
  })) return 0;
  if (p.nameWords.startsWith(`${query} `) || p.labelWords.startsWith(`${query} `)) return 1;
  if (p.nameCompact.startsWith(queryCompact) || p.labelCompact.startsWith(queryCompact)) return 2;
  if (` ${p.nameWords}`.includes(` ${query}`) || ` ${p.labelWords}`.includes(` ${query}`)) return 3;
  return 4;
}

/** Every query token must appear in the name, label or keywords, or start a word of the category; ties keep catalog order. */
export function searchIcons(catalog: IconCatalog, query: string, category?: string): IconEntry[] {
  const tokens = words(query).split(' ').filter(Boolean);
  if (!tokens.length) return category ? catalog.entries.filter((e) => e.category === category) : [...catalog.entries];
  const [joined, joinedCompact] = [tokens.join(' '), tokens.join('')];
  const ranks: IconEntry[][] = [[], [], [], [], []];
  for (const p of prepared(catalog)) {
    if (category && p.entry.category !== category) continue;
    if (tokens.every((token) => p.haystack.includes(token) || p.categoryWords.includes(` ${token}`))) ranks[rank(p, joined, joinedCompact)]!.push(p.entry);
  }
  return ranks.flat();
}

/** The entry for an icon name, also through registry aliases (`postgres` → `postgresql`). */
export function findIcon(catalog: IconCatalog, name: string): IconEntry | undefined {
  let index = nameCache.get(catalog);
  if (!index) {
    index = new Map(catalog.entries.map((e) => [e.name, e]));
    nameCache.set(catalog, index);
  }
  const key = iconKey(name);
  const target = own(ALIASES, key);
  return index.get(key) ?? (target ? index.get(aliasTarget(target)[1]) : undefined);
}

/**
 * The picker's home: icons of this diagram (most used first), suggestions, then every category. Suggestions
 * leave out the Eraser generic names: "Arquitetura" lists them right after.
 */
export function browseSections(catalog: IconCatalog, usedIcons: readonly string[]): IconSection[] {
  const counts = new Map<IconEntry, number>();
  for (const name of usedIcons) {
    const entry = findIcon(catalog, name);
    if (entry) counts.set(entry, (counts.get(entry) ?? 0) + 1);
  }
  const used = [...counts].sort((a, b) => b[1] - a[1]).slice(0, USED_LIMIT).map(([entry]) => entry);
  const suggested = new Set<IconEntry>();
  for (const name of ICON_SUGGESTIONS) {
    const entry = findIcon(catalog, name);
    if (entry && entry.category !== 'architecture') suggested.add(entry);
  }
  const byCategory = new Map<string, IconEntry[]>(catalog.categories.map((c) => [c.id, []]));
  for (const entry of catalog.entries) byCategory.get(entry.category)?.push(entry);
  return [
    ...(used.length ? [{ id: 'used', title: uiText("Neste diagrama"), entries: used }] : []),
    { id: 'suggested', title: uiText("Sugeridos"), entries: [...suggested] },
    ...catalog.categories.map((c) => ({ id: c.id, title: c.label, entries: byCategory.get(c.id)! })),
  ];
}
