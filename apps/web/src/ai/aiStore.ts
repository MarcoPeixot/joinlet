import { uiText } from '../i18n';
import { printDiagramJson } from '@strukt/json';
import type { EdgeRouter } from '@strukt/layout';
import { createStore } from 'zustand/vanilla';
import type { DiagramStore } from '../state/diagramStore';
import type { AiMode, OpsReply, OpsRequest } from './client';
import { createDraft } from './draft';
import type { Draft, LayoutRunner, Proposal } from './draft';

export { DRAFT_LOCK } from '../state/locks';
import { DRAFT_LOCK } from '../state/locks';
/** A draft finished while somebody else (presentation, version comparison) holds the diagram: it is dropped, not forced. */
export const FOREIGN_LOCK = uiText("Saia da apresentação ou da comparação para ver a proposta da IA.");
const STALE = uiText("O diagrama mudou enquanto a IA respondia. Envie de novo.");

export interface AiNotice {
  kind: 'error' | 'info';
  text: string;
}

export interface AiState {
  open: boolean;
  mode: AiMode;
  prompt: string;
  /** Send the selected nodes with the instruction (only shown when something is selected). */
  useSelection: boolean;
  status: 'idle' | 'loading';
  /** Last error, or the AI's explanation when it proposed no change. */
  notice: AiNotice | null;
  /** Set when the last answer came from the offline interpreter: why the server was not used. */
  offlineReason: string | null;
  /** Pending proposal shown on the canvas; the diagram store is read-only meanwhile. */
  draft: Draft | null;
  setOpen: (open: boolean) => void;
  setMode: (mode: AiMode) => void;
  setPrompt: (prompt: string) => void;
  setUseSelection: (on: boolean) => void;
  submit: () => Promise<void>;
  /** Commits the draft as one undo step; false if it could not be applied. */
  apply: () => Promise<boolean>;
  discard: () => void;
}

export interface AiDeps {
  requestOps: (body: OpsRequest, signal?: AbortSignal) => Promise<OpsReply>;
  /** Commits pending edits of the Código editor ("text wins" would otherwise revert an accepted draft). */
  flushCode?: () => Promise<void>;
  router?: EdgeRouter;
  runLayout?: LayoutRunner;
  /** After applying a draft laid out by ELK (the app fits the view). */
  onAutoLayout?: () => void;
  /** After any draft is applied (M5 records a version by the AI with its summary). */
  onApplied?: (draft: Draft) => void;
  /** A proposal was dropped because another mode holds the diagram (the app shows a toast). */
  onBlocked?: (message: string) => void;
  /** True in a shared (collaboration) session: ids are the room's merge key, so the offline rules rename by label. */
  keepIds?: () => boolean | Promise<boolean>;
}

/** AI panel state machine: instruction → proposal (server or offline rules) → draft preview → apply/discard. */
export function createAiStore(diagram: DiagramStore, deps: AiDeps) {
  return createStore<AiState>()((set, get) => {
    // Bumped by setOpen(false) and discard(): a `submit()` in flight checks it after every await
    // and abandons the answer (no draft, no lock) once it no longer matches.
    let requestId = 0;
    // Aborted next to requestId++, so the fetch behind an abandoned request stops instead of billing on.
    let controller: AbortController | null = null;
    const release = () => {
      // Only our own lock: a presentation or comparison that took the diagram meanwhile keeps it.
      if (diagram.getState().readOnly === DRAFT_LOCK) diagram.getState().setReadOnly(null);
      set({ draft: null });
    };
    const fail = (text: string, offlineReason: string | null = null) => set({ status: 'idle', offlineReason, notice: { kind: 'error', text } });

    return {
      open: false,
      mode: 'edit',
      prompt: '',
      useSelection: true,
      status: 'idle',
      notice: null,
      offlineReason: null,
      draft: null,

      setOpen(open) {
        if (!open) {
          requestId++;
          controller?.abort();
          if (get().draft) release();
          set({ open, status: 'idle' });
          return;
        }
        set({ open });
      },
      setMode(mode) {
        set({ mode });
      },
      setPrompt(prompt) {
        set({ prompt });
      },
      setUseSelection(useSelection) {
        set({ useSelection });
      },

      async submit() {
        const s = get();
        if (s.status === 'loading' || s.draft) return;
        const instruction = s.prompt.trim();
        if (!instruction) {
          set({ notice: { kind: 'error', text: uiText("Descreva o que a IA deve fazer.") } });
          return;
        }
        const id = requestId;
        const cancelled = () => requestId !== id;
        controller = new AbortController();
        set({ status: 'loading', notice: null });
        try {
          await deps.flushCode?.();
          if (cancelled()) return;
          const { model, layout, selection } = diagram.getState();
          const stale = () => diagram.getState().model !== model || diagram.getState().layout.nodes !== layout.nodes;
          const reply = await deps.requestOps(
            {
              instruction,
              json: printDiagramJson(model),
              selection: s.useSelection ? selection.nodes : [],
              mode: s.mode,
            },
            controller.signal,
          );
          if (cancelled()) return;
          let proposal: Proposal;
          let offlineReason: string | null = null;
          if (reply.kind === 'ok') {
            proposal = { ops: reply.ops, summary: reply.summary, source: 'ai', model: reply.model };
          } else if (reply.kind === 'offline') {
            offlineReason = reply.reason;
            if (s.mode === 'generate') return fail(uiText("\"Gerar do zero\" precisa do servidor de IA. {0}", [reply.reason]), offlineReason);
            const keepIds = (await deps.keepIds?.()) ?? false;
            if (cancelled()) return;
            // The local rules only run when the server cannot answer: their code stays out of the first load.
            const { interpretOffline } = await import('./offline');
            if (cancelled()) return;
            const local = interpretOffline(instruction, model, { keepIds });
            if (!local.ok) return fail(local.error, offlineReason);
            proposal = { ops: local.ops, summary: local.summary, source: 'offline' };
          } else {
            return fail(reply.message);
          }
          if (!proposal.ops.length) {
            set({ status: 'idle', offlineReason, notice: { kind: 'info', text: proposal.summary || uiText("Nada a alterar.") } });
            return;
          }
          await deps.flushCode?.();
          if (cancelled()) return;
          if (stale()) return fail(STALE, offlineReason);
          const made = await createDraft(model, layout, proposal, { router: deps.router, runLayout: deps.runLayout });
          if (cancelled()) return;
          if (!made.ok) return fail(made.error, offlineReason);
          if (stale()) return fail(STALE, offlineReason);
          const held = diagram.getState().readOnly;
          if (held && held !== DRAFT_LOCK) {
            deps.onBlocked?.(FOREIGN_LOCK);
            return fail(FOREIGN_LOCK, offlineReason);
          }
          diagram.getState().setReadOnly(DRAFT_LOCK);
          set({ status: 'idle', offlineReason, notice: null, draft: made.draft });
        } catch (err) {
          if (!cancelled()) fail(err instanceof Error ? err.message : String(err));
        }
      },

      async apply() {
        const { draft } = get();
        if (!draft) return false;
        await deps.flushCode?.();
        if (get().draft !== draft) return false;
        release();
        const state = diagram.getState();
        if (state.model !== draft.base) {
          set({ notice: { kind: 'error', text: STALE } });
          return false;
        }
        if (!state.apply(draft.ops, draft.positions)) {
          set({ notice: { kind: 'error', text: diagram.getState().lastError ?? uiText("Não foi possível aplicar a proposta.") } });
          return false;
        }
        set({ prompt: '', notice: null });
        if (draft.autoLayout) deps.onAutoLayout?.();
        deps.onApplied?.(draft);
        return true;
      },

      discard() {
        requestId++;
        controller?.abort();
        release();
        set({ status: 'idle', notice: null });
      },
    };
  });
}

export type AiStore = ReturnType<typeof createAiStore>;
