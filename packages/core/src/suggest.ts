export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Closest candidates within a typo-sized distance, best first. */
export function suggest(name: string, candidates: Iterable<string>, max = 1): string[] {
  const needle = name.toLowerCase();
  const scored: [string, number][] = [];
  for (const candidate of candidates) {
    const distance = levenshtein(needle, candidate.toLowerCase());
    if (distance <= Math.max(2, Math.floor(candidate.length / 3))) scored.push([candidate, distance]);
  }
  return scored
    .sort((x, y) => x[1] - y[1])
    .slice(0, max)
    .map(([candidate]) => candidate);
}
