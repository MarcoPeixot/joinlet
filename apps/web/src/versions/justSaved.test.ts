import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJustSaved } from './justSaved';

describe('createJustSaved', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const changes: boolean[] = [];
    const tracker = createJustSaved((saved) => changes.push(saved), 1600);
    return { tracker, changes };
  };

  it('stays quiet for the first list and flags a new top version, then clears after the delay', () => {
    const { tracker, changes } = setup();
    tracker.observe('a', 'idle', 'v1');
    expect(changes).toEqual([]);
    tracker.observe('a', 'idle', 'v2');
    expect(changes).toEqual([true]);
    vi.advanceTimersByTime(1600);
    expect(changes).toEqual([true, false]);
  });

  it('a re-render (status/list change) inside the window does not leave "Versão salva" stuck', () => {
    const { tracker, changes } = setup();
    tracker.observe('a', 'idle', 'v1');
    tracker.observe('a', 'idle', 'v2');
    vi.advanceTimersByTime(500);
    tracker.observe('a', 'busy', 'v2'); // a refresh starts
    tracker.observe('a', 'idle', 'v2'); // and ends with the same top version
    vi.advanceTimersByTime(1100);
    expect(changes).toEqual([true, false]);
  });

  it('a second save restarts the window; switching diagram clears at once and does not flag', () => {
    const { tracker, changes } = setup();
    tracker.observe('a', 'idle', 'v1');
    tracker.observe('a', 'idle', 'v2');
    vi.advanceTimersByTime(1000);
    tracker.observe('a', 'idle', 'v3');
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual([true]);
    vi.advanceTimersByTime(600);
    expect(changes).toEqual([true, false]);
    tracker.observe('a', 'idle', 'v4');
    tracker.observe('b', 'idle', 'x1');
    expect(changes).toEqual([true, false, true, false]);
    tracker.observe('b', 'idle', 'x1');
    vi.advanceTimersByTime(5000);
    expect(changes).toEqual([true, false, true, false]);
  });

  it('dispose cancels the timer and drops the flag', () => {
    const { tracker, changes } = setup();
    tracker.observe('a', 'idle', 'v1');
    tracker.observe('a', 'idle', 'v2');
    tracker.dispose();
    vi.advanceTimersByTime(5000);
    expect(changes).toEqual([true, false]);
  });
});
