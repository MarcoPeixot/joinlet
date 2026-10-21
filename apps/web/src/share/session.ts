import { useStore } from 'zustand';
import { lazyShareClient } from './lazyClient';
import { createShareStore } from './store';
import type { ShareState } from './store';

// The client (reply validators) loads on first use, not with the top bar.
export const shareStore = createShareStore({ client: lazyShareClient(() => import('./client').then((m) => m.shareClient)) });

export function useShare<T>(selector: (state: ShareState) => T): T {
  return useStore(shareStore, selector);
}

export const openShare = () => shareStore.getState().setOpen(true);
export const closeShare = () => shareStore.getState().setOpen(false);
