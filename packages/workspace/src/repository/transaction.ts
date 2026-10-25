import type { StorageAdapter } from '../storage';
import { StorageConflict } from '../storage';

const queues = new Map<string, Promise<unknown>>();
/** Shared by API, MCP, collaboration and repository analysis in this process. */
export function coordinateWrite<T>(key: string, work: () => Promise<T>): Promise<T> {
  const result = (queues.get(key) ?? Promise.resolve()).then(work, work);
  queues.set(key, result);
  void result.then(() => { if (queues.get(key) === result) queues.delete(key); }, () => { if (queues.get(key) === result) queues.delete(key); });
  return result;
}
export interface FileMutation { path: string; text: string | null; expected: string | null }
/** Validate the whole batch before touching any file. Adapters may provide a durable transaction. */
export async function writeBatch(adapter: StorageAdapter, changes: FileMutation[]): Promise<void> {
  return coordinateWrite(adapter.label, async () => {
    for (const change of changes) if (await adapter.read(change.path) !== change.expected) throw new StorageConflict(`${change.path} changed during synchronization.`);
    if (adapter.batch) return adapter.batch(changes);
    const applied: FileMutation[] = [];
    try {
      for (const change of changes) {
        if (change.text === null) await adapter.remove(change.path); else await adapter.write(change.path, change.text);
        applied.push(change);
      }
    } catch (error) {
      // Roll back only our own writes; never replace a concurrent external edit.
      for (const change of applied.reverse()) if (await adapter.read(change.path) === change.text) {
        if (change.expected === null) await adapter.remove(change.path); else await adapter.write(change.path, change.expected);
      }
      throw error;
    }
  });
}
