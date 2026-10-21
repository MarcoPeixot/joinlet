import { commentParticipants } from '@strukt/workspace';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { showToast } from '../ui/uiStore';
import { workspace } from '../workspace/appWorkspace';
import { collaborationSession } from '../workspace/boot';
import { renameCollaborator } from '../workspace/collaboration';
import { collaborationViewState } from '../workspace/collaborationView';
import { browserEnvironment, renameWho, resolveWho } from './identity';
import type { Who } from './identity';
import { mentionCandidates, rememberPeople, remembered } from './people';
import { createCommentsStore } from './store';
import type { CommentsState, CommentTarget } from './store';

const SEEN_KEY = 'strukt:comments-seen';

function local() { try { return globalThis.localStorage ?? null; } catch { return null; } }

function readSeen(): Record<string, number> {
  try {
    const raw: unknown = JSON.parse(local()?.getItem(SEEN_KEY) ?? '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, number] => typeof entry[1] === 'number')) : {};
  } catch { return {}; }
}

const seenKey = (key: string) => `${workspace.store.getState().source?.label ?? ''}|${key}`;

/** Bumped when this person renames themselves, so every view of "who am I" re-reads it. */
const identityVersion = createStore<{ n: number }>()(() => ({ n: 0 }));

/** Who is writing: the presence's name and color for a guest, a name chosen on this browser otherwise. */
export function currentWho(): Who {
  return resolveWho(browserEnvironment(collaborationSession()));
}

export function useWho(): Who {
  const version = useStore(identityVersion, (state) => state.n);
  return useMemo(() => currentWho(), [version]);
}

/** Sets the name shown in comments and, for a guest, in the presence list. Throws a pt-BR reason when it is not a name. */
export function setCommentName(name: string): void {
  renameWho(browserEnvironment(collaborationSession()), name);
  const { name: saved } = currentWho();
  renameCollaborator(saved);
  identityVersion.setState((state) => ({ n: state.n + 1 }));
}

const randomId = () => (globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 20) ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

/** Who can be @-mentioned right now: the room, whoever commented here, and people seen in rooms before. */
export function currentCandidates(query?: string, file = comments.store.getState().file) {
  const who = currentWho();
  const storage = local();
  const present = collaborationViewState().others.map(({ name, color }) => ({ name, color }));
  return mentionCandidates({ present, authors: commentParticipants(file), seen: storage ? remembered(storage) : [], self: who.name, query });
}

export const comments = createCommentsStore({
  adapter: () => workspace.storage(),
  who: currentWho,
  now: Date.now,
  newId: randomId,
  every: (ms, fn) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
  visible: () => globalThis.document?.visibilityState !== 'hidden',
  notify: (message) => showToast(message),
  seen: {
    get: (key) => readSeen()[seenKey(key)] ?? 0,
    set: (key, at) => {
      try { local()?.setItem(SEEN_KEY, JSON.stringify({ ...readSeen(), [seenKey(key)]: at })); } catch { /* storage may be blocked */ }
    },
  },
  names: () => currentCandidates().map((person) => person.name),
});

export function useComments<T>(selector: (state: CommentsState) => T): T {
  return useStore(comments.store, selector);
}

/** The open item as a comments target (`null` for a sketch or the board, which have no comments). */
export function targetOf(view: { kind: string; slug?: string }, diagram: string | null): CommentTarget | null {
  if (view.kind === 'diagram' && diagram) return { kind: 'diagram', slug: diagram };
  if (view.kind === 'doc' && view.slug) return { kind: 'doc', slug: view.slug };
  return null;
}

/** Remembers the people seen in the room, for the mention list of later sessions. */
export function rememberRoom(): void {
  const people = collaborationViewState().others.map(({ name, color }) => ({ name, color }));
  const storage = local();
  if (people.length && storage) rememberPeople(storage, people);
}
