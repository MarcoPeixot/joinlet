import type { ItemEntry, ItemKind, ItemListKey, Manifest } from './manifest';

/**
 * Folders of the sidebar (diagrams, docs and sketches each have their own tree). A folder is not a directory in
 * `.arch/`: it is a path string kept on the manifest, `ItemEntry.folder` for items and `Manifest.folders` for empty
 * folders, so item files keep their flat paths (stable links, slugs and git history).
 */

export const MAX_FOLDER_DEPTH = 4;
export const MAX_FOLDER_NAME = 60;

const LIST: Record<ItemKind, ItemListKey> = { diagram: 'diagrams', doc: 'docs', sketch: 'sketches' };
const BAD_SEGMENT = new Set(['.', '..', '__proto__']);

/** "A / B/" → "A/B"; null for anything that cannot be a folder path (empty, dots, too deep, too long, `__proto__`). */
export function normalizeFolder(input: string): string | null {
  const segments = input.split('/').map((part) => part.trim()).filter(Boolean);
  if (!segments.length || segments.length > MAX_FOLDER_DEPTH) return null;
  if (segments.some((segment) => segment.length > MAX_FOLDER_NAME || BAD_SEGMENT.has(segment))) return null;
  return segments.join('/');
}

export const folderName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
export const folderParent = (path: string): string | null => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null);

export interface FolderNode {
  name: string;
  path: string;
  folders: FolderNode[];
  items: ItemEntry[];
}

export interface FolderTree {
  folders: FolderNode[];
  items: ItemEntry[];
}

const byName = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });

/** Every folder path with its ancestors, from item folders and declared (possibly empty) ones. Sorted, unique. */
export function knownFolders(entries: readonly ItemEntry[], declared: readonly string[] = []): string[] {
  const all = new Set<string>();
  for (const path of [...entries.flatMap((entry) => (entry.folder ? [entry.folder] : [])), ...declared]) {
    for (let current: string | null = path; current; current = folderParent(current)) all.add(current);
  }
  return [...all].sort(byName);
}

/** The sidebar tree of one kind: items keep manifest order, folders are sorted by name, empty declared folders show. */
export function buildFolderTree(entries: readonly ItemEntry[], declared: readonly string[] = []): FolderTree {
  const root: FolderTree = { folders: [], items: [] };
  const nodes = new Map<string, FolderNode>();
  for (const path of knownFolders(entries, declared)) {
    const node: FolderNode = { name: folderName(path), path, folders: [], items: [] };
    nodes.set(path, node);
    const parent = folderParent(path);
    (parent ? nodes.get(parent)!.folders : root.folders).push(node);
  }
  for (const entry of entries) (entry.folder ? nodes.get(entry.folder)!.items : root.items).push(entry);
  return root;
}

const withFolders = (manifest: Manifest, key: ItemListKey, paths: string[]): Manifest => {
  const folders = { ...manifest.folders, [key]: [...new Set(paths)].sort(byName) };
  if (!folders[key]!.length) delete folders[key];
  const { folders: _old, ...rest } = manifest;
  void _old;
  return Object.keys(folders).length ? { ...rest, folders } : rest;
};

const declaredOf = (manifest: Manifest, key: ItemListKey): string[] => manifest.folders?.[key] ?? [];

/** Puts an item in a folder (null = the root). An invalid folder name or an unknown slug changes nothing. */
export function moveItem(manifest: Manifest, kind: ItemKind, slug: string, folder: string | null): Manifest {
  const path = folder === null ? null : normalizeFolder(folder);
  if (folder !== null && path === null) return manifest;
  const key = LIST[kind];
  if (!manifest[key].some((entry) => entry.slug === slug)) return manifest;
  return {
    ...manifest,
    [key]: manifest[key].map((entry) => {
      if (entry.slug !== slug) return entry;
      const { folder: _drop, ...rest } = entry;
      void _drop;
      return path ? { ...rest, folder: path } : rest;
    }),
  };
}

/** Declares an (empty) folder; items can be moved into it afterwards. */
export function createFolder(manifest: Manifest, kind: ItemKind, path: string): Manifest {
  const normal = normalizeFolder(path);
  if (!normal) return manifest;
  const key = LIST[kind];
  if (knownFolders(manifest[key], declaredOf(manifest, key)).includes(normal)) return manifest;
  return withFolders(manifest, key, [...declaredOf(manifest, key), normal]);
}

const under = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

/** Renames or moves a folder (`to` is the new full path), carrying its items and subfolders along. */
export function renameFolder(manifest: Manifest, kind: ItemKind, from: string, to: string): Manifest {
  const target = normalizeFolder(to);
  if (!target || target === from || under(target, from)) return manifest;
  const key = LIST[kind];
  const move = (path: string) => (under(path, from) ? target + path.slice(from.length) : path);
  const next = { ...manifest, [key]: manifest[key].map((entry) => (entry.folder && under(entry.folder, from) ? { ...entry, folder: move(entry.folder) } : entry)) };
  return withFolders(next, key, declaredOf(manifest, key).map(move));
}

/** Removes a folder but never its content: items and subfolders move up to the parent. */
export function deleteFolder(manifest: Manifest, kind: ItemKind, path: string): Manifest {
  const key = LIST[kind];
  const parent = folderParent(path);
  const lift = (current: string): string | null => {
    if (!under(current, path)) return current;
    const rest = current.slice(path.length + 1);
    return [parent, rest].filter(Boolean).join('/') || null;
  };
  const entries = manifest[key].map((entry) => {
    if (!entry.folder || !under(entry.folder, path)) return entry;
    const { folder: _drop, ...rest } = entry;
    void _drop;
    const next = lift(entry.folder);
    return next ? { ...rest, folder: next } : rest;
  });
  const declared = declaredOf(manifest, key).flatMap((current) => (current === path ? [] : [lift(current)!]));
  return withFolders({ ...manifest, [key]: entries }, key, declared);
}
