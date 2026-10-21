import { uiText } from '../i18n';
import { own } from '@strukt/core';
import { ARCHITECTURE_PATH, contextPaths, isContextFile } from '@strukt/workspace';
import type { WorkspaceData } from '@strukt/workspace';
import type { Workspace } from '../workspace/workspace';

type ContextFiles = (data: WorkspaceData) => Record<string, string>;
let generator: Promise<ContextFiles> | undefined;

/** The generator (~16 KB) is a separate chunk: it only loads once the workspace has, or is asked for, agent context. */
const loadGenerator = (): Promise<ContextFiles> => {
  generator ??= import('@strukt/workspace/context').then((m) => m.contextFiles);
  generator.catch(() => {
    generator = undefined;
  });
  return generator;
};

export interface ContextSync {
  /** Writes `.arch/context/` now; from then on it follows every change of the workspace. Returns the files. */
  generate(): Promise<Record<string, string>>;
  /** The open workspace keeps `context/` in sync (it has `context/ARCHITECTURE.md`). */
  enabled(): boolean;
  /** Resolves when the check of the open workspace's `context/` is done. */
  ready(): Promise<void>;
  dispose(): void;
}

/**
 * Keeps `.arch/context/` in step with the workspace once it was generated (spec: "agents with stale context").
 * Cheap enough to run on every save: the generator is pure string work over data already in memory, runs only
 * when the debounced autosave writes (once per data version, however many files ask), and the saver skips text
 * that did not change — context has no positions, so dragging nodes rewrites nothing.
 */
export function createContextSync(workspace: Workspace): ContextSync {
  let enabled = false;
  /** Generated files known to exist; the ones no longer generated (deleted diagrams) are removed. */
  let written = new Set<string>();
  let cache: { data: WorkspaceData; files: Record<string, string> } | null = null;
  let checking: Promise<void> = Promise.resolve();
  let disposed = false;
  /** Set once the generator is loaded: `schedule` only runs after that, so it can stay synchronous. */
  let contextFiles: ContextFiles | null = null;

  const filesOf = (data: WorkspaceData) => {
    if (cache?.data !== data) cache = { data, files: contextFiles!(data) };
    return cache.files;
  };

  /**
   * Queues every `context/` file for the workspace's CURRENT `data` (captured here, once, as `data`).
   * The scheduled closures below read only this local `data` — never `workspace.store` again — so a
   * write still queued when `open()` swaps in another workspace resolves against the data (and lands in
   * the storage) it had when it was queued, exactly like the workspace's own scheduleX helpers bind to
   * their session's `s.data` instead of re-reading mutable state at write time.
   */
  const schedule = () => {
    const data = workspace.store.getState().data;
    if (disposed || !data) return;
    const paths = contextPaths(data.manifest);
    for (const path of paths) workspace.schedule(path, () => own(filesOf(data), path) ?? null);
    for (const path of written) if (!paths.includes(path)) workspace.schedule(path, null);
    written = new Set(paths);
  };

  const check = async () => {
    enabled = false;
    written = new Set();
    const storage = workspace.storage();
    // LAN guests may not write `context/` (403): only the host generates it.
    if (!storage || storage.label.startsWith(uiText("Rede local:"))) return;
    try {
      const existing = (await storage.list()).filter(isContextFile);
      if (disposed || workspace.storage() !== storage) return;
      written = new Set(existing);
      if (!existing.includes(ARCHITECTURE_PATH)) return;
      contextFiles = await loadGenerator();
      if (disposed || workspace.storage() !== storage) return;
      enabled = true;
      schedule();
    } catch {
      // unreadable storage: context stays off until "Gerar contexto para agentes"
    }
  };

  /** Generated context has no positions: only a change outside `diagrams`, or of a diagram's model/set, counts. */
  const meaningChanged = (next: WorkspaceData, prev: WorkspaceData | null) => {
    if (!prev) return true;
    for (const key of Object.keys(next) as (keyof WorkspaceData)[]) {
      if (key !== 'diagrams' && next[key] !== prev[key]) return true;
    }
    const slugs = Object.keys(next.diagrams);
    if (slugs.length !== Object.keys(prev.diagrams).length) return true;
    return slugs.some((slug) => next.diagrams[slug]?.model !== own(prev.diagrams, slug)?.model);
  };

  const unsubscribe = workspace.store.subscribe((state, prev) => {
    if (state.source !== prev.source) checking = check();
    else if (enabled && state.data && state.data !== prev.data && meaningChanged(state.data, prev.data)) schedule();
  });
  checking = check();

  return {
    async generate() {
      await checking;
      contextFiles = await loadGenerator();
      enabled = true;
      schedule();
      await workspace.flush();
      const data = workspace.store.getState().data;
      return data ? filesOf(data) : {};
    },
    enabled: () => enabled,
    ready: () => checking,
    dispose() {
      disposed = true;
      unsubscribe();
    },
  };
}
