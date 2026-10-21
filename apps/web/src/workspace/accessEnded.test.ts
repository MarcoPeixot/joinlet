import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCESS_ENDED, accessEnded, hasAccessEnded, setAccessEndedHandler } from './accessEnded';

afterEach(() => setAccessEndedHandler(null));

describe('access ended', () => {
  it('tells the handler once, however many rooms and requests notice it', () => {
    const handler = vi.fn();
    setAccessEndedHandler(handler);
    expect(hasAccessEnded()).toBe(false);
    accessEnded();
    accessEnded('outra mensagem');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(ACCESS_ENDED);
    expect(hasAccessEnded()).toBe(true);
  });

  it('a new session starts clean', () => {
    const first = vi.fn();
    setAccessEndedHandler(first);
    accessEnded();
    const second = vi.fn();
    setAccessEndedHandler(second);
    expect(hasAccessEnded()).toBe(false);
    accessEnded('x');
    expect(second).toHaveBeenCalledWith('x');
  });

  it('says what happened and what to do', () => {
    expect(ACCESS_ENDED).toContain('revogado ou expirou');
    expect(ACCESS_ENDED).toContain('novo link');
  });
});
