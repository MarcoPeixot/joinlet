import type { Snapshot } from '../state/diagramStore';

export const OUTBOX_INTERVAL_MS = 80;

export interface DeltaOutbox {
  /** Queue one store change. Outside a gesture (or when `gesture` is false) everything queued is sent now. */
  push(before: Snapshot, after: Snapshot, gesture: boolean): void;
  /** Send what is queued right away (gesture end, remote receive, diagram switch). */
  flush(): void;
  dispose(): void;
}

/**
 * Coalesces the per-frame changes of a gesture (drag) into one delta per `intervalMs`, spanning the first
 * `before` to the latest `after`, so the Yjs doc and the socket see ~12 messages/s instead of one per frame.
 * Callers must `flush` at gesture end so the final positions are never lost.
 */
export function createDeltaOutbox(send: (before: Snapshot, after: Snapshot) => void, intervalMs = OUTBOX_INTERVAL_MS): DeltaOutbox {
  let before: Snapshot | null = null;
  let after: Snapshot | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (!before || !after) return;
    const [from, to] = [before, after];
    before = after = null;
    send(from, to);
  };

  return {
    push(from, to, gesture) {
      before ??= from;
      after = to;
      if (!gesture) flush();
      else timer ??= setTimeout(flush, intervalMs);
    },
    flush,
    dispose: flush,
  };
}
