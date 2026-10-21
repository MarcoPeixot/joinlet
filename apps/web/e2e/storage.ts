import { parseDiagramJson } from '@strukt/json';
import type { DiagramModel } from '@strukt/core';
import type { Page } from '@playwright/test';

/**
 * Reads a workspace file the app autosaved (IndexedDB `strukt`, store `files`, 400 ms after each change).
 * Only call it after the app booted: opening the database first would create it without its stores.
 */
export function readFile(page: Page, path: string): Promise<string | null> {
  return page.evaluate(
    (key) =>
      new Promise<string | null>((resolve, reject) => {
        const open = indexedDB.open('strukt');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          try {
            const tx = db.transaction(['files', 'meta']);
            const catalog = tx.objectStore('meta').get('catalog');
            let result: string | null = null;
            catalog.onsuccess = () => {
              const entry = catalog.result?.entries?.find((item: { id: string }) => item.id === catalog.result.activeId);
              const namespace = entry?.location?.kind === 'browser' ? entry.location.namespace : null;
              const request = tx.objectStore('files').get(namespace ? [namespace, key] : key);
              request.onsuccess = () => { result = request.result ?? null; };
            };
            tx.oncomplete = () => { db.close(); resolve(result); };
            tx.onerror = () => { db.close(); reject(tx.error); };
          } catch (err) {
            // No `files` store yet (the app hasn't booted): fail fast instead of hanging forever.
            db.close();
            reject(err);
          }
        };
      }),
    path,
  );
}

/** Every path in the workspace's IndexedDB store (versions are written straight there, not autosaved). */
export function listFiles(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('strukt');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['files', 'meta']);
          const catalog = tx.objectStore('meta').get('catalog');
          let result: string[] = [];
          catalog.onsuccess = () => {
            const entry = catalog.result?.entries?.find((item: { id: string }) => item.id === catalog.result.activeId);
            const namespace = entry?.location?.kind === 'browser' ? entry.location.namespace : null;
            const request = tx.objectStore('files').getAllKeys();
            request.onsuccess = () => {
              result = request.result.flatMap((key) => namespace === null ? typeof key === 'string' ? [key] : [] : Array.isArray(key) && key[0] === namespace ? [String(key[1])] : []).sort();
            };
          };
          tx.oncomplete = () => { db.close(); resolve(result); };
          tx.onerror = () => { db.close(); reject(tx.error); };
        };
      }),
  );
}

/** The saved diagram, read back through the JSON reader (the `.strukt.json` file is the source of truth). */
export async function savedDiagram(page: Page, slug = 'exemplo'): Promise<{ model: DiagramModel; layout: { nodes: Record<string, { x: number; y: number }> } } | null> {
  const [json, layout] = await Promise.all([readFile(page, `diagrams/${slug}.strukt.json`), readFile(page, `diagrams/${slug}.layout.json`)]);
  if (json === null) return null;
  return { model: parseDiagramJson(json).model, layout: JSON.parse(layout ?? '{"nodes":{}}') };
}
