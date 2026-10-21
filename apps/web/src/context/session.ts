import { uiText } from '../i18n';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { showToast } from '../ui/uiStore';
import { workspace } from '../workspace/appWorkspace';
import { createContextSync } from './contextSync';

/** Keeps `.arch/context/` of the open workspace fresh once it was generated. */
export const contextSync = createContextSync(workspace);

export interface AgentContextState {
  open: boolean;
  status: 'loading' | 'ready';
  files: Record<string, string>;
}

// Exported (not kept module-private like the brief's draft) so useShortcuts.ts can block global
// shortcuts while open, the same way it reads docSession.store and versionStore directly.
export const contextStore = createStore<AgentContextState>()(() => ({ open: false, status: 'loading', files: {} }));

export function useAgentContext<T>(selector: (state: AgentContextState) => T): T {
  return useStore(contextStore, selector);
}

/** "Gerar contexto para agentes": writes `.arch/context/` (kept up to date from then on) and shows the files. */
export async function generateAgentContext(): Promise<void> {
  if (!workspace.store.getState().data) return;
  contextStore.setState({ open: true, status: 'loading', files: {} });
  try {
    const files = await contextSync.generate();
    contextStore.setState({ status: 'ready', files });
  } catch (err) {
    contextStore.setState({ open: false });
    showToast(uiText("Não foi possível gerar o contexto: {0}", [err instanceof Error ? err.message : String(err)]));
  }
}

export function closeAgentContext(): void {
  contextStore.setState({ open: false });
}
