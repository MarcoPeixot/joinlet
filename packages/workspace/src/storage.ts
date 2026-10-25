import { MANIFEST_PATH } from './manifest';

/**
 * Where a workspace lives: paths are relative to `.arch/` (`strukt.json`, `diagrams/x.strukt`, …).
 * Each `write` replaces one whole file (atomic per file where the backend allows it).
 */
export interface StorageAdapter {
  readonly kind: 'memory' | 'indexeddb' | 'folder';
  /** Shown in the UI: "Navegador" or the folder name. */
  readonly label: string;
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  /** Removing a missing file is not an error. */
  remove(path: string): Promise<void>;
  list(): Promise<string[]>;
  /**
   * Cheap per-file change stamps (modification time in ms), when the backend can tell files apart
   * on disk. Adapters without it (memory, IndexedDB) disable the external-change watcher.
   */
  stamps?(): Promise<Record<string, number>>;
  batch?(changes: { path: string; text: string | null; expected: string | null }[]): Promise<void>;
}

/** A write refused because the file changed since it was read (an adapter that checks, like the host's REST surface). */
export class StorageConflict extends Error {}

export interface MemoryAdapter extends StorageAdapter {
  readonly files: Map<string, string>;
}

export function createMemoryAdapter(initial: Record<string, string> = {}, label = 'Memória'): MemoryAdapter {
  const files = new Map(Object.entries(initial));
  return {
    kind: 'memory',
    label,
    files,
    read: async (path) => files.get(path) ?? null,
    write: async (path, text) => void files.set(path, text),
    remove: async (path) => void files.delete(path),
    list: async () => [...files.keys()].sort(),
  };
}

/** Writes every file (manifest last, so it never lists a file that is not there yet). */
export async function writeFiles(adapter: StorageAdapter, files: Readonly<Record<string, string>>): Promise<void> {
  const paths = Object.keys(files).sort((a, b) => Number(a === MANIFEST_PATH) - Number(b === MANIFEST_PATH));
  for (const path of paths) await adapter.write(path, files[path]!);
}

/** Makes the adapter hold exactly `files`: writes them, then removes whatever else was there. */
export async function replaceFiles(adapter: StorageAdapter, files: Readonly<Record<string, string>>): Promise<void> {
  const before = await adapter.list();
  await writeFiles(adapter, files);
  for (const path of before) if (!Object.hasOwn(files, path)) await adapter.remove(path);
}

/** The files whose path passes `keep` (zip export and folder copies carry `versions/` and `context/` this way). */
export async function readFiles(adapter: StorageAdapter, keep: (path: string) => boolean): Promise<Record<string, string>> {
  const entries: [string, string][] = [];
  for (const path of (await adapter.list()).filter(keep)) {
    const text = await adapter.read(path);
    if (text !== null) entries.push([path, text]);
  }
  // Object.fromEntries defines own properties: a path like "__proto__" stays a plain key.
  return Object.fromEntries(entries);
}
