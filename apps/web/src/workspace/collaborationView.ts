import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { CollaborationClient, CollaborationStatus, Collaborator } from './collaboration';

const active = createStore<{ status: CollaborationStatus | null; peers: Collaborator[]; /** Everyone but this client. */ others: Collaborator[]; /** The room being shown (the open diagram's or doc's), to publish this client's presence. */ client: CollaborationClient | null; error: string | null; fatal: boolean; canUndo: boolean | null; canRedo: boolean | null }>()(() => ({ status: null, peers: [], others: [], client: null, error: null, fatal: false, canUndo: null, canRedo: null }));

export function useCollaborationView() { return useStore(active); }
/** A slice of the collaboration state: re-renders only when the slice changes (presence pointers move far faster than a list of names). */
export function useCollaborationSlice<T>(selector: (state: ReturnType<typeof active.getState>) => T): T { return useStore(active, selector); }
/** The same state without React (the comments read who is in the room from it). */
export const collaborationViewState = () => active.getState();
export function setCollaborationHistory(canUndo: boolean | null, canRedo: boolean | null) { active.setState({ canUndo, canRedo }); }

export function showCollaborationClient(client: CollaborationClient): () => void {
  const stop = client.subscribe(() => active.setState({ status: client.status, peers: client.peers, others: client.others, client, error: client.error, fatal: client.fatal }));
  return () => {
    stop();
    active.setState({ status: null, peers: [], others: [], client: null, error: null, fatal: false, canUndo: null, canRedo: null });
  };
}

/** Bumped when a room is rebuilt after a refused update; bound views remount on it and re-read the new doc. */
const epoch = createStore<{ n: number }>()(() => ({ n: 0 }));
export const bumpCollaborationEpoch = () => epoch.setState((s) => ({ n: s.n + 1 }));
export const useCollaborationEpoch = () => useStore(epoch, (s) => s.n);
