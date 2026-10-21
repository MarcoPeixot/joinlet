import type { ID } from './model';

/** Assigning `obj['__proto__']` replaces the object's prototype, so it can never name an element. */
export const RESERVED_NAME = '__proto__';

/**
 * `record[key]` when `key` is the record's own property. Element names are user text: a plain
 * lookup of "constructor" or "toString" would find Object.prototype members instead of nothing.
 */
export function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export function uniqueName(base: string, taken: (name: string) => boolean): string {
  const root = base.trim() || 'Nó';
  if (!taken(root)) return root;
  const stem = root.replace(/ \d+$/, '');
  for (let i = 2; ; i++) {
    const candidate = `${stem} ${i}`;
    if (!taken(candidate)) return candidate;
  }
}

export function edgeId(from: ID, to: ID, taken: ReadonlySet<string>): ID {
  const base = `${from}→${to}`;
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}#${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}
