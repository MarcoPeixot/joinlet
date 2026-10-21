import type { Perspective } from '@strukt/workspace';

/** The perspective without what is empty or the default, so the saved file stays short and diffs stay small. */
export function compact(perspective: Perspective): Perspective {
  const next: Perspective = { ...perspective };
  for (const key of ['tags', 'levels', 'include', 'hide', 'collapsed'] as const) if (!next[key]?.length) delete next[key];
  if (next.mode !== 'dim') delete next.mode;
  if (!next.collapse) delete next.collapse;
  if (!next.description) delete next.description;
  return next;
}

/** `list` with `value` added, or removed when it is already there. */
export function flip<T>(list: readonly T[] | undefined, value: T): T[] {
  const current = list ?? [];
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}
