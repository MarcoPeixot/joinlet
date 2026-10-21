import { assertBetaGrowth, isWorkspaceLogo } from '@strukt/workspace';
import { uiText } from '../i18n';
import { openDb } from './idb';
import { catalogStore, LEGACY_WORKSPACE } from './catalog';
import type { WorkspaceCatalog, WorkspaceEntry, WorkspaceLocation } from './catalog';

async function readMetadata(key: string): Promise<unknown> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('meta', 'readonly');
    const request = tx.objectStore('meta').get(key);
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error(uiText("Não foi possível ler a lista de projetos.")));
  });
}

/** One transaction prevents two tabs from overwriting each other's catalog entries. */
async function updateMetadata<T>(key: string, change: (value: unknown) => T): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction('meta', 'readwrite');
    const store = tx.objectStore('meta');
    const request = store.get(key);
    let value: T;
    let failure: unknown;
    request.onsuccess = () => {
      try {
        value = change(request.result);
        store.put(value, key);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(failure ?? tx.error ?? request.error);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error(uiText("Não foi possível salvar a lista de projetos.")));
  });
}

const invalid = () => new Error(uiText("A lista de projetos está inválida. Seus arquivos foram preservados."));

export function parseCatalog(value: unknown): WorkspaceCatalog | null {
  if (value === undefined || value === null) return null;
  const catalog = value as WorkspaceCatalog;
  if (catalog.version !== 1 || !Array.isArray(catalog.entries)) throw invalid();
  const ids = new Set<string>();
  const browserNamespaces = new Set<string | null>();
  for (const entry of catalog.entries) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)
      || typeof entry.name !== 'string' || !entry.name.trim()
      || !Number.isFinite(entry.createdAt) || !Number.isFinite(entry.lastOpenedAt)) throw invalid();
    if (entry.logo !== undefined && !isWorkspaceLogo(entry.logo)) delete entry.logo;
    ids.add(entry.id);
    const location = entry.location;
    if (!location || (location.kind === 'browser' ? !(location.namespace === null || typeof location.namespace === 'string' && !!location.namespace)
      : location.kind === 'repository' ? typeof location.root !== 'string' || !location.root
      : location.kind === 'folder' ? location.handle?.kind !== 'directory'
      : true)) throw invalid();
    if (location.kind === 'browser') {
      if (browserNamespaces.has(location.namespace)) throw invalid();
      browserNamespaces.add(location.namespace);
    }
  }
  if (catalog.activeId !== null && !ids.has(catalog.activeId)) throw invalid();
  return catalog;
}

export async function loadCatalog(): Promise<WorkspaceCatalog | null> {
  const catalog = parseCatalog(await readMetadata('catalog'));
  catalogStore.setState({ catalog, available: true });
  return catalog;
}

export async function updateCatalog(change: (current: WorkspaceCatalog | null) => WorkspaceCatalog): Promise<WorkspaceCatalog> {
  const catalog = await updateMetadata('catalog', (value) => {
    const before = parseCatalog(value);
    const next = change(before);
    assertBetaGrowth('workspaces', before?.entries.length ?? 0, next.entries.length);
    parseCatalog(next);
    return next;
  });
  catalogStore.setState({ catalog, available: true });
  return catalog;
}

export async function rememberWorkspace(location: WorkspaceLocation, name: string, id?: string): Promise<void> {
  const current = await loadCatalog();
  let existing: WorkspaceEntry | undefined;
  for (const entry of current?.entries ?? []) {
    const at = entry.location;
    if (location.kind === 'folder' && at.kind === 'folder'
      && (at.handle === location.handle || await location.handle.isSameEntry?.(at.handle))) existing = entry;
  }
  const now = Date.now();
  const catalog = await updateCatalog((catalog) => {
    const entries = catalog?.entries ?? [];
    const match = existing ?? entries.find((entry) => {
      const at = entry.location;
      return id ? entry.id === id
        : location.kind === 'browser' && at.kind === 'browser' ? at.namespace === location.namespace
        : location.kind === 'repository' && at.kind === 'repository' ? at.root === location.root : false;
    });
    const activeId = match?.id ?? id ?? crypto.randomUUID();
    const next = { id: activeId, name, location, createdAt: match?.createdAt ?? now, lastOpenedAt: now };
    return { version: 1, activeId, entries: [...entries.filter((entry) => entry.id !== activeId), next] };
  });
  catalogStore.setState({ activeId: catalog.activeId });
}
