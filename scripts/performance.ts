/** Functional checks always run; timing gates run separately on an otherwise idle CI runner. */
export function measured<T>(work: () => T, milliseconds: number): T {
  const enabled = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.JOINLET_PERFORMANCE_TESTS === '1';
  const result = work();
  if (!enabled) return result;
  const times = Array.from({ length: 3 }, () => {
    const start = performance.now();
    work();
    return performance.now() - start;
  }).sort((a, b) => a - b);
  if (times[1]! >= milliseconds) throw Error(`Performance median ${times[1]!.toFixed(1)} ms exceeds ${milliseconds} ms (${times.map(t => t.toFixed(1)).join(', ')}).`);
  return result;
}
