import { COMMENT_LIMITS, normalizeName } from '@strukt/workspace';

export interface Person { name: string; color: string }
export interface Candidate extends Person { /** In the room right now. */ here: boolean }

const KEY = 'strukt:people';
const KEPT = 30;
const SHOWN = 50;
const COLOR = /^#[0-9a-fA-F]{6}$/;
interface Storage_ { getItem(key: string): string | null; setItem(key: string, value: string): void }

const valid = (value: unknown): value is Person => {
  if (!value || typeof value !== 'object') return false;
  const { name, color } = value as Record<string, unknown>;
  return typeof name === 'string' && !!name.trim() && name.length <= COMMENT_LIMITS.name && name !== '__proto__' && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(name) && typeof color === 'string' && COLOR.test(color);
};

/** The people this browser has seen in a room before (newest first), for the mention list. */
export function remembered(storage: Storage_): Person[] {
  try {
    const raw: unknown = JSON.parse(storage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(valid).slice(0, KEPT).map(({ name, color }) => ({ name, color })) : [];
  } catch { return []; }
}

export function rememberPeople(storage: Storage_, people: readonly Person[]): void {
  const known = new Set<string>();
  const merged = [...people, ...remembered(storage)].filter((person) => {
    const key = normalizeName(person.name);
    if (!key || known.has(key) || !valid(person)) return false;
    known.add(key);
    return true;
  });
  try { storage.setItem(KEY, JSON.stringify(merged.slice(0, KEPT))); } catch { /* storage may be blocked */ }
}

/**
 * Who a `@` can name: the people in the room now, then the people who commented in this item, then the ones seen in
 * rooms before. One entry per person (by normalized name), never yourself. `query` is what was typed after the `@`:
 * names that start with it come first, then the ones where a word starts with it.
 */
export function mentionCandidates(input: { present: readonly Person[]; authors: readonly Person[]; seen: readonly Person[]; self: string; query?: string }): Candidate[] {
  const self = normalizeName(input.self);
  const list = new Map<string, Candidate>();
  const add = (people: readonly Person[], here: boolean) => {
    for (const person of people) {
      const key = normalizeName(person.name);
      if (!key || key === self || list.has(key)) continue;
      list.set(key, { name: person.name, color: person.color, here });
    }
  };
  add(input.present, true);
  add(input.authors, false);
  add(input.seen, false);
  const query = normalizeName(input.query ?? '');
  const all = [...list.entries()];
  if (!query) return all.map(([, candidate]) => candidate).slice(0, SHOWN);
  const starts = all.filter(([key]) => key.startsWith(query));
  const words = all.filter(([key]) => !key.startsWith(query) && key.split(' ').some((word) => word.startsWith(query)));
  return [...starts, ...words].map(([, candidate]) => candidate).slice(0, SHOWN);
}
