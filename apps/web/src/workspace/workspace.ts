import { uiText } from '../i18n';
import { analyticsEdit, analyticsSave, analyticsWorkspaceChanged, analyticsEnabled } from '../analytics/client';
import { isWorkspaceLogo, normalizeFolder, uniqueSlug } from '@strukt/workspace';
import {
  SCHEMA_PATH, organizeWorkspace, BOARD_PATH, CONCERNS_PATH, parseManifest, reconcileBoard, EVIDENCE_PATH, ITEM_KINDS, ITEM_LIST, MANIFEST_PATH, SHARED_PATH, addItem, applyEntity, applyRelation, createFolder, createSaver, deleteFolder, diagramPath, docPath, emptyDiagram, emptyShared, followRelationIds, flowsPath, layoutPath, loadWorkspace, moveItem,
  printBoard, printConcerns, printEvidence, printFlows, printLayout, printManifest, printShared, removeComments, removeItem, removeVersions, restoreItem, renameFlowSteps, renameFolder, renameItem, sketchPath, workspaceFiles, writeFiles, LIBRARY_PATH, parseLibrary, printLibrary,
} from '@strukt/workspace';
import type { ItemSnapshot, Board, Concern, DiagramSnapshot, Evidence, FileContent, Flow, ItemKind, SaveStatus, Saver, StorageAdapter, WorkspaceData, WorkspaceLibrary } from '@strukt/workspace';
import { ASSISTANTS_PATH, checkAssistants, printAssistants } from '@strukt/workspace';
import { perspectivesPath, printPerspectives, renamePerspectiveNodes } from '@strukt/workspace';
import type { Level, Perspective } from '@strukt/workspace';
import type { Assistant } from '@strukt/workspace';
import { diffModels, own, readChatEdit, splitDiagram } from '@strukt/core';
import type { DiagramPart, DiagramOp } from '@strukt/core';
import { printDiagramJson, printDiagramJsonSchema } from '@strukt/json';
import { createStore } from 'zustand/vanilla';
import type { DiagramStore } from '../state/diagramStore';
import { COLLAB_WAITING_LOCK, VIEW_LOCK, switchLockedMessage } from '../state/locks';
import { shareWithPrevious } from './collabShare';
import { mergeManifests } from './manifestMerge';
import { evidenceFor } from './lookup';

/** What the main area shows. The diagram view edits `WorkspaceState.diagram` (the one in the diagram store). */
export type View = { kind: 'diagram' } | { kind: 'doc'; slug: string } | { kind: 'sketch'; slug: string } | { kind: 'board' };

export interface RemovedItem { kind: ItemKind; slug: string; title: string }

export interface WorkspaceState {
  data: WorkspaceData | null;
  /** Slug of the diagram loaded in the diagram store; `null` when the workspace has none. */
  diagram: string | null;
  view: View;
  source: { kind: StorageAdapter['kind']; label: string } | null;
  save: SaveStatus;
  saveError: string | null;
  /** Files that changed on disk outside the app (the watcher), until reload or dismissal. */
  external: { files: string[] } | null;
}

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;

/** `diagramStore.load` silently refuses while an AI draft locks it (`readOnly`); the workspace must not pretend the switch happened. */
const PREVIOUS_UNSAVED = uiText("Algumas mudanças do workspace anterior não puderam ser salvas.");
/** Storage whose diagrams and docs are edited through collaboration rooms (the remote adapters' labels). */
const SHARED = /^(GitHub:|Rede local:|Local network:|Joinlet Cloud$)/;

/**
 * One opened workspace: its in-memory data and the storage it saves to. Every queued write keeps
 * the session it was scheduled in, so a write still pending when `open()` swaps workspaces is
 * computed from (and sent to) the workspace that queued it, never the new one.
 */
interface Session {
  data: WorkspaceData;
  adapter: StorageAdapter;
}

/**
 * Flushes `saver` and disposes it, unsubscribing `stop`; disposal (and unsubscribing) always
 * happens, even if the flush rejects, so a broken write never leaves a saver still armed to write.
 */
export async function flushAndDispose(saver: Saver, stop: () => void): Promise<void> {
  try {
    await saver.flush();
  } finally {
    stop();
    saver.dispose();
  }
}

function createWorkspaceStore() {
  return createStore<WorkspaceState>()(() => ({
    data: null,
    diagram: null,
    view: { kind: 'board' },
    source: null,
    save: 'saved',
    saveError: null,
    external: null,
  }));
}

export type PreparedWorkspaceItem = { title: string; folder?: string } & ({ kind: 'diagram'; content: DiagramSnapshot } | { kind: 'doc' | 'sketch'; content: string });

export interface Workspace {
  store: WorkspaceStore;
  /**
   * Opens the workspace stored in `adapter`; an empty adapter is initialized with `init()`. Returns load
   * warnings, plus one when the previous workspace's pending writes could not be saved.
   */
  open(adapter: StorageAdapter, init: () => WorkspaceData, options?: { requireSaved?: boolean }): Promise<string[]>;
  openDiagram(slug: string): Promise<void>;
  show(view: View): Promise<void>;
  /** Creates an item (optional initial content) and opens it. Returns its slug. */
  create(kind: ItemKind, title: string, content?: DiagramSnapshot | string, folder?: string): Promise<string>;
  /** Validated partition: keeps the first part open, creates the rest, and returns a guarded undo. */
  splitDiagram(parts: DiagramPart[], signal: AbortSignal, guard?: () => boolean): Promise<{ slugs: string[]; undo: () => void }>;
  createItems(items: PreparedWorkspaceItem[], expected: WorkspaceData['manifest'], signal: AbortSignal, guard?: () => boolean): Promise<{ created: RemovedItem[]; undo: () => void }>;
  organize(ops: import('@strukt/core').WorkspaceOp[], expected: WorkspaceData['manifest']): () => void;
  rename(kind: ItemKind, slug: string, title: string): void;
  /** Sidebar folders (a path kept on the manifest; item files do not move). `null` = the root. */
  moveItem(kind: ItemKind, slug: string, folder: string | null): void;
  createFolder(kind: ItemKind, path: string): void;
  renameFolder(kind: ItemKind, from: string, to: string): void;
  deleteFolder(kind: ItemKind, path: string): void;
  remove(kind: ItemKind, slug: string): Promise<void>;
  /** Puts a deleted item (snapshot from `snapshotItem`) back where it was and opens it; rejects when its slug is taken again. */
  restore(snapshot: ItemSnapshot): Promise<void>;
  setName(name: string): void;
  setDetails(details: { name: string; description: string; logo: string | null }): void;
  setLibrary(library: WorkspaceLibrary): void;
  /** Replaces the saved chat assistants (`assistants.json`); rejects with the pt-BR reason when the list is invalid or the session is read-only. */
  setAssistants(assistants: Assistant[]): Promise<void>;
  setDoc(slug: string, text: string): void;
  setCollaborativeItem(kind: 'diagram' | 'doc', slug: string | null): void;
  /** Every mounted shared doc saves through its room, including the inactive split pane. */
  registerCollaborativeDoc(slug: string): () => void;
  /**
   * Shared sessions: another guest saved the manifest (or a save merged theirs into ours). Three-way merges `theirs`
   * into the list this guest holds (`base` is the text this guest last saw), loads the files of the items it brings
   * and drops the ones it removes; the open item leaves cleanly (another diagram loaded, the Overview in view). It writes
   * nothing: those files belong to the host. Returns what disappeared, for the app to say so.
   */
  applyRemoteManifest(update: { base: string | null; theirs: string }): Promise<{ removed: RemovedItem[] }>;
  /**
   * Whether a change the diagram store just announced is an edit of `slug`'s own room: false while the workspace itself
   * is writing the store (a load for a switch, create, remove, restore or another workspace) or when `slug` is no longer
   * the open diagram. The collaboration bridge pushes deltas to a room only when this holds, never the content of another diagram.
   */
  isLocalEdit(slug: string): boolean;
  applyCollaborativeDiagram(slug: string, snapshot: DiagramSnapshot): void;
  applyCollaborativeDoc(slug: string, text: string): void;
  setSketch(slug: string, text: string): void;
  setFlows(slug: string, flows: Flow[]): void;
  /** The diagram's saved perspectives (`diagrams/<slug>.perspectives.json`); a reading view, never the model. */
  setPerspectives(slug: string, perspectives: Perspective[]): void;
  /** C4 levels (`nivel:*` tags of the shared entities) in one step; an unshared element is shared to carry its level. */
  setLevels(slug: string, levels: Readonly<Record<string, Level | null>>): Promise<void>;
  setEvidence(slug: string, id: string, refs: Evidence[]): void;
  linkEntity(slug: string, localId: string, entityId: string | null): void;
  linkRelation(slug: string, edgeId: string, relationId: string | null): void;
  setEntityTags(entityId: string, tags: string[]): void;
  setRelationDetails(relationId: string, set: { tech?: string; description?: string }): void;
  setConcerns(concerns: Concern[]): void;
  updateBoard(update: (board: Board) => Board): void;
  /**
   * Runs before the view changes; `reload` is true when the diagram store is about to load another
   * diagram (flush the code editor always; discard an AI draft only on reload).
   */
  onBeforeSwitch(hook: (reload: boolean) => void | Promise<void>): () => void;
  prepareSwitch(): Promise<void>;
  /**
   * `create` drops the leftover versions of a slug that is not in the manifest (orphans of a deleted diagram).
   * A guard returning true for a slug keeps them (a delete still inside its undo window).
   */
  keepVersionsWhile(guard: (slug: string) => boolean): () => void;
  flush(): Promise<void>;
  retrySave(): Promise<void>;
  /**
   * Writes every file of the current workspace again, even text the saver believes is already on disk:
   * repairs the storage after something else wrote into it (a failed zip import).
   */
  rewriteAll(): Promise<void>;
  hasUnsaved(): boolean;
  /** Every file of the current workspace, as it goes to disk (zip export, copy to a folder). */
  files(): Record<string, string>;
  /** Storage of the open workspace: versions (M5) are read and written there directly. */
  storage(): StorageAdapter | null;
  /** Queues another file under `.arch/` (the generated `context/`) through the same debounced autosave. */
  schedule(path: string, content: FileContent): void;
  /** Something else wrote into `.arch/`: shows the "changed on disk" notice. */
  setExternal(files: string[]): void;
  dismissExternal(): void;
  /**
   * Re-reads the open workspace from disk, keeping the current view when its item still exists.
   * Pending writes are dropped first: they are stale and would overwrite what is on disk now.
   */
  reload(): Promise<string[]>;
  close(): Promise<void>;
}

/**
 * Glue between the workspace files and the editor: keeps every item in memory, mirrors the diagram
 * store into the current diagram and autosaves each changed file through a debounced `Saver`.
 * Switching diagrams reloads the diagram store, so undo history is per visit (it resets on switch).
 */
export function createWorkspace(diagram: DiagramStore, options: { saveDelay?: number; navigation?: { read(adapter: StorageAdapter): import('./navigation').NavigationState | null; write(adapter: StorageAdapter, state: WorkspaceState): void } } = {}): Workspace {
  const store = createWorkspaceStore();
  const hooks = new Set<(reload: boolean) => void | Promise<void>>();
  const versionGuards = new Set<(slug: string) => boolean>();
  let session: Session | null = null;
  let saver: Saver | null = null;
  let stopSaver = () => {};
  let stopMirror = () => {};
  let loading = false;
  let collaborativeDiagram: string | null = null;
  let collaborativeDoc: string | null = null;
  const collaborativeDocs = new Map<string, number>();
  /** Serializes `open()` calls: an interleaved second open must not tear down the first's mirror mid-swap. */
  let openChain: Promise<unknown> = Promise.resolve();

  store.subscribe((state, previous) => {
    if (session && state.data === session.data && (state.view !== previous.view || state.diagram !== previous.diagram || state.source !== previous.source)) options.navigation?.write(session.adapter, state);
  });

  const data = () => {
    const current = store.getState().data;
    if (!current) throw new Error(uiText("Nenhum workspace aberto."));
    return current;
  };
  const setData = (next: WorkspaceData) => {
    if (session) session.data = next;
    store.setState({ data: next });
  };

  const snapshotOf = (slug: string) => {
    const current = store.getState().data;
    return current ? own(current.diagrams, slug) : undefined;
  };
  /**
   * Content is printed when the write happens and the saver skips text already on disk (seeded with
   * the canonical print at load), so a `.strukt.json` is only rewritten when the diagram's meaning
   * changed: moving nodes rewrites the sidecar. Each closure reads the session current when it was
   * scheduled (see `Session`).
   */
  const scheduleDiagram = (slug: string, parts: { json: boolean; layout: boolean } = { json: true, layout: true }) => {
    if (slug === collaborativeDiagram) return;
    const s = session;
    if (!s || !saver) return;
    if (parts.json) {
      saver.schedule(diagramPath(slug), () => {
        const snapshot = own(s.data.diagrams, slug);
        return snapshot ? printDiagramJson(snapshot.model) : null;
      });
    }
    if (parts.layout) {
      saver.schedule(layoutPath(slug), () => {
        const snapshot = own(s.data.diagrams, slug);
        return snapshot ? printLayout(snapshot.model, snapshot.layout) : null;
      });
    }
  };
  const scheduleItem = (kind: ItemKind, slug: string) => {
    if (kind === 'diagram') return scheduleDiagram(slug);
    if (kind === 'doc' && (slug === collaborativeDoc || collaborativeDocs.has(slug))) return;
    const s = session;
    if (!s || !saver) return;
    saver.schedule(kind === 'doc' ? docPath(slug) : sketchPath(slug), () => own(kind === 'doc' ? s.data.docs : s.data.sketches, slug) ?? null);
  };
  const scheduleManifest = () => {
    const s = session;
    if (!s || !saver) return;
    saver.schedule(MANIFEST_PATH, () => printManifest(s.data.manifest));
  };
  const scheduleLibrary = () => {
    const s = session;
    if (!s || !saver) return;
    saver.schedule(LIBRARY_PATH, () => s.data.library && (s.data.library.components.length || s.data.library.templates.length) ? printLibrary(s.data.library) : null);
  };
  const scheduleAssistants = () => {
    const s = session;
    if (!s || !saver) return;
    saver.schedule(ASSISTANTS_PATH, () => s.data.assistants?.length ? printAssistants(s.data.assistants) : null);
  };
  const scheduleFlows = (slug: string) => {
    const s = session;
    if (!s || !saver) return;
    saver.schedule(flowsPath(slug), () => {
      const flows = own(s.data.flows ?? {}, slug);
      return flows?.length ? printFlows(flows) : null;
    });
  };
  const schedulePerspectives = (slug: string) => {
    const s = session;
    if (!s || !saver) return;
    saver.schedule(perspectivesPath(slug), () => {
      const perspectives = own(s.data.perspectives ?? {}, slug);
      return perspectives?.length ? printPerspectives(perspectives) : null;
    });
  };
  const scheduleEvidence = () => {
    const s = session;
    if (!s || !saver) return;
    saver.schedule(EVIDENCE_PATH, () => s.data.evidence && Object.keys(s.data.evidence).length ? printEvidence(s.data.evidence) : null);
  };
  const scheduleConcerns = () => {
    const s = session;
    if (!s || !saver) return;
    saver.schedule(CONCERNS_PATH, () => s.data.concerns?.length ? printConcerns(s.data.concerns) : null);
  };
  const scheduleShared = () => {
    const s = session;
    if (!s || !saver) return;
    saver.schedule(SHARED_PATH, () => s.data.shared && Object.keys(s.data.shared.entities).length ? printShared(s.data.shared) : null);
  };
  const scheduleBoard = () => {
    const s = session;
    if (!s || !saver) return;
    saver.schedule(BOARD_PATH, () => printBoard(s.data.board));
  };

  /** The lock that refuses a switch; the collaboration's wait for its room never does (a load replaces it). */
  const switchLock = () => {
    const reason = diagram.getState().readOnly;
    return reason === COLLAB_WAITING_LOCK || reason === VIEW_LOCK ? null : reason;
  };

  /**
   * Throws instead of loading while an AI draft locks the diagram store; never mutates `store`. `room`: in a shared
   * session, the slug whose room now owns the diagram (null for none): it is never saved through the adapter, and it
   * stays locked until the collaboration bridge applies the room's state (an edit made before would miss the room).
   */
  const loadSnapshot = (snapshot: DiagramSnapshot, room?: string | null) => {
    const lock = switchLock();
    if (lock) throw new Error(switchLockedMessage(lock));
    if (diagram.getState().readOnly === COLLAB_WAITING_LOCK) diagram.getState().setReadOnly(null);
    loading = true;
    try {
      diagram.getState().load(snapshot);
    } finally {
      loading = false;
    }
    // Defense in depth: `load` above is the only thing that can refuse, but never claim the switch
    // happened unless the store actually holds the new snapshot.
    if (diagram.getState().model !== snapshot.model) throw new Error(switchLockedMessage(diagram.getState().readOnly));
    if (room === undefined) return;
    collaborativeDiagram = room;
    if (room) diagram.getState().setReadOnly(COLLAB_WAITING_LOCK);
  };

  /** `loadSnapshot` for a workspace slug (or the empty diagram), setting `store.diagram` once it sticks. */
  const load = (slug: string | null) => {
    loadSnapshot((slug && snapshotOf(slug)) || emptyDiagram(), session && SHARED.test(session.adapter.label) ? slug : undefined);
    store.setState({ diagram: slug });
  };

  const beforeSwitch = async (reload: boolean) => {
    for (const hook of [...hooks]) await hook(reload);
  };

  const mirror = () =>
    diagram.subscribe((state, prev) => {
      if (loading) return;
      const modelChanged = state.model !== prev.model;
      // `layout.edges` is the router cache (never persisted): a routes-only pass changes the layout
      // object but not `nodes`, and must not flicker the save indicator or copy stale data around.
      // While a gesture is pending, `moveLive` frames are not mirrored (no per-frame copy of the workspace
      // data); the gesture end persists the positions against the layout the gesture started from.
      if (state.pending && !modelChanged) return;
      const layoutBase = prev.pending && !state.pending ? prev.pending.layout : prev.layout;
      const nodesChanged = state.layout.nodes !== layoutBase.nodes;
      if (!modelChanged && !nodesChanged) return;
      const { data: current, diagram: slug } = store.getState();
      if (!current || !slug || !own(current.diagrams, slug)) return;
      let flows = current.flows;
      let perspectives = current.perspectives;
      let evidence = current.evidence;
      let concerns = current.concerns;
      let shared = current.shared;
      const diagrams = { ...current.diagrams, [slug]: { model: state.model, layout: state.layout } };
      // At most one `diffModels` per commit, and none unless an id vanished (only a rename/removal can).
      let renameOps: Extract<ReturnType<typeof diffModels>[number], { op: 'rename' }>[] | undefined;
      const renamesOf = () => {
        if (!renameOps) {
          const idsKept = prev.model.order.every((id) => own(state.model.elements, id));
          renameOps = idsKept ? [] : diffModels(prev.model, state.model).filter((op): op is Extract<typeof op, { op: 'rename' }> => op.op === 'rename');
        }
        return renameOps;
      };
      if (modelChanged && flows && own(flows, slug)?.length) {
        const renames = renamesOf();
        if (renames.length) {
          let updated = own(flows, slug)!;
          for (const rename of renames) updated = renameFlowSteps(updated, rename.id, rename.to);
          flows = { ...flows, [slug]: updated };
          scheduleFlows(slug);
        }
      }
      if (modelChanged && perspectives && own(perspectives, slug)?.length) {
        const renames = renamesOf();
        if (renames.length) {
          let updated = own(perspectives, slug)!;
          for (const rename of renames) updated = renamePerspectiveNodes(updated, rename.id, rename.to);
          perspectives = { ...perspectives, [slug]: updated };
          schedulePerspectives(slug);
        }
      }
      if (modelChanged && evidence && own(evidence, slug)) {
        const renames = renamesOf();
        if (renames.length) {
          const refs = { ...own(evidence, slug) };
          for (const rename of renames) if (Object.hasOwn(refs, rename.id)) { refs[rename.to] = refs[rename.id]!; delete refs[rename.id]; }
          evidence = { ...evidence, [slug]: refs };
          scheduleEvidence();
        }
      }
      if (modelChanged && concerns?.some((item) => item.diagram === slug && item.element)) {
        const renames = renamesOf();
        if (renames.length) {
          concerns = concerns.map((item) => {
            if (item.diagram !== slug || !item.element) return item;
            const rename = renames.find((op) => op.id === item.element);
            return rename ? { ...item, element: rename.to } : item;
          });
          scheduleConcerns();
        }
      }
      if (modelChanged && shared && own(shared.views, slug)) {
        const mapping = { ...own(shared.views, slug) };
        const renames = renamesOf();
        for (const rename of renames) if (Object.hasOwn(mapping, rename.id)) { mapping[rename.to] = mapping[rename.id]!; delete mapping[rename.id]; }
        const entities = { ...shared.entities };
        for (const [local, entityId] of Object.entries(mapping)) {
          const el = own(state.model.elements, local);
          const old = own(prev.model.elements, local) ?? own(prev.model.elements, renames.find((op) => op.to === local)?.id ?? '');
          if (!el || !old || !own(entities, entityId)) continue;
          if (el.label === old.label && el.tech === old.tech && el.description === old.description) continue;
          const entity = { ...entities[entityId]!, label: el.label, tech: el.tech, description: el.description };
          entities[entityId] = entity;
          for (const [viewSlug, view] of Object.entries(shared.views)) for (const [other, ref] of Object.entries(view)) {
            if (ref !== entityId || viewSlug === slug) continue;
            const snapshot = own(diagrams, viewSlug);
            if (!snapshot) continue;
            diagrams[viewSlug] = { ...snapshot, model: applyEntity(snapshot.model, other, entity) };
            scheduleDiagram(viewSlug, { json: true, layout: false });
          }
        }
        shared = { ...shared, entities, views: { ...shared.views, [slug]: mapping } };
        scheduleShared();
      }
      if (modelChanged && shared?.viewRelations?.[slug]) {
        const renames = new Map(renamesOf().map((op) => [op.id, op.to]));
        const mapping = followRelationIds(prev.model, state.model, shared.viewRelations[slug], renames);
        const relations = { ...shared.relations };
        for (const [edgeId, relationId] of Object.entries(mapping)) {
          const edge = state.model.edges.find((item) => item.id === edgeId);
          const previousId = Object.entries(shared.viewRelations[slug]).find(([, id]) => id === relationId)?.[0];
          const old = prev.model.edges.find((item) => item.id === previousId);
          const relation = relations[relationId];
          if (!edge || !old || !relation || edge.label === old.label && edge.connector === old.connector) continue;
          const updated = { ...relation, connector: edge.connector, ...(edge.label ? { label: edge.label } : {}) };
          if (!edge.label) delete updated.label;
          relations[relationId] = updated;
          for (const [viewSlug, view] of Object.entries(shared.viewRelations)) for (const [other, ref] of Object.entries(view)) {
            if (ref !== relationId || viewSlug === slug) continue;
            const snapshot = own(diagrams, viewSlug);
            if (!snapshot) continue;
            diagrams[viewSlug] = { ...snapshot, model: applyRelation(snapshot.model, other, updated) };
            scheduleDiagram(viewSlug, { json: true, layout: false });
          }
        }
        shared = { ...shared, relations, viewRelations: { ...shared.viewRelations, [slug]: mapping } };
        scheduleShared();
      }
      setData({ ...current, flows, perspectives, evidence, concerns, shared, diagrams });
      scheduleDiagram(slug, { json: modelChanged, layout: nodesChanged });
    });

  const openDiagram = async (slug: string) => {
    if (!snapshotOf(slug)) return;
    if (store.getState().diagram !== slug) {
      await beforeSwitch(true);
      load(slug);
    } else if (store.getState().view.kind !== 'diagram') {
      await beforeSwitch(false);
    }
    store.setState({ view: { kind: 'diagram' } });
  };

  const close = async () => {
    stopMirror();
    stopMirror = () => {};
    if (saver) {
      const current = saver;
      const stop = stopSaver;
      saver = null;
      stopSaver = () => {};
      await flushAndDispose(current, stop);
    }
  };

  const show = async (view: View) => {
    if (view.kind === 'diagram') {
      const slug = store.getState().diagram;
      if (slug) await openDiagram(slug);
      return;
    }
    await beforeSwitch(false);
    store.setState({ view });
  };

  const api: Workspace = {
    store,

    async prepareSwitch() {
      await beforeSwitch(true);
      await saver?.flush();
      if (saver?.hasPending()) throw new Error(uiText("Não foi possível salvar o workspace atual. Tente salvar novamente antes de trocar de projeto."));
      if (switchLock()) throw new Error(switchLockedMessage(switchLock()));
    },

    open(adapter, init, openOptions = {}) {
      // Everything that can fail while preparing the NEW adapter (read/init/write) runs first; the
      // OLD workspace's mirror and saver are touched only once the new first diagram has actually
      // loaded. Chained on `openChain` so two interleaved `open()` calls can't race and leak a
      // mirror subscription.
      const attempt = openChain.then(async () => {
        const loaded = await loadWorkspace(adapter);
        const opened = loaded?.data ?? init();
        const schema = printDiagramJsonSchema();
        const diskSchema = loaded && !SHARED.test(adapter.label) ? await adapter.read(SCHEMA_PATH) : schema;
        if (!loaded) await writeFiles(adapter, workspaceFiles(opened));
        await beforeSwitch(true);
        if (openOptions.requireSaved && saver) {
          await saver.flush();
          if (saver.hasPending()) throw new Error(uiText("Não foi possível salvar o workspace atual. Tente salvar novamente antes de trocar de projeto."));
        }
        // Re-checked after the last `await`: a lock already in place, or one a hook just engaged
        // during `beforeSwitch`, must not let the workspace pretend it switched — the old mirror,
        // saver and every store field stay exactly as they were.
        if (switchLock()) throw new Error(switchLockedMessage(switchLock()));

        const remembered = options.navigation?.read(adapter);
        const first = remembered?.diagram && own(opened.diagrams, remembered.diagram) ? remembered.diagram : opened.manifest.diagrams[0]?.slug ?? null;
        const wanted = remembered?.view;
        const restoredView: View = wanted?.kind === 'board' ? wanted
          : wanted?.kind === 'doc' && own(opened.docs, wanted.slug) !== undefined ? wanted
          : wanted?.kind === 'sketch' && own(opened.sketches, wanted.slug) !== undefined ? wanted
          : first ? {kind:'diagram'} : {kind:'board'};
        const shared = SHARED.test(adapter.label);
        const snapshot = (first && own(opened.diagrams, first)) || emptyDiagram();

        // No `await` from stopping the old mirror until the new saver and mirror are live: a
        // synchronous load failure re-subscribes the old mirror and rethrows, so the old workspace
        // keeps working exactly as before; past the load, edits are never left unmirrored or unsaved.
        stopMirror();
        stopMirror = () => {};
        try {
          loadSnapshot(snapshot, shared ? first : undefined);
        } catch (err) {
          stopMirror = mirror();
          throw err;
        }

        const previous = saver ? { saver, stop: stopSaver, adapter: session?.adapter } : null;
        saver = null;
        stopSaver = () => {};
        previous?.stop(); // the old saver's status must not overwrite the new workspace's indicator
        session = { data: opened, adapter };
        collaborativeDiagram = shared ? first : null;
        collaborativeDoc = null;
        collaborativeDocs.clear();
        store.setState({
          data: opened,
          diagram: first,
          view: restoredView,
          source: { kind: adapter.kind, label: adapter.label },
          save: 'saved',
          saveError: null,
          external: null,
        });
        const next = createSaver(adapter, { delay: options.saveDelay, onSettled: status => { if (saver === next && adapter.kind !== 'memory') analyticsSave(status); } });
        next.seed({ ...workspaceFiles(opened), [SCHEMA_PATH]: diskSchema ?? schema });
        saver = next;
        analyticsWorkspaceChanged();
        stopSaver = next.subscribe(() => store.setState({ save: next.status, saveError: next.error }));
        if (diskSchema !== null && diskSchema !== schema) next.schedule(SCHEMA_PATH, schema);
        stopMirror = mirror();

        // Only now settle the old saver: its queued writes are bound to the old session, so they
        // land in the old storage with the old workspace's content.
        const warnings = [...(loaded?.warnings ?? [])];
        if (previous) {
          if (previous.adapter === adapter) {
            // Same backend whose files were just replaced on purpose (importZip): never write the old workspace back.
            previous.saver.dispose();
          } else {
            await flushAndDispose(previous.saver, () => {});
            if (previous.saver.hasPending()) warnings.push(PREVIOUS_UNSAVED);
          }
        }
        return warnings;
      });
      openChain = attempt.catch(() => {});
      return attempt;
    },

    openDiagram,
    show,

    async splitDiagram(parts, signal, guard = () => true) {
      if (!readChatEdit({ kind: 'split_diagram', summary: uiText("Divisão"), parts })) throw new Error(uiText("Divisão inválida."));
      const before = data();
      const state = diagram.getState();
      const current = store.getState();
      const slug = current.diagram;
      const owner = session;
      if (!owner || !slug || current.view.kind !== 'diagram' || state.readOnly || state.pending) throw new Error(uiText("Abra um diagrama editável para dividir."));
      const snapshots = splitDiagram(state.model, state.layout, parts);
      const files = await owner.adapter.list();
      const occupied = (id: string) => files.some(path => path.startsWith(`diagrams/${id}.`) || path.startsWith(`versions/${id}/`) || path === `comments/diagram-${id}.json`);
      const folder = before.manifest.diagrams.find(item => item.slug === slug)?.folder;
      let next = renameItem(before, 'diagram', slug, parts[0]!.title);
      const slugs = [slug];
      for (const part of snapshots.slice(1)) {
        // A stale file on disk or a deletion inside its undo window must never be overwritten.
        let title = part.title;
        let added = addItem(next, 'diagram', title, part);
        while ([...versionGuards].some(g => g(added.slug)) || occupied(added.slug) || await owner.adapter.read(diagramPath(added.slug)) !== null) {
          signal.throwIfAborted();
          title = `${part.title} ${crypto.randomUUID().slice(0, 8)}`;
          added = addItem(next, 'diagram', title, part);
        }
        next = renameItem(added.data, 'diagram', added.slug, part.title);
        if (folder) next = { ...next, manifest: moveItem(next.manifest, 'diagram', added.slug, folder) };
        if (before.evidence?.[slug]) next = { ...next, evidence: { ...next.evidence, [added.slug]: Object.fromEntries(Object.entries(before.evidence[slug]!).filter(([id]) => own(part.model.elements, id))) } };
        if (before.shared) {
          const shared = next.shared!;
          const views = { ...shared.views, [added.slug]: Object.fromEntries(Object.entries(before.shared.views[slug] ?? {}).filter(([id]) => own(part.model.elements, id))) };
          const edgeIds = new Set(part.model.edges.map(edge => edge.id));
          next = { ...next, shared: { ...shared, views, ...(shared.viewRelations ? { viewRelations: { ...shared.viewRelations, [added.slug]: Object.fromEntries(Object.entries(before.shared.viewRelations?.[slug] ?? {}).filter(([id]) => edgeIds.has(id))) } } : {}) } };
        }
        slugs.push(added.slug);
      }
      signal.throwIfAborted();
      if (!guard() || session !== owner || data() !== before || store.getState().diagram !== slug || store.getState().view.kind !== 'diagram' || diagram.getState().model !== state.model || diagram.getState().layout.nodes !== state.layout.nodes || diagram.getState().readOnly || diagram.getState().pending) throw new Error(uiText("O workspace mudou durante a resposta. Peça a divisão novamente."));
      const kept = new Set(snapshots[0]!.model.order);
      const ops: DiagramOp[] = state.model.order.filter(id => !state.model.elements[id]!.parentId && !kept.has(id)).map(id => ({ op: 'remove', id }));
      // Nothing below awaits: preparation and validation finish before the first mutation.
      setData(next);
      if (!diagram.getState().apply(ops)) { setData(before); throw new Error(diagram.getState().lastError ?? uiText("Não foi possível dividir o diagrama.")); }
      const applied = data();
      const appliedState = diagram.getState();
      const schedule = () => {
        for (const id of slugs) scheduleDiagram(id);
        scheduleManifest(); scheduleBoard(); scheduleEvidence(); scheduleShared();
      };
      schedule();
      return { slugs, undo: () => {
        if (session !== owner || data() !== applied || store.getState().diagram !== slug || diagram.getState().model !== appliedState.model || diagram.getState().layout.nodes !== appliedState.layout.nodes || diagram.getState().readOnly || diagram.getState().pending || diagram.getState().past.at(-1)?.model !== state.model) throw new Error(uiText("Há alterações posteriores no workspace. Os diagramas foram preservados."));
        diagram.getState().undo();
        setData(before);
        schedule();
      } };
    },

    async create(kind, title, content, folder) {
      const name = title.trim() || uiText("Sem título");
      if (kind === 'diagram' && session) {
        // The manifest is the source of truth: `addItem` picked a slug it does not list, so any
        // `versions/<slug>` on disk is an orphan of a deleted diagram (closed/reloaded inside the undo
        // window) and must not be inherited by the new one. Best effort: a failure leaves them, as before.
        const wanted = addItem(data(), kind, name, content).slug;
        // Not orphans: a delete still inside its undo window, or a diagram another writer (an agent through the
        // MCP) created on disk after this manifest was read.
        const inUndoWindow = [...versionGuards].some((guard) => guard(wanted));
        const onDisk = !inUndoWindow && (await session.adapter.read(diagramPath(wanted)).catch(() => null)) !== null;
        if (!inUndoWindow && !onDisk) {
          await removeVersions(session.adapter, wanted).catch(() => 0);
          await removeComments(session.adapter, 'diagram', wanted).catch(() => {});
        }
      }
      const { data: added, slug } = addItem(data(), kind, name, content);
      const next = folder ? { ...added, manifest: moveItem(added.manifest, kind, slug, folder) } : added;
      setData(next);
      scheduleItem(kind, slug);
      if (kind === 'diagram') scheduleFlows(slug);
      if (kind === 'diagram') schedulePerspectives(slug);
      if (kind === 'diagram') scheduleEvidence();
      if (kind === 'diagram') scheduleConcerns();
      if (kind === 'diagram') scheduleShared();
      scheduleManifest();
      scheduleBoard();
      if (session && SHARED.test(session.adapter.label)) {
        await saver?.flush();
        if (saver?.hasPending()) throw new Error(uiText("Salve o novo item antes de iniciar a colaboração."));
      }
      if (kind === 'diagram') await openDiagram(slug);
      else await show({ kind, slug });
      // Creating an empty item alone is not activation.
      return slug;
    },

    async createItems(items, expected, signal, guard = () => true) {
      const before = data(), owner = session;
      const valid = () => !!owner && session === owner && data() === before && before.manifest === expected && !diagram.getState().readOnly && !diagram.getState().pending && !signal.aborted && guard();
      if (!valid()) throw new Error(uiText("O workspace mudou ou está em modo somente leitura. Peça a criação novamente."));
      if (!items.length || items.length > 8 || items.some(item => !item.title.trim() || item.title.length > 120 || item.folder && !normalizeFolder(item.folder))) throw new Error(uiText("Criação inválida: use até oito itens com título e pasta válidos."));
      const files = await owner!.adapter.list();
      let next = before;
      const created: RemovedItem[] = [];
      for (const item of items) {
        signal.throwIfAborted();
        const key = ITEM_LIST[item.kind];
        const taken = new Set(next.manifest[key].map(entry => entry.slug));
        for (const path of files) {
          const match = new RegExp(`^${key}/([^/.]+)[.]`).exec(path);
          if (match) taken.add(match[1]!);
          if (item.kind === 'diagram') {
            const extra = /^(?:versions\/([^/]+)\/|comments\/diagram-([^/]+)[.]json$)/.exec(path);
            if (extra) taken.add((extra[1] ?? extra[2])!);
          }
        }
        let slug = uniqueSlug(item.title, taken);
        const pathOf = item.kind === 'diagram' ? diagramPath : item.kind === 'doc' ? docPath : sketchPath;
        while ((item.kind === 'diagram' && [...versionGuards].some(g => g(slug))) || await owner!.adapter.read(pathOf(slug)) !== null) {
          signal.throwIfAborted(); taken.add(slug); slug = uniqueSlug(item.title, taken);
        }
        const added = addItem(next, item.kind, slug, item.content);
        next = renameItem(added.data, item.kind, added.slug, item.title.trim());
        if (item.folder) next = { ...next, manifest: moveItem(next.manifest, item.kind, added.slug, item.folder) };
        created.push({ kind: item.kind, slug: added.slug, title: item.title.trim() });
      }
      if (!valid()) throw new Error(uiText("O workspace mudou durante a preparação. Nenhum item foi criado."));
      const applied = { ...next, board: reconcileBoard(next.board, next.manifest) };
      const fingerprint = (current: WorkspaceData, item: RemovedItem) => {
        if (item.kind === 'doc') return own(current.docs, item.slug);
        if (item.kind === 'sketch') return own(current.sketches, item.slug);
        const snapshot = own(current.diagrams, item.slug);
        return snapshot ? printDiagramJson(snapshot.model) + printLayout(snapshot.model, snapshot.layout) : undefined;
      };
      const original = created.map(item => fingerprint(applied, item));
      const schedule = () => { for (const item of created) scheduleItem(item.kind, item.slug); scheduleManifest(); scheduleBoard(); };
      // Every item and slug is prepared before this single synchronous commit.
      setData(applied); schedule();
      return { created, undo: () => {
        const current = data();
        if (session !== owner || current.manifest !== applied.manifest || current.board !== applied.board || diagram.getState().readOnly || diagram.getState().pending || created.some((item, i) => fingerprint(current, item) !== original[i])) throw new Error(uiText("Há alterações posteriores nos itens criados. O workspace foi preservado."));
        if (created.some(item => item.kind === 'diagram' && item.slug === collaborativeDiagram || item.kind === 'doc' && (item.slug === collaborativeDoc || collaborativeDocs.has(item.slug)))) throw new Error(uiText("Feche o item compartilhado antes de desfazer sua criação."));
        const state = store.getState();
        let restored = current;
        for (const item of created) restored = removeItem(restored, item.kind, item.slug);
        const openCreatedDiagram = created.some(item => item.kind === 'diagram' && item.slug === state.diagram);
        if (openCreatedDiagram) load(before.manifest.diagrams[0]?.slug ?? null);
        const viewingCreated = state.view.kind === 'diagram' ? openCreatedDiagram : state.view.kind !== 'board' && created.some(item => item.kind === state.view.kind && 'slug' in state.view && item.slug === state.view.slug);
        if (viewingCreated) store.setState({ view: { kind: 'board' } });
        setData({ ...restored, manifest: before.manifest, board: before.board }); schedule();
      } };
    },

    organize(ops, expected) {
      const before = data(), owner = session;
      if (!owner || before.manifest !== expected || diagram.getState().readOnly) throw new Error(uiText("O workspace mudou ou está em modo somente leitura. Peça a organização novamente."));
      const manifest = organizeWorkspace(before.manifest, ops);
      const board = reconcileBoard(before.board, manifest);
      setData({ ...before, manifest, board }); scheduleManifest(); scheduleBoard();
      return () => {
        const current = data();
        if (session !== owner || current.manifest !== manifest || current.board !== board || diagram.getState().readOnly) throw new Error(uiText("Há alterações posteriores na organização. O workspace foi preservado."));
        setData({ ...current, manifest: before.manifest, board: before.board }); scheduleManifest(); scheduleBoard();
      };
    },

    rename(kind, slug, title) {
      const name = title.trim();
      if (!name) return;
      setData(renameItem(data(), kind, slug, name));
      scheduleManifest();
    },

    moveItem(kind, slug, folder) {
      setData({ ...data(), manifest: moveItem(data().manifest, kind, slug, folder) });
      scheduleManifest();
    },

    createFolder(kind, path) {
      setData({ ...data(), manifest: createFolder(data().manifest, kind, path) });
      scheduleManifest();
    },

    renameFolder(kind, from, to) {
      setData({ ...data(), manifest: renameFolder(data().manifest, kind, from, to) });
      scheduleManifest();
    },

    deleteFolder(kind, path) {
      setData({ ...data(), manifest: deleteFolder(data().manifest, kind, path) });
      scheduleManifest();
    },

    async remove(kind, slug) {
      const { view, diagram: current } = store.getState();
      const switching = kind === 'diagram' && current === slug;
      if (switching) {
        await beforeSwitch(true);
        // Checked before anything is mutated: refusing after removing the item would delete its
        // files and slug while the diagram store still holds the old (locked) diagram.
        if (switchLock()) throw new Error(switchLockedMessage(switchLock()));
      }
      const s = session;
      if (s && SHARED.test(s.adapter.label) && (kind === 'diagram' || kind === 'doc')) {
        // A room writes these files, never this saver (and the copy read at load is stale): remove what is on disk
        // now. The host then sees the item deleted and tells its peers; the open one leaves its room below.
        for (const path of kind === 'diagram' ? [diagramPath(slug), layoutPath(slug), perspectivesPath(slug)] : [docPath(slug)]) {
          if (await s.adapter.read(path) !== null) await s.adapter.remove(path);
        }
        if (kind === 'diagram' && collaborativeDiagram === slug) collaborativeDiagram = null;
        if (kind === 'doc' && collaborativeDoc === slug) collaborativeDoc = null;
      }
      const next = removeItem(data(), kind, slug);
      setData(next);
      scheduleItem(kind, slug);
      if (kind === 'diagram') scheduleFlows(slug);
      if (kind === 'diagram') schedulePerspectives(slug);
      if (kind === 'diagram') scheduleEvidence();
      if (kind === 'diagram') scheduleConcerns();
      if (kind === 'diagram') scheduleShared();
      scheduleManifest();
      scheduleBoard();
      if (switching) {
        const fallback = next.manifest.diagrams[0]?.slug ?? null;
        load(fallback);
        if (view.kind === 'diagram') store.setState({ view: fallback ? { kind: 'diagram' } : { kind: 'board' } });
      }
      if (view.kind === kind && 'slug' in view && view.slug === slug) store.setState({ view: { kind: 'board' } });
    },

    async restore(snapshot) {
      const next = restoreItem(data(), snapshot);
      if (!next) throw new Error(uiText("Já existe um item com esse nome; não foi possível desfazer."));
      setData(next);
      scheduleItem(snapshot.kind, snapshot.slug);
      if (snapshot.kind === 'diagram') {
        scheduleFlows(snapshot.slug);
        schedulePerspectives(snapshot.slug);
        scheduleEvidence();
        scheduleConcerns();
        scheduleShared();
      }
      scheduleManifest();
      scheduleBoard();
      if (snapshot.kind === 'diagram') await openDiagram(snapshot.slug);
      else await show({ kind: snapshot.kind, slug: snapshot.slug });
    },

    setName(name) {
      const trimmed = name.trim();
      if (!trimmed) return;
      setData({ ...data(), manifest: { ...data().manifest, name: trimmed } });
      scheduleManifest();
    },

    setDetails(details) {
      const lock = diagram.getState().readOnly;
      if (lock) throw new Error(lock);
      const name = details.name.trim();
      if (!name || name.length > 100) throw new Error(uiText("Use um nome entre 1 e 100 caracteres."));
      if (details.description.length > 1000) throw new Error(uiText("A descrição deve ter até 1000 caracteres."));
      if (details.logo !== null && !isWorkspaceLogo(details.logo)) throw new Error(uiText("Escolha uma imagem PNG, JPG ou WebP válida."));
      const manifest = { ...data().manifest, name };
      if (details.description.trim()) manifest.description = details.description.trim();
      else delete manifest.description;
      if (details.logo) manifest.logo = details.logo;
      else delete manifest.logo;
      setData({ ...data(), manifest });
      scheduleManifest();
    },

    setDoc(slug, text) {
      const current = data();
      const existing = own(current.docs, slug);
      if (existing === undefined || existing === text) return;
      setData({ ...current, docs: { ...current.docs, [slug]: text } });
      scheduleItem('doc', slug);
      analyticsEdit('doc', text.trim().length >= 20);
    },
    setLibrary(library) {
      const lock = diagram.getState().readOnly;
      if (lock) throw new Error(lock);
      const validated = parseLibrary(printLibrary(library));
      setData({ ...data(), library: validated });
      scheduleLibrary();
    },
    async setAssistants(assistants) {
      const lock = diagram.getState().readOnly;
      if (lock) throw new Error(lock);
      const invalid = await checkAssistants(assistants);
      if (invalid) throw new Error(invalid);
      setData({ ...data(), assistants });
      scheduleAssistants();
    },

    async applyRemoteManifest({ base, theirs }) {
      const s = session;
      const unchanged = { removed: [] };
      if (!s) return unchanged;
      const read = (text: string) => { try { return parseManifest(text).manifest; } catch { return null; } };
      const other = read(theirs);
      if (!other) return unchanged;
      const ancestor = base === null ? null : read(base);
      const merged = () => mergeManifests(ancestor, s.data.manifest, other);
      const known = (kind: ItemKind, slug: string) => s.data.manifest[ITEM_LIST[kind]].some((item) => item.slug === slug);
      const fresh = merged();
      const added = ITEM_KINDS.map((kind) => fresh[ITEM_LIST[kind]].filter((item) => !known(kind, item.slug)));
      let loaded: WorkspaceData | null = null;
      if (added.some((list) => list.length)) {
        // Only the new items' files are read: every other file keeps the baseline this guest saves against.
        const only = printManifest({ version: fresh.version, name: fresh.name, diagrams: added[0]!, docs: added[1]!, sketches: added[2]! });
        const items = { ...s.adapter, read: async (path: string) => path === MANIFEST_PATH ? only : /^(diagrams|docs|sketches)\//.test(path) ? s.adapter.read(path) : null };
        loaded = (await loadWorkspace(items))?.data ?? null;
        if (session !== s) return unchanged;
      }
      // The list may have moved while the files loaded: merge again over what is current.
      const final = merged();
      const removed: RemovedItem[] = [];
      let next = s.data;
      for (const kind of ITEM_KINDS) for (const item of next.manifest[ITEM_LIST[kind]]) {
        if (final[ITEM_LIST[kind]].some((entry) => entry.slug === item.slug)) continue;
        removed.push({ kind, slug: item.slug, title: item.title });
        next = removeItem(next, kind, item.slug);
      }
      const bring = <T>(from: Record<string, T> | undefined, into: Record<string, T> | undefined, kind: ItemKind): Record<string, T> | undefined => {
        if (!from) return into;
        const out = { ...into };
        for (const [slug, value] of Object.entries(from)) if (final[ITEM_LIST[kind]].some((entry) => entry.slug === slug) && !Object.hasOwn(out, slug)) out[slug] = value;
        return out;
      };
      const flows = bring(loaded?.flows, next.flows, 'diagram');
      const perspectives = bring(loaded?.perspectives, next.perspectives, 'diagram');
      next = {
        ...next, manifest: final,
        diagrams: bring(loaded?.diagrams, next.diagrams, 'diagram')!,
        docs: bring(loaded?.docs, next.docs, 'doc')!,
        sketches: bring(loaded?.sketches, next.sketches, 'sketch')!,
        ...(flows ? { flows } : {}), ...(perspectives ? { perspectives } : {}),
        board: reconcileBoard(next.board, final),
      };
      if (!removed.length && printManifest(final) === printManifest(s.data.manifest) && !loaded) return unchanged;
      setData(next);
      const { view, diagram: open } = store.getState();
      const lostDiagram = removed.some((item) => item.kind === 'diagram' && item.slug === open);
      const lostView = view.kind !== 'board' && view.kind !== 'diagram' && removed.some((item) => item.kind === view.kind && item.slug === view.slug);
      if (lostDiagram) {
        try { await beforeSwitch(true); } catch { /* the diagram is gone: nothing typed for it matters */ }
        try { load(final.diagrams[0]?.slug ?? null); } catch { /* a lock refuses the load: the Overview below still replaces the view */ }
      }
      if ((lostDiagram && view.kind === 'diagram') || lostView) store.setState({ view: { kind: 'board' } });
      return { removed };
    },

    isLocalEdit(slug) {
      return !loading && store.getState().diagram === slug;
    },

    setCollaborativeItem(kind, slug) {
      if (kind === 'diagram') collaborativeDiagram = slug;
      else collaborativeDoc = slug;
    },

    registerCollaborativeDoc(slug) {
      collaborativeDocs.set(slug, (collaborativeDocs.get(slug) ?? 0) + 1);
      let registered = true;
      return () => {
        if (!registered) return;
        registered = false;
        const count = collaborativeDocs.get(slug) ?? 0;
        if (count <= 1) collaborativeDocs.delete(slug);
        else collaborativeDocs.set(slug, count - 1);
      };
    },

    applyCollaborativeDiagram(slug, remote) {
      const current = data();
      if (!own(current.diagrams, slug)) return;
      const open = store.getState().diagram === slug;
      const state = diagram.getState();
      // Share identity with what is already shown, so untouched elements/boxes/routes do not re-render.
      const snapshot = shareWithPrevious(open ? { model: state.model, layout: state.layout } : current.diagrams[slug]!, remote);
      const same = snapshot.model === state.model && snapshot.layout === state.layout;
      if (open && same) return;
      setData({ ...current, diagrams: { ...current.diagrams, [slug]: snapshot } });
      if (!open) return;
      // Undo/redo restore whole snapshots, so any surviving one would revert (or delete) remote work for every
      // peer: a remote update always clears the local history, even though element identity is shared above.
      loading = true;
      try {
        diagram.setState({
          model: snapshot.model,
          layout: snapshot.layout,
          selection: {
            nodes: state.selection.nodes.filter((id) => own(snapshot.model.elements, id)),
            edges: state.selection.edges.filter((id) => snapshot.model.edges.some((edge) => edge.id === id)),
          },
          past: [], future: [],
          // A drag in progress stays a gesture (rebased on the remote state), so the outbox keeps throttling it.
          pending: state.pending ? { model: snapshot.model, layout: snapshot.layout } : null,
        });
      } finally { loading = false; }
    },

    applyCollaborativeDoc(slug, text) {
      const current = data();
      if (own(current.docs, slug) === undefined || current.docs[slug] === text) return;
      setData({ ...current, docs: { ...current.docs, [slug]: text } });
    },

    setSketch(slug, text) {
      const current = data();
      const existing = own(current.sketches, slug);
      if (existing === undefined || existing === text) return;
      setData({ ...current, sketches: { ...current.sketches, [slug]: text } });
      scheduleItem('sketch', slug);
      analyticsEdit('sketch', analyticsEnabled() && sketchHasContent(text));
    },

    setFlows(slug, flows) {
      const current = data();
      if (!own(current.diagrams, slug)) return;
      setData({ ...current, flows: { ...current.flows, [slug]: flows } });
      scheduleFlows(slug);
    },

    setPerspectives(slug, perspectives) {
      const current = data();
      if (!own(current.diagrams, slug)) return;
      setData({ ...current, perspectives: { ...current.perspectives, [slug]: perspectives } });
      schedulePerspectives(slug);
    },

    async setLevels(slug, levels) {
      const { applyLevels } = await import('../perspectives/applyLevels');
      const current = data();
      const snapshot = own(current.diagrams, slug);
      if (!snapshot) return;
      const shared = current.shared ?? emptyShared();
      const next = applyLevels(shared, slug, snapshot.model, levels, () => crypto.randomUUID().replace(/-/g, '').slice(0, 16));
      if (next === shared) return;
      setData({ ...current, shared: next });
      scheduleShared();
    },

    setEvidence(slug, id, refs) {
      const current = data();
      if (!own(current.diagrams, slug)) return;
      const entries = { ...evidenceFor(current, slug) };
      if (refs.length) entries[id] = refs;
      else delete entries[id];
      const evidence = { ...current.evidence, [slug]: entries };
      if (!Object.keys(entries).length) delete evidence[slug];
      setData({ ...current, evidence });
      scheduleEvidence();
    },

    linkEntity(slug, localId, entityId) {
      const current = data();
      const el = own(current.diagrams, slug)?.model.elements[localId];
      if (!el) return;
      const shared = current.shared ?? emptyShared();
      const mapping = { ...own(shared.views, slug) };
      if (entityId === null) delete mapping[localId];
      else mapping[localId] = entityId;
      const entities = { ...shared.entities };
      if (entityId && !own(entities, entityId)) entities[entityId] = { id: entityId, label: el.label ?? el.id, ...(el.tech ? { tech: el.tech } : {}), ...(el.description ? { description: el.description } : {}) };
      setData({ ...current, shared: { ...shared, entities, views: { ...shared.views, [slug]: mapping } } });
      scheduleShared();
      if (entityId && own(shared.entities, entityId) && diagram.getState().model === current.diagrams[slug]?.model) {
        const entity = shared.entities[entityId]!;
        diagram.getState().apply([{ op: 'update', id: localId, set: { label: entity.label ?? null, tech: entity.tech ?? null, description: entity.description ?? null } }]);
      }
    },

    linkRelation(slug, edgeId, relationId) {
      const current = data();
      const edge = own(current.diagrams, slug)?.model.edges.find((item) => item.id === edgeId);
      if (!edge) return;
      const shared = current.shared ?? emptyShared();
      const view = own(shared.views, slug) ?? {};
      const from = own(view, edge.from);
      const to = own(view, edge.to);
      if (relationId && (!from || !to)) return;
      const mapping = { ...shared.viewRelations?.[slug] };
      if (relationId === null) delete mapping[edgeId];
      else mapping[edgeId] = relationId;
      const relations = { ...shared.relations };
      if (relationId && !own(relations, relationId)) relations[relationId] = { id: relationId, from: from!, to: to!, connector: edge.connector, ...(edge.label ? { label: edge.label } : {}) };
      const existing = relationId ? own(shared.relations ?? {}, relationId) : undefined;
      if (existing && (existing.from !== from || existing.to !== to)) return;
      setData({ ...current, shared: { ...shared, relations, viewRelations: { ...shared.viewRelations, [slug]: mapping } } });
      scheduleShared();
      if (existing && diagram.getState().model === current.diagrams[slug]?.model) {
        diagram.getState().apply([{ op: 'update_edge', edgeId, set: { connector: existing.connector, label: existing.label ?? null } }]);
      }
    },

    setEntityTags(entityId, tags) {
      const current = data();
      const shared = current.shared;
      const entity = own(shared?.entities ?? {}, entityId);
      if (!shared || !entity) return;
      setData({ ...current, shared: { ...shared, entities: { ...shared.entities, [entityId]: { ...entity, tags: [...new Set(tags)] } } } });
      scheduleShared();
    },

    setRelationDetails(relationId, set) {
      const current = data();
      const shared = current.shared;
      const relation = own(shared?.relations ?? {}, relationId);
      if (!shared || !relation) return;
      const updated = { ...relation, ...set };
      if (!updated.tech) delete updated.tech;
      if (!updated.description) delete updated.description;
      setData({ ...current, shared: { ...shared, relations: { ...shared.relations, [relationId]: updated } } });
      scheduleShared();
    },

    setConcerns(concerns) {
      setData({ ...data(), concerns });
      scheduleConcerns();
    },

    updateBoard(update) {
      const current = data();
      const board = update(current.board);
      if (board === current.board) return;
      setData({ ...current, board });
      scheduleBoard();
    },

    onBeforeSwitch(hook) {
      hooks.add(hook);
      return () => hooks.delete(hook);
    },

    keepVersionsWhile(guard) {
      versionGuards.add(guard);
      return () => versionGuards.delete(guard);
    },

    flush: () => saver?.flush() ?? Promise.resolve(),
    retrySave: () => saver?.retry() ?? Promise.resolve(),
    rewriteAll() {
      const s = session;
      if (!s || !saver) return Promise.resolve();
      saver.forget();
      scheduleManifest();
      scheduleBoard();
      for (const kind of ITEM_KINDS) for (const { slug } of s.data.manifest[ITEM_LIST[kind]]) scheduleItem(kind, slug);
      for (const { slug } of s.data.manifest.diagrams) {
        scheduleFlows(slug);
        schedulePerspectives(slug);
      }
      scheduleEvidence();
      scheduleConcerns();
      scheduleShared();
      scheduleLibrary();
      scheduleAssistants();
      return saver.flush();
    },
    hasUnsaved: () => saver?.hasPending() ?? false,
    files: () => workspaceFiles(data()),
    // `session` (not a separate variable) is the single source of truth for "the open workspace's
    // adapter": it is swapped atomically with `saver` and the store's `data` inside `open()`, so a
    // read here always matches whichever session is current, never a torn mix of the two.
    storage: () => session?.adapter ?? null,
    // Forwards to whichever `saver` is live right now (the current session's), exactly like the
    // scheduleX helpers above. The content closure itself must bind to a captured session/data
    // snapshot, not to this mutable module state, or a write still queued when `open()` swaps
    // sessions would read the new workspace's data once the old saver finally flushes it.
    schedule: (path, content) => saver?.schedule(path, content),

    setExternal(files) {
      if (files.length) store.setState({ external: { files: [...files].sort() } });
    },

    dismissExternal() {
      store.setState({ external: null });
    },

    async reload() {
      const current = session;
      if (!current) return [];
      if (switchLock()) throw new Error(switchLockedMessage(switchLock()));
      const { view, diagram: slug } = store.getState();
      // The disk has a newer version: a queued write would clobber it.
      saver?.cancel();
      const warnings = await api.open(current.adapter, () => {
        throw new Error(uiText("O workspace não existe mais no disco."));
      });
      const next = store.getState().data;
      if (next) {
        const keep = (candidate: View): View | null => {
          if (candidate.kind === 'diagram') return slug && own(next.diagrams, slug) ? candidate : null;
          if (candidate.kind === 'doc') return own(next.docs, candidate.slug) !== undefined ? candidate : null;
          if (candidate.kind === 'sketch') return own(next.sketches, candidate.slug) !== undefined ? candidate : null;
          return candidate;
        };
        const restored = keep(view);
        if (restored) {
          if (restored.kind === 'diagram' && slug) load(slug);
          store.setState({ view: restored });
        }
      }
      store.setState({ external: null });
      return warnings;
    },

    close,
  };
  return api;
}

function sketchHasContent(text: string): boolean { try { return JSON.parse(text).elements?.some((e: { isDeleted?: boolean }) => !e.isDeleted) === true; } catch { return false; } }
