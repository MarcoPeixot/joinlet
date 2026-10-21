import { identifyNavigation } from './navigation';
import type { StorageAdapter } from '@strukt/workspace';

/**
 * The slice of the File System Access API (Chrome/Edge) the folder workspace uses. Declared here
 * because TypeScript's DOM lib lacks the permission methods and the directory picker.
 */
export interface FileHandleLike {
  kind: 'file';
  name: string;
  getFile(): Promise<{ text(): Promise<string>; lastModified: number }>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }>;
}

export interface DirHandleLike {
  kind: 'directory';
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string): Promise<void>;
  values(): AsyncIterable<DirHandleLike | FileHandleLike>;
  queryPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
  isSameEntry?(other: DirHandleLike): Promise<boolean>;
}

export const ARCH_DIR = '.arch';

const isNotFound = (err: unknown) => (err as { name?: string } | null)?.name === 'NotFoundError';

async function parentOf(root: DirHandleLike, path: string, create: boolean): Promise<{ dir: DirHandleLike; name: string } | null> {
  const parts = [ARCH_DIR, ...path.split('/')];
  const name = parts.pop()!;
  let dir = root;
  for (const part of parts) {
    try {
      dir = await dir.getDirectoryHandle(part, { create });
    } catch (err) {
      if (!create && isNotFound(err)) return null;
      throw err;
    }
  }
  return { dir, name };
}

async function walk(dir: DirHandleLike, prefix: string, visit: (path: string, handle: FileHandleLike) => void, skipDir?: (path: string) => boolean): Promise<void> {
  for await (const entry of dir.values()) {
    if (entry.kind === 'directory') {
      if (!skipDir?.(`${prefix}${entry.name}`)) await walk(entry, `${prefix}${entry.name}/`, visit, skipDir);
    }
    else visit(`${prefix}${entry.name}`, entry);
  }
}

/**
 * Workspace in `<folder>/.arch/`. `createWritable()` writes to a swap file that replaces the
 * original only on `close()`, so each file write is atomic (spec §9).
 */
export function createFolderAdapter(root: DirHandleLike, navigationId?: string): StorageAdapter {
  /** Walks `.arch/`, calling `visit` with each file's path and its (already resolved) handle. */
  async function walkArch(visit: (path: string, handle?: { lastModified: number }) => void, skipDir?: (path: string) => boolean): Promise<void> {
    let arch: DirHandleLike;
    try {
      arch = await root.getDirectoryHandle(ARCH_DIR);
    } catch (err) {
      if (isNotFound(err)) return;
      throw err;
    }
    const pending: { path: string; handle: FileHandleLike }[] = [];
    await walk(arch, '', (path, handle) => pending.push({ path, handle }), skipDir);
    for (const { path, handle } of pending) {
      let file: { lastModified: number } | undefined;
      try {
        file = await handle.getFile();
      } catch {
        // Removed between the walk and the read: the stamp is 0, so a later poll sees it as changed.
      }
      visit(path, file);
    }
  }

  return identifyNavigation({
    kind: 'folder',
    label: `${root.name}/${ARCH_DIR}`,
    async read(path) {
      const at = await parentOf(root, path, false);
      if (!at) return null;
      try {
        return await (await (await at.dir.getFileHandle(at.name)).getFile()).text();
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    async write(path, text) {
      const at = (await parentOf(root, path, true))!;
      const writable = await (await at.dir.getFileHandle(at.name, { create: true })).createWritable();
      try {
        await writable.write(text);
      } catch (err) {
        // The swap file stays locked until the writable is closed or aborted; abort releases it so
        // the saver's retry can open a fresh one instead of hanging on the same handle.
        await writable.abort?.();
        throw err;
      }
      await writable.close();
    },
    async remove(path) {
      const at = await parentOf(root, path, false);
      if (!at) return;
      try {
        await at.dir.removeEntry(at.name);
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    },
    async list() {
      const out: string[] = [];
      await walkArch((path) => out.push(path));
      return out.sort();
    },
    /**
     * `lastModified` of every file under `.arch/`: the external-change watcher compares these stamps
     * with the ones it last saw (after a save or a reload) to notice an agent writing to the folder.
     * `versions/` and `context/` are not walked: the app writes them itself and can have thousands of files.
     */
    async stamps() {
      const out: Record<string, number> = {};
      await walkArch((path, handle) => {
        out[path] = handle ? handle.lastModified : 0;
      }, (dir) => dir === 'versions' || dir === 'context');
      return out;
    },
  }, navigationId ? `folder:${navigationId}` : `folder-session:${crypto.randomUUID()}`);
}

export async function hasPermission(handle: DirHandleLike): Promise<boolean> {
  return ((await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted') === 'granted';
}

/** Needs a user gesture (the "Reabrir pasta" button). */
export async function requestPermission(handle: DirHandleLike): Promise<boolean> {
  return ((await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'granted') === 'granted';
}

type Picker = (options: { mode: 'readwrite'; id?: string }) => Promise<DirHandleLike>;

export function canPickFolder(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/** Folder picker; `null` when the user cancels. */
export async function pickFolder(): Promise<DirHandleLike | null> {
  try {
    return await (window as unknown as { showDirectoryPicker: Picker }).showDirectoryPicker({ mode: 'readwrite', id: 'strukt' });
  } catch (err) {
    if ((err as { name?: string } | null)?.name === 'AbortError') return null;
    throw err;
  }
}
