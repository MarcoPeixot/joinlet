import { uiText } from '../i18n';
import { liveThreads, mentionsFor } from '@strukt/workspace';
import type { CommentsState } from './store';
import { targetKey } from './store';

export interface CommentCounts {
  /** Open conversations in the open item. */
  open: number;
  /** Open conversations, anywhere in the workspace, that others wrote to mention you in. */
  mentions: number;
}

/** What the top bar shows: the open item is read live, the other items from the last scan. */
export function commentCounts(state: Pick<CommentsState, 'file' | 'target' | 'summary'>, who: { name: string; owner: string }): CommentCounts {
  const current = state.target ? targetKey(state.target) : null;
  const open = liveThreads(state.file).filter((thread) => thread.status === 'open').length;
  const elsewhere = Object.entries(state.summary).reduce((total, [key, entry]) => total + (key === current ? 0 : entry.mentions), 0);
  return { open, mentions: (current ? mentionsFor(state.file, who.name, who.owner).threads.length : 0) + elsewhere };
}

/** The same counts in words, for a screen reader (and the tooltip): empty when there is nothing to say. */
export function describeCounts({ open, mentions }: CommentCounts): string {
  const parts: string[] = [];
  if (mentions) parts.push(uiText("{0} {1} para você", [mentions, mentions === 1 ? uiText("menção") : uiText("menções")]));
  if (open) parts.push(`${open} ${open === 1 ? uiText("conversa aberta") : uiText("conversas abertas")}`);
  return parts.join(', ');
}
