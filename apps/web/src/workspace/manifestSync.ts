import { uiText } from '../i18n';
import type { ManifestUpdate, RemoteAdapter } from './remote';
import type { RemovedItem } from './workspace';

const POLL_MS = 5000;
/** After a room reports its item gone the manifest that says so is usually a moment away: look often for a while. */
const FAST_MS = 1000;
const FAST_FOR_MS = 10_000;

export interface ManifestSyncOptions {
  /** Merges an update into the open workspace (`workspace.applyRemoteManifest`). */
  apply(update: ManifestUpdate): Promise<{ removed: RemovedItem[] }>;
  /** Tells the person something happened to their list (a toast). */
  say(message: string): void;
  intervalMs?: number;
  isVisible?: () => boolean;
}

export interface ManifestSync {
  start(): void;
  stop(): void;
  /** Look again soon and often (a room just told us its item is gone). */
  nudge(): void;
}

const KIND_LABEL = { diagram: uiText("diagrama"), doc: uiText("documento"), sketch: 'sketch' } as const;

/** What the person reads when others deleted items from the shared list. */
export function removalMessage(removed: RemovedItem[]): string {
  if (removed.length === 1) return uiText("“{0}” ({1}) foi excluído por outra pessoa.", [removed[0]!.title, KIND_LABEL[removed[0]!.kind]]);
  return uiText("{0} itens foram excluídos por outra pessoa: {1}{2}.", [removed.length, removed.slice(0, 3).map((item) => uiText("“{0}”", [item.title])).join(', '), removed.length > 3 ? '…' : '']);
}

/**
 * The shared session's list of diagrams, docs and sketches is one file every guest writes: this keeps this tab's
 * sidebar in step with it, polling the host (the items' contents travel through their rooms, not through here).
 */
export function createManifestSync(adapter: Pick<RemoteAdapter, 'pollManifest' | 'onManifestMerged'>, options: ManifestSyncOptions): ManifestSync {
  const interval = options.intervalMs ?? POLL_MS;
  const isVisible = options.isVisible ?? (() => globalThis.document?.visibilityState !== 'hidden');
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopMerged = () => {};
  let fastUntil = 0;
  let queue: Promise<unknown> = Promise.resolve();

  /** One update at a time, in the order they arrived. */
  const absorb = (update: ManifestUpdate) => {
    queue = queue.then(async () => {
      const { removed } = await options.apply(update);
      if (removed.length) options.say(removalMessage(removed));
    }).catch(() => {});
    return queue;
  };

  const tick = async () => {
    if (!running) return;
    if (isVisible()) {
      try {
        const update = await adapter.pollManifest();
        if (update) await absorb(update);
      } catch { /* a transient failure: the next poll tries again */ }
    }
    if (running) timer = setTimeout(() => void tick(), Date.now() < fastUntil ? FAST_MS : interval);
  };

  return {
    start() {
      if (running) return;
      running = true;
      stopMerged = adapter.onManifestMerged((update) => void absorb(update));
      timer = setTimeout(() => void tick(), interval);
    },
    stop() {
      running = false;
      clearTimeout(timer);
      stopMerged();
      stopMerged = () => {};
    },
    nudge() {
      if (!running) return;
      fastUntil = Date.now() + FAST_FOR_MS;
      clearTimeout(timer);
      timer = setTimeout(() => void tick(), 0);
    },
  };
}

let current: ManifestSync | null = null;
/** The running sync of the open shared session, for code that has no handle on it (a room that lost its item). */
export const nudgeManifestSync = (): void => current?.nudge();
export function setManifestSync(next: ManifestSync | null): void {
  current?.stop();
  current = next;
  next?.start();
}
