import { ITEM_LIST, parseManifest, printManifest } from '@strukt/workspace';
import type { ItemEntry, ItemListKey, Manifest } from '@strukt/workspace';

const same = (a: ItemEntry | undefined, b: ItemEntry | undefined) => a?.title === b?.title && a?.folder === b?.folder;

/**
 * One list, three ways: `base` is what this guest last read or wrote, `mine` what it wants to save, `theirs` what the
 * host has now. An item added on either side stays; an item removed on either side goes; a rename or move comes from
 * whoever made it (mine when both did). The order is the host's, then what only this guest added.
 */
function mergeItems(base: readonly ItemEntry[], mine: readonly ItemEntry[], theirs: readonly ItemEntry[]): ItemEntry[] {
  const [inBase, inMine, inTheirs] = [base, mine, theirs].map((list) => new Map(list.map((item) => [item.slug, item]))) as [Map<string, ItemEntry>, Map<string, ItemEntry>, Map<string, ItemEntry>];
  const entry = (slug: string): ItemEntry => {
    const [b, m, t] = [inBase.get(slug), inMine.get(slug), inTheirs.get(slug)];
    if (!m) return t!;
    if (!t) return m;
    return !b || !same(m, b) ? m : t;
  };
  const kept = (slug: string) => {
    if (!inBase.has(slug)) return true; // added by whoever has it
    return inMine.has(slug) && inTheirs.has(slug); // known before: removing it on either side removes it
  };
  const order = [...theirs.map((item) => item.slug), ...mine.map((item) => item.slug).filter((slug) => !inTheirs.has(slug))];
  return order.filter((slug, index) => order.indexOf(slug) === index && kept(slug)).map(entry);
}

function mergeFolders(base: readonly string[], mine: readonly string[], theirs: readonly string[]): string[] {
  const removed = new Set([...base.filter((path) => !theirs.includes(path)), ...base.filter((path) => !mine.includes(path))]);
  return [...new Set([...theirs, ...mine])].filter((path) => !removed.has(path)).sort();
}

/** Three-way merge of two guests' manifests (see `mergeItems`); with no `base` nothing can have been removed. */
export function mergeManifests(base: Manifest | null, mine: Manifest, theirs: Manifest): Manifest {
  const merged: Manifest = {
    version: Math.max(mine.version, theirs.version),
    name: base && mine.name === base.name ? theirs.name : mine.name,
    diagrams: [], docs: [], sketches: [],
  };
  for (const key of ['description', 'logo'] as const) {
    const value = base && mine[key] === base[key] ? theirs[key] : mine[key];
    if (value !== undefined) merged[key] = value;
  }
  const folders: NonNullable<Manifest['folders']> = {};
  for (const key of Object.values(ITEM_LIST) as ItemListKey[]) {
    merged[key] = mergeItems(base?.[key] ?? [], mine[key], theirs[key]);
    const paths = mergeFolders(base?.folders?.[key] ?? [], mine.folders?.[key] ?? [], theirs.folders?.[key] ?? []);
    if (paths.length) folders[key] = paths;
  }
  if (Object.keys(folders).length) merged.folders = folders;
  return merged;
}

const parsed = (text: string | null): Manifest | null => {
  if (text === null) return null;
  try { return parseManifest(text).manifest; } catch { return null; }
};

/** `mergeManifests` over file texts, printed canonically; when `theirs` (or `mine`) is not a manifest, `mine` is kept as it is. */
export function mergeManifestTexts(base: string | null, mine: string, theirs: string): string {
  const [own, other] = [parsed(mine), parsed(theirs)];
  if (!own || !other) return mine;
  return printManifest(mergeManifests(parsed(base), own, other));
}
