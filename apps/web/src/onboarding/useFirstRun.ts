import { uiText } from '../i18n';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { useDiagram } from '../state/appStore';
import type { DiagramState } from '../state/diagramStore';
import { useUi } from '../ui/uiStore';
import { useWorkspace, workspace } from '../workspace/appWorkspace';
import { firstRunSeen, markFirstRunSeen, shouldShowFirstRun } from './firstRun';
import { LEGACY_WORKSPACE, useCatalog } from '../workspace/catalog';

/** The open diagram is empty and editable: the canvas shows its "Descreva sua arquitetura" card. */
export const startCardShown = (s: DiagramState): boolean => s.model.order.length === 0 && s.readOnly === null;

/** The start card is on screen (a diagram view, not presenting). */
export function useStartCardVisible(): boolean {
  const onDiagram = useWorkspace((s) => s.view.kind === 'diagram');
  const presenting = useUi((s) => s.presenting);
  return useDiagram(startCardShown) && onDiagram && !presenting;
}

const BROWSER_WORKSPACE = uiText("Navegador");

/** Shared by the first-run note and the checklist, so dismissing one hands over to the other in the same frame. */
const seenStore = createStore<{ seen: boolean }>()(() => ({ seen: firstRunSeen() }));

export function dismissFirstRun(): void {
  markFirstRunSeen();
  seenStore.setState({ seen: true });
}

/** The first-run note is up: the pristine sample of the built-in browser workspace, not yet dismissed. */
export function useFirstRunVisible(): boolean {
  const slug = useWorkspace((s) => (s.view.kind === 'diagram' ? s.diagram : null));
  const isSampleWorkspace = useWorkspace(() => workspace.storage()?.label === BROWSER_WORKSPACE);
  const isLegacy = useCatalog((s) => s.activeId === null || s.activeId === LEGACY_WORKSPACE);
  const seen = useStore(seenStore, (s) => s.seen);
  // A boolean selector: edits re-render only when the answer flips.
  return useDiagram((s) => shouldShowFirstRun({ slug, model: s.model, flag: seen, isSampleWorkspace: isSampleWorkspace && isLegacy }));
}
