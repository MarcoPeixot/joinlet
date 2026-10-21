import { useStore } from 'zustand';
import { flushCodeEdits } from '../code/registry';
import { diagramStore } from '../state/appStore';
import { requestFit, showToast } from '../ui/uiStore';
import { createAiStore } from './aiStore';
import type { AiState } from './aiStore';
import { requestDoc, requestOps } from './client';
import { createDocSession } from './doc';
import type { DocState } from './doc';
import type { Draft } from './draft';

const appliedListeners = new Set<(draft: Draft) => void>();

/** Runs after each applied AI draft (versions/session.ts records a version with the AI summary). */
export function onDraftApplied(listener: (draft: Draft) => void): () => void {
  appliedListeners.add(listener);
  return () => appliedListeners.delete(listener);
}

/** The app's AI session, bound to the app's diagram store. */
export const aiStore = createAiStore(diagramStore, {
  requestOps: (body, signal) => requestOps(body, undefined, signal),
  flushCode: flushCodeEdits,
  onAutoLayout: requestFit,
  onBlocked: showToast,
  // Loaded lazily: boot imports the modules that import this one.
  keepIds: async () => (await import('../workspace/boot')).collaborationSession() !== null,
  onApplied: (draft) => {
    // Isolated per listener: the diagram mutation already committed, so one throwing listener must
    // neither skip the others nor turn this successful apply() into a rejection.
    for (const listener of appliedListeners) {
      try {
        listener(draft);
      } catch (err) {
        console.error('onDraftApplied listener threw', err);
      }
    }
  },
});

// A draft laid out from scratch may sit away from the current view: frame it.
aiStore.subscribe((state, prev) => {
  if (state.draft && state.draft !== prev.draft && state.draft.autoLayout) requestFit();
});

export function useAi<T>(selector: (state: AiState) => T): T {
  return useStore(aiStore, selector);
}

/** ⌘J and the "IA" button. Closing the panel discards a pending draft. */
export function toggleAi(): void {
  const state = aiStore.getState();
  state.setOpen(!state.open);
}

export const docSession = createDocSession(diagramStore, { requestDoc: (dsl, signal) => requestDoc(dsl, undefined, signal), flushCode: flushCodeEdits });

export function useDoc<T>(selector: (state: DocState) => T): T {
  return useStore(docSession.store, selector);
}
