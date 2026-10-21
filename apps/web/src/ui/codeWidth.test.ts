import { describe, expect, it } from 'vitest';
import { CODE_WIDTH, clampCodeWidth } from './codeWidth';

describe('clampCodeWidth', () => {
  it('keeps the code panel between its minimum and maximum', () => {
    expect(clampCodeWidth(100, 1600)).toBe(CODE_WIDTH.min);
    expect(clampCodeWidth(500, 1600)).toBe(500);
    expect(clampCodeWidth(2000, 1600)).toBe(CODE_WIDTH.max);
  });

  it('always leaves room for the canvas on narrow windows', () => {
    expect(clampCodeWidth(700, 1000)).toBe(1000 - CODE_WIDTH.canvasRoom);
    // Never below the minimum, even when the window is tiny.
    expect(clampCodeWidth(700, 500)).toBe(CODE_WIDTH.min);
  });

  it('rounds to whole pixels and treats garbage as the default', () => {
    expect(clampCodeWidth(412.6, 1600)).toBe(413);
    expect(clampCodeWidth(Number.NaN, 1600)).toBe(CODE_WIDTH.initial);
  });
});
