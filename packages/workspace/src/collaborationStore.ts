import { refreshGeneratedContext } from './contextStorage';
import * as Y from 'yjs';
import { COLLAB_EXTERNAL, COLLAB_REPAIR, checkCollaborativeDiagramBounds, inspectCollaborativeDiagram, repairCollaborativeDiagram } from './collaboration';
import { assertCollaborationFilesFit, brokenDiagramText, importCollaborationFiles, parseCollaborationItem, projectedCollaborationFiles, readCollaborationFiles, seedCollaborationFiles } from './collaborationFiles';
import type { CollaborationItem } from './collaborationFiles';
import type { CollaborationRoomStore } from './collaborationRoom';
import { CollaborationRefusal } from './collaborationSanitize';
import type { CollaborativeRepair } from './collaborationSanitize';
import { MANIFEST_PATH, diagramPath, parseManifest } from './manifest';
import type { StorageAdapter } from './storage';

export interface PersistedCollaborationRoom {
  updates: Uint8Array[];
  baseline: Record<string, string | null>;
}

export interface CollaborationPersistence {
  load(room: string): Promise<PersistedCollaborationRoom | null>;
  append(room: string, update: Uint8Array): Promise<void>;
  replace(room: string, state: Uint8Array, baseline: Record<string, string | null>): Promise<void>;
  baseline(room: string, files: Record<string, string | null>): Promise<void>;
  /** Forgets a room whose item was deleted: a new item with the same slug starts from its own files. */
  drop?(room: string): Promise<void>;
}

const COMPACT_MIN = 1_000_000;

type ProjectableAdapter = StorageAdapter & { flush?: () => Promise<unknown> };

/**
 * The room's item was deleted (by a guest, the owner's app or `git rm`): every file it had is gone, or one is and the
 * manifest no longer lists the item. A missing file would otherwise read as an empty diagram (or text): merged into
 * the room, it empties it for every peer, and the projection recreates the files outside the manifest.
 */
async function deletedItem(adapter: StorageAdapter, item: CollaborationItem, baseline: Record<string, string | null>, disk: Record<string, string | null>): Promise<boolean> {
  const paths = Object.keys(disk);
  if (!paths.some((path) => disk[path] === null)) return false;
  if (paths.every((path) => disk[path] === null) && paths.some((path) => (baseline[path] ?? null) !== null)) return true;
  const text = await adapter.read(MANIFEST_PATH).catch(() => null);
  if (text === null) return false;
  try {
    const { manifest } = parseManifest(text);
    return !(item.kind === 'diagram' ? manifest.diagrams : manifest.docs).some((entry) => entry.slug === item.slug);
  } catch { return false; }
}

export function collaborationRoomName(scope: string, item: string): string {
  if (!parseCollaborationItem(item)) throw new Error('Sala inválida.');
  return JSON.stringify([scope, item]);
}

function parts(name: string) {
  const value: unknown = JSON.parse(name);
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || typeof value[1] !== 'string') throw new Error('Sala inválida.');
  const item = parseCollaborationItem(value[1]);
  if (!item) throw new Error('Sala inválida.');
  return { scope: value[0], item };
}

/** Keeps CRDT updates durable; file writes are grouped projections with conflict detection. */
export function createCollaborationStore(options: {
  persistence: CollaborationPersistence;
  adapter(scope: string): Promise<ProjectableAdapter>;
  onError?(room: string, error: unknown): void;
  onProjected?(room: string): void;
  /** The room's item was deleted: tell its peers (once); the room never writes its files again while they stay gone. */
  onGone?(room: string): void;
  /** Repairs the room's diagram needed (a merged parent cycle, a hostile peer): the first of each kind, once per room. */
  onRepair?(room: string, repairs: CollaborativeRepair[]): void;
  delayMs?: number;
  /** A steady stream of edits still projects at least this often (the debounce alone would wait for a pause). */
  maxWaitMs?: number;
}): CollaborationRoomStore {
  /** `base`: the doc's state when `baseline` was projected from it (unknown right after a load that still has to project). */
  /** `stored`: bytes persisted for the room since the last compaction; `live`: the doc's state size then. */
  type Entry = {
    doc: Y.Doc; baseline: Record<string, string | null>; base?: Uint8Array; timer?: ReturnType<typeof setTimeout>;
    projection?: Promise<void>; since?: number; stored: number; live: number;
    /** The item was deleted (see `deletedItem`): nothing is written until its files are back (an undone delete). */
    gone?: boolean;
  };
  const active = new Map<string, Entry>();
  const delay = options.delayMs ?? 1500;
  const maxWait = options.maxWaitMs ?? 5000;
  const reported = new Map<string, Set<string>>();
  /** `validate`'s read of its doc, for the `repair` the room runs right after on the same doc; any change drops it. */
  let inspected: { doc: Y.Doc; read: ReturnType<typeof inspectCollaborativeDiagram> } | null = null;
  const forget = () => {
    inspected?.doc.off('update', forget);
    inspected = null;
  };
  const report = (name: string) => (repairs: CollaborativeRepair[]) => {
    const seen = reported.get(name) ?? new Set<string>();
    reported.set(name, seen);
    const fresh: CollaborativeRepair[] = [];
    for (const repair of repairs) {
      if (seen.has(repair.kind)) continue;
      seen.add(repair.kind);
      fresh.push(repair);
    }
    if (fresh.length) options.onRepair?.(name, fresh);
  };

  /**
   * Merges a write made outside the session (baseline → disk) into the live doc, as `load` does: the edit is made on a
   * copy of the doc as it was when `baseline` was projected, so peers' edits made since survive (a text edit too), then
   * applied with origin `COLLAB_EXTERNAL` (the room sends it to every peer) and persisted. A file with errors or past
   * the caps throws: nothing is merged and the disk is left as is.
   */
  /**
   * Persisted updates keep what later edits overwrote (a merge of updates cannot collect it), so a room is compacted
   * from its live doc (garbage-collected) once what is stored passes 1 MB and 4× the live state, and on release.
   * The doc holds every update appended before this one (the room applies each right after persisting it), so the
   * compacted state plus `update` is everything.
   */
  const persist = async (name: string, update: Uint8Array): Promise<void> => {
    const entry = active.get(name);
    if (!entry) return options.persistence.append(name, update);
    entry.stored += update.length;
    if (entry.stored > COMPACT_MIN && entry.stored > 4 * entry.live) {
      const state = Y.encodeStateAsUpdate(entry.doc);
      entry.live = state.length;
      if (entry.stored > 4 * entry.live) {
        const merged = Y.mergeUpdates([state, update]);
        await options.persistence.replace(name, merged, entry.baseline);
        entry.stored = merged.length;
        return;
      }
    }
    await options.persistence.append(name, update);
  };
  const compact = async (name: string, entry: Entry): Promise<void> => {
    const state = Y.encodeStateAsUpdate(entry.doc);
    await options.persistence.replace(name, state, entry.baseline);
    entry.stored = entry.live = state.length;
  };

  const merge = async (name: string, entry: Entry, item: ReturnType<typeof parts>['item'], disk: Record<string, string | null>) => {
    const source = new Y.Doc();
    try {
      Y.applyUpdate(source, entry.base ?? Y.encodeStateAsUpdate(entry.doc));
      const before = Y.encodeStateVector(source);
      importCollaborationFiles(source, item, entry.baseline, disk);
      const delta = Y.encodeStateAsUpdate(source, before);
      Y.applyUpdate(entry.doc, delta, COLLAB_EXTERNAL);
      await persist(name, delta);
    } finally { source.destroy(); }
    if (item.kind !== 'diagram') return;
    const { update, repairs } = repairCollaborativeDiagram(entry.doc, COLLAB_EXTERNAL);
    if (repairs.length) report(name)(repairs);
    if (update) await persist(name, update);
  };

  const project = async (name: string): Promise<void> => {
    const entry = active.get(name);
    if (!entry) return;
    if (entry.projection) return entry.projection;
    const work = async () => {
      const { scope, item } = parts(name);
      const adapter = await options.adapter(scope);
      const disk = await readCollaborationFiles(adapter, item);
      if (await deletedItem(adapter, item, entry.baseline, disk)) {
        if (!entry.gone) options.onGone?.(name);
        entry.gone = true;
        return;
      }
      entry.gone = false;
      if (JSON.stringify(disk) !== JSON.stringify(entry.baseline)) await merge(name, entry, item, disk);
      const vector = Y.encodeStateVector(entry.doc);
      const files = projectedCollaborationFiles(entry.doc, item, report(name));
      const base = Y.encodeStateAsUpdate(entry.doc);
      for (const [path, text] of Object.entries(files)) if (disk[path] !== text) await adapter.write(path, text);
      await refreshGeneratedContext(adapter);
      await adapter.flush?.();
      entry.baseline = files;
      entry.base = base;
      await options.persistence.baseline(name, files);
      options.onProjected?.(name);
      const now = Y.encodeStateVector(entry.doc);
      if (now.length !== vector.length || now.some((byte, index) => byte !== vector[index])) schedule(name, 0);
    };
    entry.projection = work().finally(() => { entry.projection = undefined; });
    return entry.projection;
  };

  const schedule = (name: string, ms = delay) => {
    const entry = active.get(name);
    if (!entry) return;
    clearTimeout(entry.timer);
    // `since`: the first edit not projected yet; the debounce never pushes its projection past `maxWait`.
    const wait = entry.since === undefined ? ms : Math.max(0, Math.min(ms, entry.since + maxWait - Date.now()));
    entry.timer = setTimeout(() => {
      entry.since = undefined;
      void project(name).catch((error) => {
        options.onError?.(name, error);
        schedule(name, 10_000);
      });
    }, wait);
  };

  return {
    async load(name) {
      const { scope, item } = parts(name);
      const adapter = await options.adapter(scope);
      const disk = await readCollaborationFiles(adapter, item);
      assertCollaborationFilesFit(item, disk);
      // A diagram file with errors is backed up (once: same text, no write) and kept as is until an edit rewrites it,
      // as a single-user load does; the room keeps what it holds, or seeds what could be read.
      const broken = brokenDiagramText(item, disk);
      if (broken !== null) {
        const backup = `${diagramPath(item.slug)}.bak`;
        if (await adapter.read(backup) !== broken) await adapter.write(backup, broken);
      }
      const saved = await options.persistence.load(name);
      const doc = new Y.Doc();
      if (saved) for (const update of saved.updates) Y.applyUpdate(doc, update);
      else seedCollaborationFiles(doc, item, disk);
      if (saved && await deletedItem(adapter, item, saved.baseline, disk)) {
        // Deleted while the room was closed: it opens as it was (whoever joins is told) and writes nothing.
        const stored = saved.updates.reduce((sum, update) => sum + update.length, 0);
        active.set(name, { doc, baseline: saved.baseline, stored, live: Y.encodeStateAsUpdate(doc).length, gone: true });
        return doc;
      }
      let baseline = saved?.baseline ?? disk;
      if (broken !== null && JSON.stringify(disk) !== JSON.stringify(baseline)) {
        baseline = disk;
        await options.persistence.baseline(name, baseline);
      } else if (JSON.stringify(disk) !== JSON.stringify(baseline)) {
        if (JSON.stringify(disk) !== JSON.stringify(projectedCollaborationFiles(doc, item, report(name)))) {
          const vector = Y.encodeStateVector(doc);
          importCollaborationFiles(doc, item, baseline, disk);
          const delta = Y.encodeStateAsUpdate(doc, vector);
          await options.persistence.append(name, delta);
        }
        baseline = disk;
        await options.persistence.baseline(name, baseline);
      }
      const state = Y.encodeStateAsUpdate(doc);
      const stored = (saved?.updates ?? []).reduce((sum, update) => sum + update.length, 0);
      const entry: Entry = { doc, baseline, stored, live: state.length };
      active.set(name, entry);
      if (!saved || (stored > COMPACT_MIN && stored > 4 * state.length)) await compact(name, entry);
      if (broken !== null) return doc;
      if (JSON.stringify(projectedCollaborationFiles(doc, item, report(name))) !== JSON.stringify(disk)) schedule(name, 0);
      else entry.base = Y.encodeStateAsUpdate(doc);
      return doc;
    },
    append: persist,
    gone: (name) => active.get(name)?.gone === true,
    validate(name, doc) {
      const { item } = parts(name);
      forget();
      if (item.kind === 'diagram') checkCollaborativeDiagramBounds(doc);
      const read = item.kind === 'diagram' ? inspectCollaborativeDiagram(doc) : null;
      const files = projectedCollaborationFiles(doc, item, undefined, read);
      if (Object.values(files).some((text) => new TextEncoder().encode(text).length > 2_000_000)) throw new CollaborationRefusal('Arquivo grande demais para colaboração.');
      if (read) {
        inspected = { doc, read };
        doc.on('update', forget);
      }
    },
    repair(name, doc) {
      const { item } = parts(name);
      if (item.kind !== 'diagram') return null;
      // The room repairs right after validating the same candidate: its read is reused while the doc is unchanged.
      const cached = inspected?.doc === doc ? inspected.read : undefined;
      forget();
      const { update, repairs } = repairCollaborativeDiagram(doc, COLLAB_REPAIR, cached);
      if (repairs.length) report(name)(repairs);
      return update;
    },
    project(name) {
      const entry = active.get(name);
      if (entry) entry.since ??= Date.now();
      schedule(name);
    },
    async release(name) {
      const entry = active.get(name);
      if (!entry) return;
      // A projection in flight may miss what changed after it started: wait for it, then project the final state.
      await entry.projection?.catch(() => {});
      clearTimeout(entry.timer);
      await project(name);
      clearTimeout(entry.timer);
      if (entry.gone && options.persistence.drop) await options.persistence.drop(name);
      else await compact(name, entry);
      active.delete(name);
      reported.delete(name);
    },
  };
}
