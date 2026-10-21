import type { EditorView } from '@codemirror/view';

type Listener = () => void;
let current: EditorView | null = null;
let currentSlug: string | null = null;
const listeners = new Set<Listener>();

/**
 * Where the doc editor and the comments meet without importing each other: the editor registers its view here, and the
 * comments chunk (loaded on demand) registers what the editor's "Comentar" button and a click on a marked passage call.
 */
export const docCommentBridge = {
  get view(): EditorView | null { return current; },
  get slug(): string | null { return currentSlug; },
  setView(view: EditorView | null, slug: string | null = null): void {
    current = view;
    currentSlug = view ? slug : null;
    for (const listener of listeners) listener();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  /** Starts a comment on the editor's selection. */
  comment: null as (() => void) | null,
  /** Opens the conversation of a passage that was clicked. */
  open: null as ((id: string) => void) | null,
};
