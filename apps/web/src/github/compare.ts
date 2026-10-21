import { uiText } from '../i18n';
import { compareModels, diffModels, renamesIn } from '@strukt/core';
import type { LayoutState } from '@strukt/core';
import { deserializeDiagram, emptyShared, parseFlows, parseShared, printFlows, stableStringify } from '@strukt/workspace';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { DiffPreview } from '../ai/overlay';
import { flushCodeEdits } from '../code/registry';
import { diagramStore } from '../state/appStore';
import { showToast } from '../ui/uiStore';
import { workspace } from '../workspace/appWorkspace';
import { requestGitDiagram } from './client';

export { BRANCH_COMPARE_LOCK } from '../state/locks';
import { BRANCH_COMPARE_LOCK } from '../state/locks';
import { flowsFor } from '../workspace/lookup';

interface BranchCompareState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  ref: string | null;
  preview: DiffPreview | null;
  oldLayout: LayoutState | null;
  details: string[];
  start(dir: string, slug: string, ref: string): Promise<boolean>;
  stop(): void;
}

let requestId = 0;
export const branchCompareStore = createStore<BranchCompareState>()((set, get) => ({
  status: 'idle', error: null, ref: null, preview: null, oldLayout: null, details: [],
  async start(dir, slug, ref) {
    const id = ++requestId;
    if (diagramStore.getState().readOnly) { set({ status: 'error', error: diagramStore.getState().readOnly }); return false; }
    set({ status: 'loading', error: null });
    try {
    await flushCodeEdits();
    await workspace.flush();
    const response = await requestGitDiagram(dir, slug, ref);
    if (id !== requestId || workspace.store.getState().diagram !== slug) return false;
    if (response.kind !== 'ok') { set({ status: 'error', error: response.kind === 'offline' ? response.reason : response.message }); return false; }
    const parsed = deserializeDiagram(response.json, response.layout);
    const problem = parsed.diagnostics.find((item) => item.severity === 'error');
    if (problem) { set({ status: 'error', error: uiText("O diagrama em {0} tem erros: {1}", [ref, problem.message]) }); return false; }
    const current = diagramStore.getState();
    const ops = diffModels(parsed.snapshot.model, current.model);
    const preview: DiffPreview = {
      base: parsed.snapshot.model,
      next: current.model,
      layout: current.layout,
      changes: compareModels(parsed.snapshot.model, current.model, renamesIn(parsed.snapshot.model, ops)),
    };
    const beforeShared = parseShared(response.shared);
    const afterShared = workspace.store.getState().data?.shared ?? emptyShared();
    const changed = (a: Record<string, unknown>, b: Record<string, unknown>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => stableStringify(a[key]) !== stableStringify(b[key])).length;
    const entities = changed(beforeShared.entities, afterShared.entities);
    const relations = changed(beforeShared.relations ?? {}, afterShared.relations ?? {});
    const beforeFlows = parseFlows(response.flows);
    const afterFlows = flowsFor(workspace.store.getState().data, slug) ?? [];
    const flowCount = printFlows(beforeFlows) === printFlows(afterFlows) ? 0 : 1;
    const details = [...(entities ? [uiText("{0} {1} no modelo", [entities, entities === 1 ? uiText("entidade alterada") : uiText("entidades alteradas")])] : []), ...(relations ? [uiText("{0} {1} no modelo", [relations, relations === 1 ? uiText("relação alterada") : uiText("relações alteradas")])] : []), ...(flowCount ? [uiText("Fluxos deste diagrama alterados")] : [])];
    // Somebody else (presentation, AI draft, version comparison) may have taken the lock during the awaits above.
    if (diagramStore.getState().readOnly) {
      set({ status: 'idle', error: null });
      showToast(uiText("A comparação com o Git foi descartada: o diagrama foi travado por outra ação enquanto ela carregava."));
      return false;
    }
    current.setReadOnly(BRANCH_COMPARE_LOCK);
    set({ status: 'ready', error: null, ref: response.ref, preview, oldLayout: parsed.snapshot.layout, details });
    return true;
    } catch (error) {
      if (id === requestId) set({ status: 'error', error: error instanceof Error ? error.message : uiText("Não foi possível comparar os diagramas.") });
      return false;
    }
  },
  stop() {
    requestId++;
    if (diagramStore.getState().readOnly === BRANCH_COMPARE_LOCK) diagramStore.getState().setReadOnly(null);
    set({ status: 'idle', error: null, ref: null, preview: null, oldLayout: null, details: [] });
  },
}));

workspace.onBeforeSwitch(() => branchCompareStore.getState().stop());

export function useBranchCompare<T>(selector: (state: BranchCompareState) => T): T {
  return useStore(branchCompareStore, selector);
}
