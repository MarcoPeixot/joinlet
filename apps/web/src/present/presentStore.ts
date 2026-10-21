import { uiText } from '../i18n';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { aiStore } from '../ai/session';
import { flushCodeEdits } from '../code/registry';
import { branchCompareStore } from '../github/compare';
import { diagramStore } from '../state/appStore';
import { showToast, uiStore } from '../ui/uiStore';
import { workspace } from '../workspace/appWorkspace';
import { componentFlow } from './componentFlow';
import type { ReachDirection } from '../diagram/focus';
import { buildPresentationSteps } from './steps';
import type { PresentationStep } from './steps';

export { PRESENT_LOCK } from '../state/locks';
import { PRESENT_LOCK, VIEW_LOCK } from '../state/locks';
import { flowsFor } from '../workspace/lookup';
export const PRESENT_REFUSED = uiText("Feche o rascunho da IA ou a comparação antes de apresentar.");
export const PRESENT_BUSY = uiText("Aguarde a resposta da IA antes de apresentar.");
export const PRESENT_COMPARING = uiText("Aguarde a comparação com o Git terminar antes de apresentar.");

interface PresentState {
  active: boolean;
  steps: PresentationStep[];
  index: number;
  exploring: boolean;
  origin: string | null;
  direction: ReachDirection;
  flowSteps: PresentationStep[];
  flowIndex: number;
  playing: boolean;
}

export const presentStore = createStore<PresentState>()(() => ({ active: false, steps: [], index: 0, exploring: false, origin: null, direction: 'downstream', flowSteps: [], flowIndex: 0, playing: false }));

export function usePresent<T>(selector: (state: PresentState) => T): T {
  return useStore(presentStore, selector);
}

let entering = false;

/** Why the mode cannot start right now (a toast text), or null. Checked before and after the code-edit flush. */
function refusal(): string | null {
  // An answer arriving mid-presentation would want the same lock; a branch compare about to finish would too.
  if (aiStore.getState().status === 'loading') return PRESENT_BUSY;
  if (branchCompareStore.getState().status === 'loading') return PRESENT_COMPARING;
  // A read-only link may present: the lock it holds is the one it gets back on leaving.
  const lock = diagramStore.getState().readOnly;
  if (lock && lock !== VIEW_LOCK) return PRESENT_REFUSED;
  return null;
}

/**
 * Enters the mode; refused (with a toast) while an AI draft or a version/branch comparison holds the diagram.
 * Pending edits in the Código panel are committed first: the panel unmounts and its sync drops unsent text.
 */
export async function enterPresentation(): Promise<boolean> {
  if (presentStore.getState().active) return true;
  if (entering) return false;
  entering = true;
  try {
    const early = refusal();
    if (early) { showToast(early); return false; }
    await flushCodeEdits();
    const late = refusal();
    if (late) { showToast(late); return false; }
    if (presentStore.getState().active) return true;
    const diagram = diagramStore.getState();
    const slug = workspace.store.getState().diagram;
    const steps = buildPresentationSteps(diagram.model, flowsFor(workspace.store.getState().data, slug) || []);
    diagram.select({ nodes: [], edges: [] });
    diagram.setReadOnly(PRESENT_LOCK);
    uiStore.setState({ editingId: null, paletteOpen: false, presenting: true });
    presentStore.setState({ active: true, steps, index: 0 });
    return true;
  } finally {
    entering = false;
  }
}

/** Leaves the mode and always releases the lock it took (never one somebody else holds). */
export function exitPresentation(): void {
  const diagram = diagramStore.getState();
  if (diagram.readOnly === PRESENT_LOCK) diagram.setReadOnly(null);
  if (!presentStore.getState().active) return;
  presentStore.setState({ active: false, steps: [], index: 0, exploring: false, origin: null, direction: 'downstream', flowSteps: [], flowIndex: 0, playing: false });
  uiStore.setState({ presenting: false, activeFlowNodes: [], activeFlowEdges: [] });
}

// Whatever ends the canvas ends the mode: another diagram is a different presentation.
workspace.store.subscribe((state, prev) => {
  if (state.diagram !== prev.diagram) exitPresentation();
});
// A user-initiated switch would otherwise hit the read-only lock: leave the mode first, then the switch goes through.
workspace.onBeforeSwitch(() => exitPresentation());

export function togglePresentation(): void {
  if (presentStore.getState().active) exitPresentation();
  else void enterPresentation();
}

export function toggleFlowExploration(): void {
  const state = presentStore.getState();
  presentStore.setState({ exploring: !state.exploring, playing: false, origin: null, flowSteps: [], flowIndex: 0 });
}

export function selectPresentationComponent(id: string): void {
  const state = presentStore.getState();
  if (!state.active || !state.exploring) return;
  const flowSteps = componentFlow(diagramStore.getState().model, id, state.direction);
  presentStore.setState({ origin: id, flowSteps, flowIndex: 0, playing: flowSteps.length > 1 });
}

export function setPresentationDirection(direction: ReachDirection): void {
  const state = presentStore.getState();
  presentStore.setState({ direction });
  if (state.origin) selectPresentationComponent(state.origin);
}

export function toggleFlowPlayback(): void {
  const state = presentStore.getState();
  presentStore.setState({ playing: !state.playing, ...(state.flowIndex === state.flowSteps.length - 1 ? { flowIndex: 0 } : {}) });
}

export function goToStep(index: number): void {
  const { steps, index: current } = presentStore.getState();
  const next = Math.max(0, Math.min(steps.length - 1, index));
  if (next !== current) presentStore.setState({ index: next });
}

function moveStep(offset: number): void {
  const state = presentStore.getState();
  if (!state.exploring) return goToStep(state.index + offset);
  const flowIndex = Math.max(0, Math.min(state.flowSteps.length - 1, state.flowIndex + offset));
  presentStore.setState({ flowIndex, playing: false });
}
export const nextStep = () => moveStep(1);
export const prevStep = () => moveStep(-1);

/** Keys of the mode; returns true when handled. `interactive` is true when the key came from a button/link. */
export function handlePresentKey(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>, interactive = false): boolean {
  if (!presentStore.getState().active || event.metaKey || event.ctrlKey || event.altKey) return false;
  switch (event.key) {
    case 'Escape':
      exitPresentation();
      return true;
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
      nextStep();
      return true;
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
      prevStep();
      return true;
    case ' ':
      // A focused button keeps Space for itself (it activates it).
      if (interactive) return false;
      nextStep();
      return true;
    case 'Home':
      if (presentStore.getState().exploring) presentStore.setState({ flowIndex: 0, playing: false });
      else goToStep(0);
      return true;
    case 'End':
      if (presentStore.getState().exploring) presentStore.setState({ flowIndex: Math.max(0, presentStore.getState().flowSteps.length - 1), playing: false });
      else goToStep(presentStore.getState().steps.length - 1);
      return true;
    default:
      return false;
  }
}
