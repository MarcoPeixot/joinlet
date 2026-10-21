const KEY = 'strukt:recent-commands';
const LIMIT = 5;

/** Ids of the last commands run from the palette, most recent first. Never throws (storage may be blocked). */
export function readRecents(): string[] {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string').slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

export function pushRecent(id: string): void {
  const next = [id, ...readRecents().filter((other) => other !== id)].slice(0, LIMIT);
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    // recents are a convenience
  }
}
