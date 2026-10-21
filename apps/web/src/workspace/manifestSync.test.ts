import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createManifestSync } from './manifestSync';
import type { ManifestUpdate } from './remote';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(updates: (ManifestUpdate | null)[]) {
  const merged = new Set<(update: ManifestUpdate) => void>();
  const adapter = {
    pollManifest: vi.fn(async () => updates.shift() ?? null),
    onManifestMerged: (listener: (update: ManifestUpdate) => void) => { merged.add(listener); return () => void merged.delete(listener); },
  };
  const apply = vi.fn(async (_update: ManifestUpdate) => ({ removed: [{ kind: 'diagram' as const, slug: 'x', title: 'X' }] }));
  const say = vi.fn();
  const sync = createManifestSync(adapter, { apply, say, intervalMs: 5000, isVisible: () => true });
  return { adapter, apply, say, sync, merged };
}

describe('manifest sync', () => {
  it('polls on an interval and hands what changed to the workspace', async () => {
    const update = { base: 'a', theirs: 'b' };
    const { adapter, apply, sync } = setup([null, update]);
    sync.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(apply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(adapter.pollManifest).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledWith(update);
    sync.stop();
  });

  it('says what another guest deleted', async () => {
    const { say, sync } = setup([{ base: 'a', theirs: 'b' }]);
    sync.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(say).toHaveBeenCalledWith(expect.stringContaining('X'));
    sync.stop();
  });

  it('absorbs the merge a save made as it happens', async () => {
    const { apply, sync, merged } = setup([]);
    sync.start();
    for (const listener of merged) listener({ base: 'a', theirs: 'c' });
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).toHaveBeenCalledWith({ base: 'a', theirs: 'c' });
    sync.stop();
    expect(merged.size).toBe(0);
  });

  it('polls faster for a while after a room reports its item gone, then settles back', async () => {
    const { adapter, sync } = setup([]);
    sync.start();
    sync.nudge();
    await vi.advanceTimersByTimeAsync(3000);
    const fast = adapter.pollManifest.mock.calls.length;
    expect(fast).toBeGreaterThanOrEqual(3);
    await vi.advanceTimersByTimeAsync(20_000);
    const settled = adapter.pollManifest.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(adapter.pollManifest.mock.calls.length - settled).toBeLessThanOrEqual(7); // back to every 5 s
    sync.stop();
  });

  it('does not poll while the tab is hidden, and a failed poll just waits for the next', async () => {
    let visible = false;
    const adapter = { pollManifest: vi.fn(async () => { throw new Error('rede'); }), onManifestMerged: () => () => {} };
    const sync = createManifestSync(adapter, { apply: async () => ({ removed: [] }), say: () => {}, intervalMs: 1000, isVisible: () => visible });
    sync.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(adapter.pollManifest).not.toHaveBeenCalled();
    visible = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(adapter.pollManifest).toHaveBeenCalledTimes(2);
    sync.stop();
  });
});
