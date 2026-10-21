import { identifyNavigation } from './navigation';
import { uiText } from '../i18n';
import type { StorageAdapter } from '@strukt/workspace';
import type { DirHandleLike } from './folder';

/**
 * Plain IndexedDB (no wrapper library): database `strukt` with two key-value stores —
 * `files` (workspace path → text) and `meta` (which backend is active, the folder handle).
 */
const DB_NAME = 'strukt';
const DB_VERSION = 1;
type StoreName = 'files' | 'meta';

let opening: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      for (const name of ['files', 'meta']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab holding an older-version connection open blocks *its own* future upgrade, not
      // ours — closing here on its versionchange, and resetting the memo, lets that tab's openDb()
      // proceed instead of onblocked-ing forever; this tab reopens fresh on its next call.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    // Without this, a version change blocked by another tab never settles the promise: every
    // adapter call (including the boot-time availability probe) would hang forever.
    request.onblocked = () => reject(new Error(uiText("IndexedDB bloqueado por outra aba. Feche as outras abas do Joinlet e recarregue.")));
  }).catch((err: unknown) => {
    opening = null;
    throw err;
  });
  return opening;
}

/** Resolves when the transaction commits, so a resolved write is durable. */
async function run<T>(store: StoreName, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error ?? request.error);
    tx.onabort = () => reject(tx.error ?? new Error(uiText("Transação do IndexedDB abortada.")));
  });
}

export function createIdbAdapter(namespace: string | null = null): StorageAdapter {
  const key = (path: string): IDBValidKey => namespace === null ? path : [namespace, path];
  return identifyNavigation({
    kind: 'indexeddb',
    label: uiText("Navegador"),
    read: async (path) => ((await run('files', 'readonly', (s) => s.get(key(path)))) as string | undefined) ?? null,
    write: async (path, text) => void (await run('files', 'readwrite', (s) => s.put(text, key(path)))),
    remove: async (path) => void (await run('files', 'readwrite', (s) => s.delete(key(path)))),
    list: async () => (await run('files', 'readonly', (s) => s.getAllKeys())).flatMap((entry) => {
      if (namespace === null) return typeof entry === 'string' ? [entry] : [];
      return Array.isArray(entry) && entry[0] === namespace && typeof entry[1] === 'string' ? [entry[1]] : [];
    }).sort(),
  }, `browser:${namespace ?? "legacy"}`);
}

/** Which storage the app opens on boot. Folder handles are structured-cloneable, so they fit in IndexedDB. */
export type BackendChoice = { kind: 'indexeddb' } | { kind: 'folder'; handle: DirHandleLike };

export async function loadBackendChoice(): Promise<BackendChoice> {
  try {
    return ((await run('meta', 'readonly', (s) => s.get('backend'))) as BackendChoice | undefined) ?? { kind: 'indexeddb' };
  } catch {
    return { kind: 'indexeddb' };
  }
}

export async function saveBackendChoice(choice: BackendChoice): Promise<void> {
  await run('meta', 'readwrite', (s) => s.put(choice, 'backend'));
}
