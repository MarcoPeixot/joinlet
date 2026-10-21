import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/**
 * The right dock: a column beside the canvas that the slot's panels render into (see `SidePanel`), so the canvas
 * gives up the room instead of sitting under them. `count` is how many panels are mounted in it (one still counts
 * while it fades out), which is what opens and closes the column.
 */
export const dockStore = createStore<{ target: HTMLElement | null; count: number }>(() => ({ target: null, count: 0 }));

/** The ref callback of the dock's mount point. */
export function setDockTarget(target: HTMLElement | null): void {
  dockStore.setState({ target });
}

/** A panel entered the dock; the returned function is its leave. */
export function enterDock(): () => void {
  dockStore.setState((s) => ({ count: s.count + 1 }));
  return () => dockStore.setState((s) => ({ count: Math.max(0, s.count - 1) }));
}

export function useDockOpen(): boolean {
  return useStore(dockStore, (s) => s.count > 0);
}
