import { resolveTextAnchor } from '@strukt/workspace';
import type { CommentThread, ResolvedText } from '@strukt/workspace';

/** Where each conversation's passage is in the doc now (null: the passage is gone). Only the doc's own anchors count. */
export function resolveDocThreads(text: string, threads: readonly CommentThread[]): Map<string, ResolvedText | null> {
  const found = new Map<string, ResolvedText | null>();
  for (const thread of threads) if (thread.anchor.type === 'text') found.set(thread.id, resolveTextAnchor(text, thread.anchor));
  return found;
}
