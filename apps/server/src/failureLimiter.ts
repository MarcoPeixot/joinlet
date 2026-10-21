export interface FailureLimiterOptions {
  /** Failures allowed within the window before the caller is blocked. */
  limit?: number;
  windowMs?: number;
  now?(): number;
  /** Callers remembered at once; the oldest are dropped past it. */
  maxKeys?: number;
}

/**
 * Sliding-window counter of failed token attempts per caller (an IP). A blocked caller is refused before its token is
 * even looked at, so guessing is capped; failures made while blocked are not counted (the block ends when the oldest
 * counted failure leaves the window).
 */
export function createFailureLimiter({ limit = 10, windowMs = 600_000, now = Date.now, maxKeys = 10_000 }: FailureLimiterOptions = {}) {
  const failures = new Map<string, number[]>();
  /** What each counted failure was about, so the same subject is counted once per window. */
  const subjects = new Map<string, Map<string, number>>();

  const recent = (key: string): number[] => {
    const list = failures.get(key);
    if (!list) return [];
    const from = now() - windowMs;
    const kept = list.filter((at) => at > from);
    if (kept.length) failures.set(key, kept);
    else failures.delete(key);
    return kept;
  };

  return {
    /** Seconds until the caller may try again; 0 when it is not blocked. */
    blocked(key: string): number {
      const list = recent(key);
      if (list.length < limit) return 0;
      return Math.max(1, Math.ceil((list[0]! + windowMs - now()) / 1000));
    },
    /**
     * `subject` (a token the caller sent) is counted once per window: a browser that keeps sending the same stale
     * cookie is one wrong token, not a guessing run.
     */
    fail(key: string, subject?: string): void {
      const list = recent(key);
      if (list.length >= limit) return;
      if (subject !== undefined) {
        const seen = subjects.get(key) ?? new Map<string, number>();
        const from = now() - windowMs;
        for (const [known, at] of seen) if (at <= from) seen.delete(known);
        if (seen.has(subject)) return;
        seen.set(subject, now());
        subjects.delete(key);
        subjects.set(key, seen);
        while (subjects.size > maxKeys) subjects.delete(subjects.keys().next().value as string);
      }
      list.push(now());
      failures.delete(key);
      failures.set(key, list); // re-inserted last: Map order is "least recently failed first"
      while (failures.size > maxKeys) failures.delete(failures.keys().next().value as string);
    },
    size: () => failures.size,
  };
}

export type FailureLimiter = ReturnType<typeof createFailureLimiter>;
