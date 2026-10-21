import { uiText } from '../i18n';
const WORD = /[\p{L}\p{N}_]/u;
const MAX_QUERY = 30;

/** The `@name` being typed just before `caret`: where its `@` is and what follows it, or null when there is none. */
export function mentionQuery(text: string, caret: number): { at: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1) return null;
  if (at > 0 && WORD.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  if (query.length > MAX_QUERY || query.includes("\n") || /\s{2}/.test(query) || query.split(' ').length > 2) return null;
  return { at, query };
}

/** The text with `@query` (from `at` to `caret`) replaced by the whole `@name `, and where the caret goes. */
export function applyMention(text: string, at: number, caret: number, name: string): { text: string; caret: number } {
  const inserted = `@${name} `;
  return { text: `${text.slice(0, at)}${inserted}${text.slice(caret)}`, caret: at + inserted.length };
}
