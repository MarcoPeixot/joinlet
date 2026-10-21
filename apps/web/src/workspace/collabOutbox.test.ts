import { emptyModel } from '@strukt/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeltaOutbox } from './collabOutbox';

const snap = (x: number) => ({ model: emptyModel(), layout: { nodes: { A: { x, y: 0 } }, edges: {} } });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createDeltaOutbox', () => {
  it('sends immediately outside a gesture', () => {
    const send = vi.fn();
    const outbox = createDeltaOutbox(send);
    outbox.push(snap(0), snap(1), false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('coalesces gesture frames into one delta per 80 ms, spanning first before to last after', () => {
    const send = vi.fn();
    const outbox = createDeltaOutbox(send);
    const first = snap(0);
    for (let x = 1; x <= 10; x++) {
      outbox.push(x === 1 ? first : snap(x - 1), snap(x), true);
      vi.advanceTimersByTime(7);
    }
    expect(send).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(10);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toBe(first);
    expect(send.mock.calls[0]![1].layout.nodes.A.x).toBe(10);
  });

  it('flushes the last frame when the gesture ends, without waiting for the timer', () => {
    const send = vi.fn();
    const outbox = createDeltaOutbox(send);
    outbox.push(snap(0), snap(1), true);
    outbox.push(snap(1), snap(2), true);
    outbox.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![1].layout.nodes.A.x).toBe(2);
    vi.advanceTimersByTime(200);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('flush with nothing pending is a no-op; a non-gesture push also carries earlier gesture frames', () => {
    const send = vi.fn();
    const outbox = createDeltaOutbox(send);
    outbox.flush();
    expect(send).not.toHaveBeenCalled();
    const start = snap(0);
    outbox.push(start, snap(1), true);
    outbox.push(snap(1), snap(2), false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toBe(start);
  });

  it('dispose flushes what is pending', () => {
    const send = vi.fn();
    const outbox = createDeltaOutbox(send);
    outbox.push(snap(0), snap(5), true);
    outbox.dispose();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
