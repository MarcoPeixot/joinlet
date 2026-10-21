import type { StorageAdapter } from './storage';

/**
 * Where an item's comments live. Kept apart from the comment format on purpose: the app's first load needs only these
 * names (to clean up after a deleted item), and nothing else of the comments code.
 */
export const COMMENTS_DIR = 'comments';
export type CommentKind = 'diagram' | 'doc';

const SLUG = '[A-Za-z0-9][A-Za-z0-9_-]*';

export const commentsPath = (kind: CommentKind, slug: string): string => `${COMMENTS_DIR}/${kind}-${slug}.json`;

export function parseCommentsPath(path: string): { kind: CommentKind; slug: string } | null {
  const match = new RegExp(`^${COMMENTS_DIR}/(diagram|doc)-(${SLUG})\\.json$`).exec(path);
  return match ? { kind: match[1] as CommentKind, slug: match[2]! } : null;
}

/** Removes the comments of a deleted item (a missing file is not an error). */
export async function removeComments(adapter: Pick<StorageAdapter, 'remove'>, kind: CommentKind, slug: string): Promise<void> {
  await adapter.remove(commentsPath(kind, slug));
}
