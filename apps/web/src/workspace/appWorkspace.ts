import { uiText } from '../i18n';
import { useStore } from 'zustand';
import { aiStore } from '../ai/session';
import { flushCodeEdits, hasPendingCodeEdits, hasUnappliedCodeEdits } from '../code/registry';
import { diagramStore } from '../state/appStore';
import { showToast } from '../ui/uiStore';
import { createExternalWatcher } from './external';
import { createWorkspace } from './workspace';
import { navigationPersistence } from './navigation';
import type { WorkspaceState } from './workspace';

export const workspace = createWorkspace(diagramStore, { navigation: navigationPersistence });
const liveSource = () => /^(GitHub:|Rede local:|Local network:)/.test(workspace.store.getState().source?.label ?? '');

// Typing in the Código panel belongs to the diagram it was typed in: commit it before anything switches.
workspace.onBeforeSwitch(async () => {
  await flushCodeEdits();
  if (hasUnappliedCodeEdits()) throw new Error(uiText("Corrija o JSON no painel Código antes de trocar de projeto ou diagrama."));
});
// An AI draft (M3) locks the diagram store; it cannot follow the user into another diagram. A request
// still in flight is cancelled too (its fetch would keep billing for an answer that gets dropped).
workspace.onBeforeSwitch((reload) => {
  const ai = aiStore.getState();
  if (reload && (ai.draft || ai.status === 'loading')) ai.discard();
});

export function useWorkspace<T>(selector: (state: WorkspaceState) => T): T {
  return useStore(workspace.store, selector);
}

/**
 * Watches the open folder for writes made outside the app (an agent, a checkout): the banner offers to
 * reload. The baseline is refreshed after every save (our own writes never look external), after a
 * reload and whenever the workspace changes.
 */
export const externalWatcher = createExternalWatcher({
  adapter: () => workspace.storage(),
  onChanges: (files) => {
    if (liveSource()) return;
    if (workspace.hasUnsaved() || hasPendingCodeEdits() || diagramStore.getState().readOnly || aiStore.getState().status === 'loading') {
      workspace.setExternal(files);
      return;
    }
    void workspace.reload().catch(() => workspace.setExternal(files));
  },
});

workspace.store.subscribe((state, prev) => {
  if (state.source !== prev.source) void externalWatcher.resync();
  if (state.save === 'saved' && prev.save !== 'saved') void externalWatcher.resync();
  if (state.external === null && prev.external !== null) void externalWatcher.resync();
});
externalWatcher.start();

/** "Recarregar do disco" (banner and ⌘K): drops pending writes after confirming, then re-reads. */
export async function reloadWorkspace(): Promise<void> {
  if (liveSource()) {
    showToast(uiText("A colaboração está ativa. As mudanças do documento e diagrama chegam automaticamente."));
    return;
  }
  if (workspace.hasUnsaved() && !globalThis.confirm?.(uiText("Há mudanças ainda não salvas; recarregar descarta essas mudanças. Continuar?"))) return;
  try {
    const warnings = await workspace.reload();
    showToast(warnings.length ? uiText("Workspace recarregado com avisos: {0}", [warnings[0]]) : uiText("Workspace recarregado do disco."));
  } catch (err) {
    showToast(err instanceof Error ? err.message : String(err));
  }
}
