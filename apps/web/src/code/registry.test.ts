import { describe, expect, it, vi } from 'vitest';
import { flushCodeEdits, registerCodeSync } from './registry';

describe('code sync registry', () => {
  it('flushes the registered editor until it unregisters', async () => {
    const sync = { edited: vi.fn(), flush: vi.fn(async () => {}), dispose: vi.fn() };
    const unregister = registerCodeSync(sync);
    await flushCodeEdits();
    expect(sync.flush).toHaveBeenCalledOnce();
    unregister();
    await flushCodeEdits();
    expect(sync.flush).toHaveBeenCalledOnce();
  });

  it('ignores a stale unregister after another panel registered', async () => {
    const first = { edited: vi.fn(), flush: vi.fn(async () => {}), dispose: vi.fn() };
    const second = { edited: vi.fn(), flush: vi.fn(async () => {}), dispose: vi.fn() };
    const dropFirst = registerCodeSync(first);
    const dropSecond = registerCodeSync(second);
    dropFirst();
    await flushCodeEdits();
    expect(second.flush).toHaveBeenCalledOnce();
    dropSecond();
  });
});
