import { useStore } from 'zustand';
import { flushCodeEdits } from '../code/registry';
import { diagramStore } from '../state/appStore';
import { showToast, uiStore } from '../ui/uiStore';
import { versionStore } from '../versions/session';
import { workspace } from '../workspace/appWorkspace';
import { createTimelineStore } from './timelineStore';
import type { TimelineState } from './timelineStore';

/** The time axis of the diagram open in the workspace. Loaded with the "Linha do tempo" panel, never at startup. */
export const timelineStore = createTimelineStore({
  versions: versionStore,
  diagram: diagramStore,
  target: () => ({ slug: workspace.store.getState().diagram, storage: workspace.storage() }),
  flushCode: flushCodeEdits,
  notify: showToast,
});

// Leaving the panel (another panel, closing it, a workspace switch) ends the comparison it drew and its dialog.
uiStore.subscribe((state, prev) => {
  if (prev.rightPanel !== 'timeline' || state.rightPanel === 'timeline') return;
  timelineStore.getState().stop();
  versionStore.getState().setPlanDialogOpen(false);
});
workspace.onBeforeSwitch(() => timelineStore.getState().stop());

export function useTimeline<T>(selector: (state: TimelineState) => T): T {
  return useStore(timelineStore, selector);
}
