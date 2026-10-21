import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMobileViewport } from './useBreakpoint';

afterEach(() => vi.unstubAllGlobals());

describe('isMobileViewport', () => {
  it('is false without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(isMobileViewport()).toBe(false);
  });

  it('asks for max-width 639px and follows the answer', () => {
    const matchMedia = vi.fn((query: string) => ({ matches: query === '(max-width: 639px)' }));
    vi.stubGlobal('matchMedia', matchMedia);
    expect(isMobileViewport()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(max-width: 639px)');
  });

  it('survives a throwing matchMedia', () => {
    vi.stubGlobal('matchMedia', () => {
      throw new Error('blocked');
    });
    expect(isMobileViewport()).toBe(false);
  });
});
