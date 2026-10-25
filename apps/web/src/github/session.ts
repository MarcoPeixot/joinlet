import { useStore } from 'zustand';
import { closeRightPanel, showToast, toggleRightPanel, uiStore } from '../ui/uiStore';
import { workspace } from '../workspace/appWorkspace';
import { githubClient } from './client';
import { createGithubStore } from './store';
import type { GithubState } from './store';
import { catalogStore, showProjects } from '../workspace/catalog';

/** localStorage for the repo path; the browser never reveals the folder's absolute path by itself. */
const storage = {
  get: (key: string) => globalThis.localStorage?.getItem(key) ?? null,
  set: (key: string, value: string) => globalThis.localStorage?.setItem(key, value),
};

export const githubStore = createGithubStore({ client: githubClient, notify: showToast, storage });

export function useGithub<T>(selector: (state: GithubState) => T): T {
  return useStore(githubStore, selector);
}

// `rightPanel` owns whether the panel is shown; `githubStore.open` mirrors it (both directions are idempotent,
// so they settle immediately). Opening through the store also refreshes the status.
uiStore.subscribe((state, prev) => {
  if (state.rightPanel === prev.rightPanel) return;
  const open = state.rightPanel === 'github';
  if (githubStore.getState().open !== open) githubStore.getState().setOpen(open);
});
githubStore.subscribe((state, prev) => {
  if (state.open === prev.open) return;
  if (state.open) {
    if (uiStore.getState().rightPanel !== 'github') uiStore.setState({ rightPanel: 'github' });
  } else closeRightPanel('github');
});

/** The "GitHub" button and command. */
export function toggleGithub(): void {
  toggleRightPanel('github');
}

/** Cloud connections are also available before the first diagram is created. */
export function openGithub(): void {
  if(catalogStore.getState().cloud) {
    catalogStore.setState({open:false,repositoryOpen:false});
    githubStore.getState().setOpen(true);
    return;
  }
  const { view, diagram } = workspace.store.getState();
  if (view.kind === 'diagram') {
    githubStore.getState().setOpen(true);
    return;
  }
  if (!diagram) {
    showProjects();
    catalogStore.setState({ repositoryOpen: true });
    return;
  }
  void workspace.show({ kind: 'diagram' }).then(
    () => { if (workspace.store.getState().view.kind === 'diagram') githubStore.getState().setOpen(true); },
    (cause) => showToast(cause instanceof Error ? cause.message : String(cause)),
  );
}

export function closeGithub(): void {
  githubStore.getState().setOpen(false);
}

/** Pending `.arch/` changes, for the TopBar badge. */
export const githubChangeCount = (state: GithubState): number => state.changes.length;

const POLL_MS = 20_000;

// The badge stays fresh while the app is open: a quiet poll that never toasts nor flickers.
if (typeof window !== 'undefined' && typeof window.setInterval === 'function') {
  window.setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    const state = githubStore.getState();
    if (!state.repoPath || state.status === 'loading' || state.publishing) return;
    void state.refresh({ quiet: true });
  }, POLL_MS);
}
