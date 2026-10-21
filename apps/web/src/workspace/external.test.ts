import { createMemoryAdapter } from '@strukt/workspace';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changedFiles, createExternalWatcher, isWatchedPath } from './external';

describe('changedFiles', () => {
  it('reports added, removed and modified paths, sorted', () => {
    expect(changedFiles({ 'a.md': 1, 'b.md': 2 }, { 'b.md': 2, 'c.md': 3 })).toEqual(['a.md', 'c.md']);
    expect(changedFiles({ 'a.md': 1 }, { 'a.md': 2 })).toEqual(['a.md']);
    expect(changedFiles({ 'a.md': 1 }, { 'a.md': 1 })).toEqual([]);
  });
});

/** A folder-like adapter whose stamps can be poked, so the watcher can be driven by hand. */
function stampAdapter(initial: Record<string, number>) {
  const adapter = { ...createMemoryAdapter(), kind: 'folder' as const, stamps: vi.fn(async () => ({ ...stamps })) };
  let stamps = { ...initial };
  return {
    adapter,
    set(next: Record<string, number>) {
      stamps = { ...next };
    },
  };
}

describe('isWatchedPath', () => {
  it('leaves out versions/ and context/', () => {
    expect(isWatchedPath('strukt.json')).toBe(true);
    expect(isWatchedPath('docs/a.md')).toBe(true);
    expect(isWatchedPath('versions/a/x.json')).toBe(false);
    expect(isWatchedPath('context/llms.txt')).toBe(false);
    // Comments are written by every guest all day and the comments store polls its own file: no "changed on disk" banner.
    expect(isWatchedPath('comments/diagram-mapa.json')).toBe(false);
  });
});

describe('createExternalWatcher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('notices a change after the baseline and reports it once', async () => {
    const { adapter, set } = stampAdapter({ 'strukt.json': 1 });
    const onChanges = vi.fn();
    const watcher = createExternalWatcher({ adapter: () => adapter, onChanges, intervalMs: 100, maxIntervalMs: 100, isVisible: () => true });
    watcher.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(onChanges).not.toHaveBeenCalled();

    set({ 'strukt.json': 2 });
    await vi.advanceTimersByTimeAsync(100);
    expect(onChanges).toHaveBeenCalledWith(['strukt.json']);

    // The new snapshot is the baseline: the same change is not reported again.
    await vi.advanceTimersByTimeAsync(200);
    expect(onChanges).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  it('resync moves the baseline (the app\'s own saves never look external)', async () => {
    const { adapter, set } = stampAdapter({ 'strukt.json': 1 });
    const onChanges = vi.fn();
    const watcher = createExternalWatcher({ adapter: () => adapter, onChanges, intervalMs: 100, maxIntervalMs: 100, isVisible: () => true });
    watcher.start();
    await vi.advanceTimersByTimeAsync(100);
    set({ 'strukt.json': 2 });
    await watcher.resync();
    await vi.advanceTimersByTimeAsync(300);
    expect(onChanges).not.toHaveBeenCalled();
    watcher.stop();
  });

  it('does not poll while the tab is hidden and stops cleanly', async () => {
    const { adapter } = stampAdapter({ 'strukt.json': 1 });
    let visible = false;
    const watcher = createExternalWatcher({ adapter: () => adapter, onChanges: vi.fn(), intervalMs: 100, maxIntervalMs: 100, isVisible: () => visible });
    watcher.start();
    await vi.advanceTimersByTimeAsync(300);
    expect(adapter.stamps).not.toHaveBeenCalled();
    visible = true;
    await vi.advanceTimersByTimeAsync(100);
    expect(adapter.stamps).toHaveBeenCalled();
    watcher.stop();
    const calls = adapter.stamps.mock.calls.length;
    await vi.advanceTimersByTimeAsync(300);
    expect(adapter.stamps.mock.calls.length).toBe(calls);
  });

  it('is a no-op for adapters without stamps (IndexedDB, memory)', async () => {
    const adapter = createMemoryAdapter();
    const watcher = createExternalWatcher({ adapter: () => adapter, onChanges: vi.fn(), intervalMs: 10, maxIntervalMs: 10 });
    watcher.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(adapter.stamps).toBeUndefined();
    watcher.stop();
  });

  it('ignores writes under versions/ and context/', async () => {
    const { adapter, set } = stampAdapter({ 'strukt.json': 1 });
    const onChanges = vi.fn();
    const watcher = createExternalWatcher({ adapter: () => adapter, onChanges, intervalMs: 100, maxIntervalMs: 100, isVisible: () => true });
    watcher.start();
    await vi.advanceTimersByTimeAsync(100);
    set({ 'strukt.json': 1, 'versions/a/x.json': 5, 'context/llms.txt': 6 });
    await vi.advanceTimersByTimeAsync(500);
    expect(onChanges).not.toHaveBeenCalled();
    watcher.stop();
  });

  describe('back-off', () => {
    const setup = () => {
      const { adapter, set } = stampAdapter({ 'strukt.json': 1 });
      let wake: () => void = () => {};
      const onChanges = vi.fn();
      const watcher = createExternalWatcher({
        adapter: () => adapter,
        onChanges,
        isVisible: () => true,
        onWake: (cb) => { wake = cb; return () => {}; },
      });
      return { adapter, set, watcher, onChanges, wake: () => wake() };
    };

    it('doubles 4s -> 8s -> 16s -> 32s (cap) while nothing changes', async () => {
      const { adapter, watcher } = setup();
      watcher.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(adapter.stamps).toHaveBeenCalledTimes(1); // t=0 baseline
      await vi.advanceTimersByTimeAsync(3999);
      expect(adapter.stamps).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1); // t=4s
      expect(adapter.stamps).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(7999);
      expect(adapter.stamps).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1); // t=12s
      expect(adapter.stamps).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(16_000); // t=28s
      expect(adapter.stamps).toHaveBeenCalledTimes(4);
      await vi.advanceTimersByTimeAsync(32_000); // t=60s
      expect(adapter.stamps).toHaveBeenCalledTimes(5);
      await vi.advanceTimersByTimeAsync(32_000); // capped at 32s
      expect(adapter.stamps).toHaveBeenCalledTimes(6);
      watcher.stop();
    });

    it('returns to 4s after a detected change', async () => {
      const { adapter, set, watcher, onChanges } = setup();
      watcher.start();
      await vi.advanceTimersByTimeAsync(4000 + 8000); // t=12s, next in 16s
      set({ 'strukt.json': 2 });
      await vi.advanceTimersByTimeAsync(16_000);
      expect(onChanges).toHaveBeenCalledTimes(1);
      const calls = adapter.stamps.mock.calls.length;
      await vi.advanceTimersByTimeAsync(4000);
      expect(adapter.stamps.mock.calls.length).toBe(calls + 1);
      watcher.stop();
    });

    it('returns to 4s and checks right away when the tab becomes visible or focused', async () => {
      const { adapter, watcher, wake } = setup();
      watcher.start();
      await vi.advanceTimersByTimeAsync(4000 + 8000 + 16_000); // backed off to 32s
      const calls = adapter.stamps.mock.calls.length;
      wake();
      await vi.advanceTimersByTimeAsync(0);
      expect(adapter.stamps.mock.calls.length).toBe(calls + 1);
      await vi.advanceTimersByTimeAsync(4000);
      expect(adapter.stamps.mock.calls.length).toBe(calls + 2);
      watcher.stop();
    });
  });
});
