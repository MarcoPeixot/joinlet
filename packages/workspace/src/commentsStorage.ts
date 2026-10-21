import { CommentError, applyCommentOp, parseComments, printComments } from './comments';
import type { CommentOp, CommentsFile, ParsedComments } from './comments';
import { commentsPath, parseCommentsPath } from './commentsPath';
import type { CommentKind } from './commentsPath';
import { StorageConflict } from './storage';
import type { StorageAdapter } from './storage';

export async function readComments(adapter: StorageAdapter, kind: CommentKind, slug: string): Promise<ParsedComments & { text: string | null }> {
  const text = await adapter.read(commentsPath(kind, slug));
  return { ...parseComments(text, kind), text };
}

/** Every comments file of the workspace, by item. */
export function listCommentFiles(paths: readonly string[]): { kind: CommentKind; slug: string; path: string }[] {
  return paths.flatMap((path) => {
    const parsed = parseCommentsPath(path);
    return parsed ? [{ ...parsed, path }] : [];
  });
}

export interface CommitResult {
  /** The file as written (or as it already was when the changes were already in it). */
  file: CommentsFile;
  text: string;
  /** Changes that could not be applied (a limit): the rest went through. */
  refused: CommentError[];
}

/**
 * Writes `ops` into the item's comments file. Everyone does it the same way: read the file as it is now, apply the
 * changes on top, write it back; when the write is refused because the file changed meanwhile (`StorageConflict`),
 * read again and redo it (changes are replayable, so what already got in is not duplicated). Three people commenting at
 * once end up with all three comments. A file that is not readable (broken) is never overwritten.
 */
export async function commitComments(adapter: StorageAdapter, kind: CommentKind, slug: string, ops: readonly CommentOp[], options: { attempts?: number; wait?: (attempt: number) => Promise<void> } = {}): Promise<CommitResult> {
  const path = commentsPath(kind, slug);
  const attempts = options.attempts ?? 6;
  for (let attempt = 1; ; attempt++) {
    const text = await adapter.read(path);
    const parsed = parseComments(text, kind);
    if (parsed.broken) throw new CommentError(`${parsed.warnings[0]} Corrija ou apague .arch/${path} antes de comentar.`);
    let file = parsed.file;
    const refused: CommentError[] = [];
    for (const op of ops) {
      try { file = applyCommentOp(file, op); }
      catch (error) {
        if (!(error instanceof CommentError)) throw error;
        refused.push(error);
      }
    }
    const next = printComments(file);
    if (printComments(parsed.file) === next) return { file, text: text ?? next, refused };
    try { await adapter.write(path, next); }
    catch (error) {
      if (error instanceof StorageConflict && attempt < attempts) {
        await options.wait?.(attempt);
        continue;
      }
      throw error;
    }
    return { file, text: next, refused };
  }
}
