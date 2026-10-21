import type { StorageAdapter } from '@strukt/workspace';

export interface ExternalWatcher {
  start(): void;
  stop(): void;
  /** Resets the baseline to what is on disk now (after a save or a reload, the disk matches the app). */
  resync(): Promise<void>;
}

export interface ExternalWatcherOptions {
  /** The adapter of the open workspace; `null` when none is open. */
  adapter: () => StorageAdapter | null;
  /** Called with the paths that changed on disk since the last baseline. */
  onChanges(files: string[]): void;
  /** Base poll interval; doubles while nothing changes. */
  intervalMs?: number;
  /** Back-off ceiling (default 8x the base: 4 s -> 32 s). */
  maxIntervalMs?: number;
  /** `document.visibilityState` source; tests inject one. */
  isVisible?: () => boolean;
  /** Subscribes `wake` to "the user is back" (tab visible, window focused); returns the unsubscribe. Tests inject one. */
  onWake?: (wake: () => void) => () => void;
  timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
}

/** `versions/`, `context/` and `comments/` are written by the app itself (or by guests, and read by their own poll), so they are not watched. */
export function isWatchedPath(path: string): boolean {
  return !path.startsWith('versions/') && !path.startsWith('context/') && !path.startsWith('comments/');
}

const watched = (stamps: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(stamps).filter(([path]) => isWatchedPath(path)));

const browserWake = (wake: () => void): (() => void) => {
  const onVisible = () => { if (globalThis.document?.visibilityState !== 'hidden') wake(); };
  globalThis.document?.addEventListener('visibilitychange', onVisible);
  globalThis.addEventListener?.('focus', wake);
  return () => {
    globalThis.document?.removeEventListener('visibilitychange', onVisible);
    globalThis.removeEventListener?.('focus', wake);
  };
};

/** Paths whose stamp appeared, vanished or changed between two snapshots. */
export function changedFiles(before: Readonly<Record<string, number>>, after: Readonly<Record<string, number>>): string[] {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...paths]
    .filter((path) => !Object.hasOwn(before, path) || !Object.hasOwn(after, path) || before[path] !== after[path])
    .sort();
}

const DEFAULT_INTERVAL = 4000;

/**
 * Notices when something else (an agent, the git checkout, another editor) writes into the open
 * folder workspace: it compares the file stamps of `.arch/` with the ones it last saw. Adapters
 * without `stamps()` (IndexedDB, memory) simply have no watcher. The app calls `resync()` after every
 * save, so its own writes never look external.
 */
export function createExternalWatcher(options: ExternalWatcherOptions): ExternalWatcher {
  const baseMs = options.intervalMs ?? DEFAULT_INTERVAL;
  const maxMs = Math.max(baseMs, options.maxIntervalMs ?? baseMs * 8);
  // Bound to `globalThis`: a bare `setTimeout` destructured into an object throws "Illegal invocation".
  const timers = options.timers ?? {
    setTimeout: (handler: () => void, timeout: number) => globalThis.setTimeout(handler, timeout),
    clearTimeout: (id: ReturnType<typeof globalThis.setTimeout>) => globalThis.clearTimeout(id),
  };
  const isVisible = options.isVisible ?? (() => globalThis.document?.visibilityState !== 'hidden');
  const onWake = options.onWake ?? browserWake;
  let baseline: Record<string, number> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  let running = false;
  let currentMs = baseMs;
  let polling = false;

  /** Resolves true when the poll completed and found something new. */
  const poll = async (): Promise<boolean | null> => {
    const adapter = options.adapter();
    const stamps = adapter?.stamps;
    if (!adapter || !stamps || polling || !isVisible()) return null;
    polling = true;
    try {
      const next = watched(await stamps.call(adapter));
      if (baseline === null) {
        baseline = next;
        return false;
      }
      const changed = changedFiles(baseline, next);
      baseline = next;
      if (changed.length) options.onChanges(changed);
      return changed.length > 0;
    } catch {
      // A transient read failure (permission flap, folder moved) must not spam the UI; the next poll retries.
      return null;
    } finally {
      polling = false;
    }
  };

  const schedule = () => {
    if (!running) return;
    if (timer) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => void tick(), currentMs);
  };

  const tick = async () => {
    const changed = await poll();
    // Only a completed poll that found nothing backs off; a hidden tab or a failure keeps the rhythm.
    if (changed === true) currentMs = baseMs;
    else if (changed === false) currentMs = Math.min(currentMs * 2, maxMs);
    schedule();
  };

  const wake = () => {
    if (!running) return;
    currentMs = baseMs;
    if (timer) timers.clearTimeout(timer);
    void poll().then(schedule); // the check on return does not count towards the back-off: the next one is in `baseMs`
  };

  return {
    start() {
      if (running) return;
      running = true;
      baseline = null;
      currentMs = baseMs;
      unsubscribe = onWake(wake);
      schedule();
      void poll();
    },
    stop() {
      running = false;
      if (timer) timers.clearTimeout(timer);
      timer = undefined;
      unsubscribe?.();
      unsubscribe = undefined;
    },
    async resync() {
      const adapter = options.adapter();
      if (!adapter?.stamps) return;
      try {
        baseline = watched(await adapter.stamps.call(adapter));
      } catch {
        baseline = null; // the next poll starts a fresh baseline
      }
    },
  };
}
