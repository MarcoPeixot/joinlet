import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHoverPreview } from './hoverPreview';

describe('createHoverPreview', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('goes from one row to the next without passing through the plain state', () => {
    const seen: (string | null)[] = [];
    const preview = createHoverPreview<string>((value) => seen.push(value));
    preview.enter('a');
    preview.leave();
    vi.advanceTimersByTime(60);
    preview.enter('b');
    vi.advanceTimersByTime(500);
    expect(seen).toEqual(['a', 'b']);
  });

  it('clears once the pointer has really left the list', () => {
    const seen: (string | null)[] = [];
    const preview = createHoverPreview<string>((value) => seen.push(value));
    preview.enter('a');
    preview.leave();
    vi.advanceTimersByTime(119);
    expect(seen).toEqual(['a']);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual(['a', null]);
  });

  it('clears at once when cancelled', () => {
    const seen: (string | null)[] = [];
    const preview = createHoverPreview<string>((value) => seen.push(value));
    preview.enter('a');
    preview.leave();
    preview.cancel();
    vi.advanceTimersByTime(500);
    expect(seen).toEqual(['a', null]);
  });
});
