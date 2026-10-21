import { describe, expect, it } from 'vitest';
import { createFailureLimiter } from './failureLimiter';

function setup(options: { limit?: number; windowMs?: number; maxKeys?: number } = {}) {
  let time = 0;
  return { limiter: createFailureLimiter({ now: () => time, ...options }), advance: (ms: number) => { time += ms; } };
}

describe('failure limiter', () => {
  it('counts one subject once per window, however often it fails (a stale token, not a guess)', () => {
    const { limiter, advance } = setup({ limit: 2, windowMs: 10_000 });
    for (let i = 0; i < 50; i++) limiter.fail('a', 'token-velho');
    expect(limiter.blocked('a')).toBe(0);
    limiter.fail('a', 'outro-token');
    expect(limiter.blocked('a')).toBeGreaterThan(0);
    advance(11_000);
    expect(limiter.blocked('a')).toBe(0);
    limiter.fail('a', 'token-velho');
    limiter.fail('a', 'token-velho');
    expect(limiter.blocked('a')).toBe(0);
  });

  it('lets a caller fail up to the limit, then blocks it with the seconds left', () => {
    const { limiter, advance } = setup({ limit: 3, windowMs: 60_000 });
    for (let i = 0; i < 3; i++) {
      expect(limiter.blocked('a')).toBe(0);
      limiter.fail('a');
      advance(1_000);
    }
    expect(limiter.blocked('a')).toBe(57); // the oldest failure leaves the window 60 s after it, 3 s have passed
    expect(limiter.blocked('b')).toBe(0);
  });

  it('forgives as the window slides', () => {
    const { limiter, advance } = setup({ limit: 2, windowMs: 10_000 });
    limiter.fail('a');
    advance(5_000);
    limiter.fail('a');
    expect(limiter.blocked('a')).toBeGreaterThan(0);
    advance(5_000);
    expect(limiter.blocked('a')).toBe(0);
  });

  it('does not extend the block while blocked (a hammering client is not locked out forever)', () => {
    const { limiter, advance } = setup({ limit: 1, windowMs: 10_000 });
    limiter.fail('a');
    advance(9_000);
    limiter.fail('a');
    limiter.fail('a');
    advance(1_000);
    expect(limiter.blocked('a')).toBe(0);
  });

  it('bounds its memory: past maxKeys the oldest callers are forgotten', () => {
    const { limiter } = setup({ limit: 1, maxKeys: 100 });
    for (let i = 0; i < 1000; i++) limiter.fail(`ip${i}`);
    expect(limiter.size()).toBeLessThanOrEqual(100);
    expect(limiter.blocked('ip999')).toBeGreaterThan(0);
  });

  it('treats prototype names as plain keys', () => {
    const { limiter } = setup({ limit: 1 });
    limiter.fail('__proto__');
    limiter.fail('constructor');
    expect(limiter.blocked('__proto__')).toBeGreaterThan(0);
    expect(limiter.blocked('toString')).toBe(0);
  });
});
