import { contextFiles } from './context';
import { isContextFile } from './contextPaths';
import { diagramPath, docPath } from './manifest';
import { loadWorkspace } from './workspace';
import type { WorkspaceData } from './workspace';
import type { StorageAdapter } from './storage';

/** Inspect all generator-owned files, including obsolete diagrams; user notes are never owned. */
export async function inspectContext(adapter: StorageAdapter, data: WorkspaceData, out = 'context') {
  const inputs = [...data.manifest.diagrams.map(d => diagramPath(d.slug)), ...data.manifest.docs.map(d => docPath(d.slug))];
  const missingInputs: string[] = [];
  for (const path of inputs) if (await adapter.read(path) === null) missingInputs.push(path);
  const files = Object.fromEntries(Object.entries(contextFiles(data)).map(([path, text]) => [out + path.slice('context'.length), text]));
  const owned = (path: string) => path.startsWith(out + '/') && isContextFile('context/' + path.slice(out.length + 1));
  const missing: string[] = [], changed: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    const current = await adapter.read(path);
    if (current === null) missing.push(path);
    else if (current !== text) changed.push(path);
  }
  const obsolete = (await adapter.list()).filter(path => owned(path) && !Object.hasOwn(files, path)).sort();
  return { files, missing, changed, obsolete, missingInputs, stale: !!(missingInputs.length || missing.length || changed.length || obsolete.length) };
}

export async function writeGeneratedContext(adapter: StorageAdapter, data: WorkspaceData, out = 'context'): Promise<string[]> {
  const status = await inspectContext(adapter, data, out);
  if (status.missingInputs.length) throw new Error(`Cannot generate context: missing workspace files: ${status.missingInputs.join(', ')}`);
  for (const path of [...status.missing, ...status.changed]) await adapter.write(path, status.files[path]!);
  for (const path of status.obsolete) await adapter.remove(path);
  return [...status.missing, ...status.changed, ...status.obsolete].sort();
}

const pending = new Map<string, Promise<unknown>>();
/** Server-owned refresh: serializes projections and loads their latest persisted model, never a guest's generated text. */
export async function refreshGeneratedContext(adapter: StorageAdapter, _force = true): Promise<string[]> {
  const key = adapter.label;
  const task = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const loaded = await loadWorkspace(adapter);
    // A room or commit may contain standalone files before a workspace manifest exists.
    if (!loaded) return [];
    // A transient manifest-before-file save must not publish an incomplete architecture as fresh knowledge.
    if (loaded.warnings.length) return []; // Keep the previous context until the remaining files arrive; verify reports the stale state.
    if ((await inspectContext(adapter, loaded.data)).missingInputs.length) return [];
    return writeGeneratedContext(adapter, loaded.data);
  });
  pending.set(key, task);
  try { return await task; }
  finally { if (pending.get(key) === task) pending.delete(key); }
}
