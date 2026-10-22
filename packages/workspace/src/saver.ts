import { MANIFEST_PATH } from './manifest';
import type { StorageAdapter } from './storage';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';
/** Text to write, `null` to remove the file; a function is evaluated when its batch is written, not when scheduled. */
export type FileContent = string | null | (() => string | null);

export interface Saver {
  /** Queues `path`; everything queued is written `delay` ms after the last call. */
  schedule(path: string, content: FileContent): void;
  /** Writes everything queued now (switching items, closing the tab). */
  flush(): Promise<void>;
  /** Contents known to be on disk: writing the same text again is skipped. */
  seed(files: Readonly<Record<string, string>>): void;
  /** Forgets what is known to be on disk: every file scheduled afterwards is written, even unchanged text. */
  forget(): void;
  /** After "não salvo": try again from the first attempt. */
  retry(): Promise<void>;
  /**
   * Drops everything queued without writing it (status back to 'saved'). Used when the app reloads
   * from disk: those writes are stale and would overwrite what someone else wrote there.
   */
  cancel(): void;
  readonly status: SaveStatus;
  /** pt-BR reason of the last failure (status 'error'). */
  readonly error: string | null;
  hasPending(): boolean;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export interface SaverOptions {
  /** Completion of actual writes; cancellation and unchanged files do not trigger this. */
  onSettled?(status: 'saved' | 'error'): void;
  delay?: number;
  /** Automatic retries before giving up with status 'error'. */
  retries?: number;
  retryDelay?: number;
}

/** Order inside one flush, by the resolved text: item files, then the manifest, then removals. */
function rank(path: string, text: string | null): number {
  if (text === null) return 2;
  return path === MANIFEST_PATH ? 1 : 0;
}

const failure = (path: string, err: unknown) => `Não foi possível salvar ${path}: ${err instanceof Error ? err.message : String(err)}`;

/** Debounced autosave (spec §9/§11): one file per write, retries, and a status for the "não salvo" indicator. */
export function createSaver(adapter: StorageAdapter, options: SaverOptions = {}): Saver {
  const delay = options.delay ?? 400;
  const retries = options.retries ?? 2;
  const retryDelay = options.retryDelay ?? 1000;
  const queue = new Map<string, FileContent>();
  const known = new Map<string, string>();
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();
  let failures = 0;
  let status: SaveStatus = 'saved';
  let error: string | null = null;
  let disposed = false;

  const settled = (value: 'saved' | 'error') => {
    try { options.onSettled?.(value); } catch { /* Observers cannot break persistence or future flushes. */ }
  };

  const setStatus = (next: SaveStatus, reason: string | null = null) => {
    if (next === status && reason === error) return;
    status = next;
    error = reason;
    for (const listener of listeners) listener();
  };

  const arm = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), ms);
  };

  const run = async () => {
    if (!queue.size || disposed) return;
    setStatus('saving');
    const taken = [...queue];
    queue.clear();
    let failed: string | null = null;
    let written = false;
    /** Lowest rank that failed: nothing ranked after it is attempted (the manifest never lists a file that isn't written). */
    let blocked = Infinity;
    const requeue = (path: string, content: FileContent) => {
      if (!queue.has(path)) queue.set(path, content);
    };
    // Lazy content is resolved once, up front, so it is ranked by what it actually is (a removal or a write).
    const batch: { path: string; content: FileContent; text: string | null; rank: number }[] = [];
    for (const [path, content] of taken) {
      try {
        const text = typeof content === 'function' ? content() : content;
        batch.push({ path, content, text, rank: rank(path, text) });
      } catch (err) {
        requeue(path, content);
        failed ??= failure(path, err);
        blocked = Math.min(blocked, rank(path, '')); // unresolved: ranked as a write of that path
      }
    }
    batch.sort((a, b) => a.rank - b.rank);
    for (const { path, content, text, rank: order } of batch) {
      if (order > blocked) {
        requeue(path, content);
        continue;
      }
      try {
        if (text === null) {
          await adapter.remove(path);
          written = true;
          known.delete(path);
        } else if (known.get(path) !== text) {
          await adapter.write(path, text);
          written = true;
          known.set(path, text);
        }
      } catch (err) {
        requeue(path, content);
        failed ??= failure(path, err);
        blocked = Math.min(blocked, order);
      }
    }
    if (disposed) return;
    if (failed) {
      failures++;
      if (failures <= retries) {
        setStatus('pending');
        arm(retryDelay * failures);
      } else {
        clearTimeout(timer);
        setStatus('error', failed);
        settled('error');
      }
      return;
    }
    failures = 0;
    setStatus(queue.size ? 'pending' : 'saved');
    if (written && !queue.size) settled('saved');
  };

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    chain = chain.then(run);
    return chain;
  };

  return {
    schedule(path, content) {
      if (disposed) return;
      queue.set(path, content);
      if (status !== 'error') setStatus('pending');
      if (status !== 'error' || failures === 0) arm(delay);
    },
    flush,
    seed(files) {
      for (const [path, text] of Object.entries(files)) known.set(path, text);
    },
    forget() {
      known.clear();
    },
    retry() {
      failures = 0;
      error = null;
      return flush();
    },
    cancel() {
      queue.clear();
      clearTimeout(timer);
      timer = undefined;
      failures = 0;
      setStatus('saved');
    },
    get status() {
      return status;
    },
    get error() {
      return error;
    },
    hasPending: () => queue.size > 0 || status === 'saving',
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      listeners.clear();
    },
  };
}
