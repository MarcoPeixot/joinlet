import { COMMENT_LIMITS, liveMessages, liveThreads } from './comments';
import type { CommentMessage, CommentsFile, CommentThread } from './comments';

/** Names compare without case, accents or repeated spaces: "ana  SOUZA" is "Ana Souza", "Jose" is "José". */
export function normalizeName(name: string): string {
  return name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const WORD = /[\p{L}\p{N}_]/u;

/**
 * The people `text` @-mentions, among `names` (who is or was in the room): `@Ana Souza`, `@ana` (when "Ana" is a name),
 * not `email@ana.com` and not `@Anabela` for "Ana". The longest name wins at each `@`, so "Ana Souza" is not "Ana".
 * Returns the names as they are written in `names`, once each, in order of appearance.
 */
export function findMentions(text: string, names: readonly string[]): string[] {
  const known = [...new Set(names)]
    .map((name) => ({ name, key: normalizeName(name) }))
    .filter((entry) => entry.key)
    .sort((a, b) => b.key.length - a.key.length);
  const found: string[] = [];
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    if (at > 0 && WORD.test(text[at - 1]!)) continue;
    const rest = text.slice(at + 1, at + 1 + COMMENT_LIMITS.name + 10);
    for (const { name, key } of known) {
      // Compare the same number of characters the name has once normalized (accents can change the length).
      const candidate = takeNormalized(rest, key);
      if (candidate === null) continue;
      const after = rest[candidate];
      if (after !== undefined && WORD.test(after)) continue;
      if (!found.includes(name)) found.push(name);
      break;
    }
    if (found.length >= COMMENT_LIMITS.mentions) break;
  }
  return found;
}

/** The length of the prefix of `rest` whose normalized form is `key`, or null when `rest` does not start with it. */
function takeNormalized(rest: string, key: string): number | null {
  let used = 0;
  let out = '';
  while (used < rest.length && out.length < key.length) {
    used++;
    out = normalizeName(rest.slice(0, used));
    if (!key.startsWith(out)) return null;
  }
  return out === key ? used : null;
}

export const isMentioned = (message: CommentMessage, name: string): boolean => {
  const key = normalizeName(name);
  return !!key && message.deleted === undefined && !!message.mentions?.some((mention) => normalizeName(mention) === key);
};

export interface MentionsForYou {
  /** Open conversations with a message that @-mentions you, written by someone else. */
  threads: CommentThread[];
  /** Of those messages, the ones newer than `since`. */
  fresh: number;
}

/** The conversations that mention `name` (and the messages of others, not your own, newer than `since`). */
export function mentionsFor(file: CommentsFile, name: string, owner: string, since = 0): MentionsForYou {
  const threads: CommentThread[] = [];
  let fresh = 0;
  for (const thread of liveThreads(file)) {
    if (thread.status !== 'open') continue;
    const messages = liveMessages(thread).filter((message) => message.owner !== owner && isMentioned(message, name));
    if (!messages.length) continue;
    threads.push(thread);
    fresh += messages.filter((message) => Math.max(message.at, message.edited ?? 0) > since).length;
  }
  return { threads, fresh };
}

/** Everyone who wrote in the file (their latest name and color), for the mention list: they "were in the room". */
export function commentParticipants(file: CommentsFile): { name: string; color: string }[] {
  const people = new Map<string, { name: string; color: string; at: number }>();
  for (const thread of file.threads) {
    for (const message of thread.messages) {
      const known = people.get(normalizeName(message.author.name));
      if (!known || message.at >= known.at) people.set(normalizeName(message.author.name), { ...message.author, at: message.at });
    }
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name)).map(({ name, color }) => ({ name, color }));
}
