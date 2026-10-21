import { uiText } from '../i18n';
import { useStore } from 'zustand';
import { aiStore, onDraftApplied } from '../ai/session';
import { flushCodeEdits } from '../code/registry';
import { diagramStore } from '../state/appStore';
import { closeRightPanel, showToast, toggleRightPanel, uiStore } from '../ui/uiStore';
import { workspace } from '../workspace/appWorkspace';
import { createVersionStore } from './versionStore';
import type { VersionState } from './versionStore';
import { flowsFor } from '../workspace/lookup';

/** The app's versions, for the diagram open in the workspace. */
export const versionStore = createVersionStore({
  diagram: diagramStore,
  target: () => ({ slug: workspace.store.getState().diagram, storage: workspace.storage() }),
  flows: (slug) => flowsFor(workspace.store.getState().data, slug) ?? [],
  restoreFlows: (slug, flows) => workspace.setFlows(slug, flows),
  flushCode: flushCodeEdits,
  blocked: () => {
    const ai = aiStore.getState();
    if (ai.draft) return uiText("Aplique ou descarte a proposta da IA antes de comparar versões.");
    if (ai.status === 'loading') return uiText("Aguarde ou cancele o pedido à IA antes de comparar versões.");
    return null;
  },
  notify: showToast,
});

// A comparison locks the diagram store: it ends before the workspace loads another diagram or view.
workspace.onBeforeSwitch(() => versionStore.getState().stopCompare());
// The diagram slug can stay the same across a workspace switch (Abrir pasta copy, a fresh "exemplo",
// zip import): a version list belongs to one storage, not one slug, so a new `source` object (set once
// per `open()`, regardless of label) always drops the previous list and reloads the new one.
workspace.store.subscribe((state, prev) => {
  if (state.source !== prev.source) {
    versionStore.getState().stopCompare();
    void versionStore.getState().refresh();
  }
});
// One diff preview at a time: opening the AI panel ends a comparison, starting one closes the panel.
aiStore.subscribe((state, prev) => {
  if (state.open && !prev.open) versionStore.getState().stopCompare();
});
versionStore.subscribe((state, prev) => {
  if (state.view && !prev.view && aiStore.getState().open) aiStore.getState().setOpen(false);
});
// `rightPanel` owns whether the panel is shown; `versionStore.open` mirrors it (both directions are
// idempotent, so they settle immediately). Leaving the slot goes through `setOpen(false)`, which ends a comparison.
uiStore.subscribe((state, prev) => {
  if (state.rightPanel === prev.rightPanel) return;
  const open = state.rightPanel === 'versions';
  if (versionStore.getState().open !== open) versionStore.getState().setOpen(open);
});
versionStore.subscribe((state, prev) => {
  if (state.open === prev.open) return;
  if (state.open) {
    if (uiStore.getState().rightPanel !== 'versions') uiStore.setState({ rightPanel: 'versions' });
  } else closeRightPanel('versions');
});
// Every accepted AI proposal becomes a version by the AI, with its summary as the message; `.catch`
// keeps a failed save (e.g. a Código flush that rejects) from surfacing as an unhandled rejection.
onDraftApplied((draft) => {
  versionStore
    .getState()
    .save(draft.summary, 'ai')
    .then((saved) => {
      const diagram = versionStore.getState().diagram;
      // The webhook client is a lazy chunk: the initial bundle does not carry it.
      if (saved && diagram) void import('../integrations/client').then((m) => m.notifyAiVersion(diagram, draft.summary));
    })
    .catch(() => {});
});

export function useVersions<T>(selector: (state: VersionState) => T): T {
  return useStore(versionStore, selector);
}

/** The "Versões" button and command. */
export function toggleVersions(): void {
  toggleRightPanel('versions');
}

/** "Planejar estado futuro": the Linha do tempo panel opens with the dialog that names and dates a planned version. */
export function openPlanFuture(): void {
  if (uiStore.getState().rightPanel !== 'timeline') uiStore.setState({ rightPanel: 'timeline' });
  versionStore.getState().setPlanDialogOpen(true);
}

/** ⌘S and "Salvar versão". */
export function openSaveVersion(): void {
  versionStore.getState().setDialogOpen(true);
}
