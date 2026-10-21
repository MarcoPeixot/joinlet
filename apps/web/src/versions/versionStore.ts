import { uiText } from '../i18n';
import type { LayoutState } from '@strukt/core';
import type { EdgeRouter } from '@strukt/layout';
import { createVersion, listVersions, readVersion, versionSnapshot, writeVersion } from '@strukt/workspace';
import type { Flow, StageMeta, StorageAdapter, Version, VersionAuthor, VersionEntry } from '@strukt/workspace';
import { createStore } from 'zustand/vanilla';
import type { DiffPreview } from '../ai/overlay';
import { loadEraserRouter } from '../state/eraserRouter';
import type { DiagramStore } from '../state/diagramStore';
import { formatVersionDate, restoredMessage } from './labels';
import { changeLines, planRestore } from './restore';
import type { ChangeLine, RestorePlan } from './restore';

/** Why editing is locked while a version is compared (the diagram store refuses every mutation with it). */
export { COMPARE_LOCK } from '../state/locks';
import { COMPARE_LOCK } from '../state/locks';

export interface Comparison {
  entry: VersionEntry;
  /** The version body, read only when the comparison starts (the list carries summaries). */
  full: Version;
  plan: RestorePlan;
  lines: ChangeLine[];
}

/** What the canvas draws while a comparison is open: the diff overlay, with where the earlier state had its elements. */
export interface CompareView {
  preview: DiffPreview;
  /** Layout of the earlier state (the ghosts of removed elements go there); the open diagram's when absent. */
  oldLayout?: LayoutState;
}

export interface VersionState {
  /** The "Versões" panel is open. */
  open: boolean;
  /** Diagram (slug) whose versions `entries` lists. */
  diagram: string | null;
  status: 'idle' | 'loading';
  /** Newest first. All are kept: there is no pruning. */
  entries: VersionEntry[];
  /** The version shown on the canvas as a diff; the diagram store is read-only meanwhile. */
  compare: Comparison | null;
  /** What the canvas shows for a comparison (this store's own, or the timeline's); `compare` is the restore-able subset. */
  view: CompareView | null;
  /** The "Salvar versão" dialog (⌘S). */
  dialogOpen: boolean;
  /** The "Planejar estado futuro" dialog. */
  planDialogOpen: boolean;
  setOpen: (open: boolean) => void;
  setDialogOpen: (open: boolean) => void;
  setPlanDialogOpen: (open: boolean) => void;
  /** Reads the open diagram's versions from storage. */
  refresh: () => Promise<void>;
  /** Saves the open diagram as a version (a planned one when `meta` says so); false when nothing could be written. */
  save: (message: string, author?: VersionAuthor, meta?: StageMeta) => Promise<boolean>;
  startCompare: (entry: VersionEntry) => Promise<void>;
  /** Shows a diff built elsewhere (the timeline's) under the same lock and exclusions as `startCompare`; false when refused. */
  present: (view: CompareView) => boolean;
  stopCompare: () => void;
  /** Applies the compared version as one undo step, then records "Restaurado de <data>". */
  restore: () => Promise<boolean>;
}

export interface VersionDeps {
  diagram: DiagramStore;
  /** The open diagram and the storage of its workspace. */
  target: () => { slug: string | null; storage: StorageAdapter | null };
  flows?: (slug: string) => Flow[];
  restoreFlows?: (slug: string, flows: Flow[]) => void;
  /** Commits pending edits of the Código editor, so they are part of what is saved or compared. */
  flushCode?: () => Promise<void>;
  /** Why a comparison cannot start now (an AI draft is pending), or null. */
  blocked?: () => string | null;
  router?: EdgeRouter;
  now?: () => Date;
  newId?: () => string;
  notify?: (message: string) => void;
}

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** What writing a version came to: `save` toasts it directly; `restore` folds it into its own toast. */
type SaveOutcome = { ok: true } | { ok: false; kind: 'no-target' | 'write-failed'; reason: string };

/** Versions of the open diagram: save, list, compare on the canvas (read-only) and restore. */
export function createVersionStore(deps: VersionDeps) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID().slice(0, 8));
  const notify = deps.notify ?? (() => {});

  return createStore<VersionState>()((set, get) => {
    const unlock = () => {
      if (deps.diagram.getState().readOnly === COMPARE_LOCK) deps.diagram.getState().setReadOnly(null);
    };

    // Generation counters: bumped so an in-flight `refresh`/`startCompare` can tell, once its await
    // returns, whether it is still the latest call before touching shared state.
    let refreshSeq = 0;
    let compareSeq = 0;

    /** Writes a version of the open diagram. Shared by `save` (which toasts on its own) and `restore` (which doesn't). */
    async function commitVersion(message: string, author: VersionAuthor, meta?: StageMeta): Promise<SaveOutcome> {
      await deps.flushCode?.();
      const { slug, storage } = deps.target();
      if (!slug || !storage) return { ok: false, kind: 'no-target', reason: uiText("Abra um diagrama para salvar uma versão.") };
      const { model, layout } = deps.diagram.getState();
      const flows = deps.flows?.(slug);
      const version = createVersion({ model, layout }, { id: newId(), createdAt: now().toISOString(), message: message.trim(), author, ...meta, ...(flows ? { flows } : {}) });
      try {
        const entry = await writeVersion(storage, slug, version);
        if (get().diagram === slug && deps.target().storage === storage) set({ entries: [entry, ...get().entries] });
        return { ok: true };
      } catch (err) {
        return { ok: false, kind: 'write-failed', reason: reason(err) };
      }
    }

    return {
      open: false,
      diagram: null,
      status: 'idle',
      entries: [],
      compare: null,
      view: null,
      dialogOpen: false,
      planDialogOpen: false,

      setOpen(open) {
        // Closing the panel is the only way out of a comparison it no longer shows.
        if (!open) get().stopCompare();
        set({ open });
      },

      setDialogOpen(dialogOpen) {
        set({ dialogOpen });
      },

      setPlanDialogOpen(planDialogOpen) {
        set({ planDialogOpen });
      },

      async refresh() {
        const { slug, storage } = deps.target();
        if (!slug || !storage) {
          refreshSeq++;
          set({ diagram: null, entries: [], status: 'idle' });
          return;
        }
        const seq = ++refreshSeq;
        // Switching diagrams drops the old list right away, so a stale entry can't be clicked or
        // compared meanwhile; re-refreshing the same diagram keeps it until the new list arrives.
        const before = get().diagram === slug ? get().entries : [];
        set({ diagram: slug, status: 'loading', entries: before });
        try {
          const { entries, skipped } = await listVersions(storage, slug);
          if (seq !== refreshSeq) return; // superseded by a later refresh (possibly of a different diagram)
          // A `save` that landed while this was in flight already has the freshest list locally:
          // a stale read must not erase the entry it just prepended.
          set(get().entries === before ? { entries, status: 'idle' } : { status: 'idle' });
          if (skipped.length) notify(`${skipped.length === 1 ? uiText("Um arquivo de versão inválido foi ignorado") : uiText("{0} arquivos de versão inválidos foram ignorados", [skipped.length])}: ${skipped.join(', ')}.`);
        } catch (err) {
          if (seq !== refreshSeq) return;
          set(get().entries === before ? { entries: [], status: 'idle' } : { status: 'idle' });
          notify(uiText("Não foi possível ler as versões: {0}", [reason(err)]));
        }
      },

      async save(message, author = 'human', meta) {
        const result = await commitVersion(message, author, meta);
        if (!result.ok) {
          notify(result.kind === 'no-target' ? result.reason : uiText("Não foi possível salvar a versão: {0}", [result.reason]));
          return false;
        }
        return true;
      },

      async startCompare(entry) {
        if (get().compare?.entry.path === entry.path) return;
        const blocked = deps.blocked?.();
        if (blocked) {
          notify(blocked);
          return;
        }
        const seq = ++compareSeq;
        await deps.flushCode?.();
        if (seq !== compareSeq) return; // cancelled (stopCompare, or a newer startCompare) while flushing
        const blockedAfter = deps.blocked?.();
        if (blockedAfter) {
          notify(blockedAfter);
          return;
        }
        // The diagram may have switched, or this entry may have dropped out of its list, while flushing. Found by
        // path: a same-diagram refresh during the flush replaces the entry objects without changing the list.
        const fresh = get().entries.find((e) => e.path === entry.path);
        if (get().diagram !== deps.target().slug || !fresh) return;
        const { storage } = deps.target();
        const [full, router] = await Promise.all([
          storage ? readVersion(storage, fresh.path).catch(() => null) : null,
          deps.router ?? loadEraserRouter(),
        ]);
        if (seq !== compareSeq) return; // cancelled while the body was read
        if (!full) {
          notify(uiText("Não foi possível ler esta versão: o arquivo mudou ou foi removido."));
          return;
        }
        if (get().diagram !== deps.target().slug) return;
        const state = deps.diagram.getState();
        if (state.readOnly && state.readOnly !== COMPARE_LOCK) {
          notify(state.readOnly);
          return;
        }
        const { snapshot, diagnostics } = versionSnapshot(full);
        const error = diagnostics.find((d) => d.severity === 'error');
        if (error) {
          notify(uiText("Esta versão tem erros no código (linha {0}: {1}) e não pode ser comparada.", [error.line, error.message]));
          return;
        }
        let plan: RestorePlan;
        try {
          plan = planRestore(state, snapshot, router);
        } catch (err) {
          notify(uiText("Não foi possível comparar com esta versão: {0}", [reason(err)]));
          return;
        }
        state.setReadOnly(COMPARE_LOCK);
        set({ compare: { entry: fresh, full, plan, lines: changeLines(plan.preview) }, view: { preview: plan.preview } });
      },

      present(view) {
        const blocked = deps.blocked?.();
        if (blocked) {
          notify(blocked);
          return false;
        }
        const state = deps.diagram.getState();
        if (state.readOnly && state.readOnly !== COMPARE_LOCK) {
          notify(state.readOnly);
          return false;
        }
        compareSeq++; // supersedes a comparison that is still starting
        state.setReadOnly(COMPARE_LOCK);
        set({ compare: null, view });
        return true;
      },

      stopCompare() {
        compareSeq++; // cancels a comparison that is still starting, even with nothing to clear yet
        if (!get().compare && !get().view) return;
        unlock();
        set({ compare: null, view: null });
      },

      async restore() {
        const { compare } = get();
        if (!compare) return false;
        get().stopCompare();
        const slug = deps.target().slug;
        const flows = compare.full.flows;
        const flowsChanged = !!slug && !!flows && JSON.stringify(flows) !== JSON.stringify(deps.flows?.(slug) ?? []);
        if (compare.plan.unchanged && !flowsChanged) {
          notify(uiText("O diagrama já está igual a esta versão."));
          return false;
        }
        const state = deps.diagram.getState();
        if (state.model !== compare.plan.preview.base) {
          notify(uiText("O diagrama mudou durante a comparação. Compare de novo."));
          return false;
        }
        if (!compare.plan.unchanged && !state.apply(compare.plan.ops, compare.plan.positions)) {
          notify(deps.diagram.getState().lastError ?? uiText("Não foi possível restaurar a versão."));
          return false;
        }
        if (slug && flows) deps.restoreFlows?.(slug, flows);
        const label = uiText("Versão de {0} restaurada", [formatVersionDate(compare.entry.version.createdAt)]);
        const saved = await commitVersion(restoredMessage(compare.full), 'human');
        notify(saved.ok ? uiText("{0}. ⌘Z desfaz.", [label]) : uiText("{0} (⌘Z desfaz), mas não foi possível registrar a versão: {1}", [label, saved.reason]));
        return true;
      },
    };
  });
}

export type VersionStore = ReturnType<typeof createVersionStore>;
