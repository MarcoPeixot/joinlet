import { describe, expect, it } from 'vitest';
import { createLazySlot } from './lazyWithRetry';

const view = { default: () => null };

describe('createLazySlot', () => {
  it('keeps the same lazy component while the import works', async () => {
    const slot = createLazySlot(() => Promise.resolve(view));
    const first = slot.current;
    await expect(slot.load()).resolves.toBe(view);
    expect(slot.current).toBe(first);
  });

  it('swaps in a fresh lazy component after a failure and re-invokes the factory', async () => {
    let calls = 0;
    const slot = createLazySlot(() => (++calls === 1 ? Promise.reject(new Error('chunk 404')) : Promise.resolve(view)));
    const first = slot.current;
    await expect(slot.load()).rejects.toThrow('chunk 404');
    expect(slot.current).not.toBe(first);
    await expect(slot.load()).resolves.toBe(view);
    expect(calls).toBe(2);
  });
});
