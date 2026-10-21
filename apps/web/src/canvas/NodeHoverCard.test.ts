import { describe, expect, it } from 'vitest';
import { hoverBlocked } from './NodeHoverCard';

describe('hoverBlocked', () => {
  it('blocks the card while frozen or presenting', () => {
    expect(hoverBlocked({ frozen: false, presenting: false })).toBe(false);
    expect(hoverBlocked({ frozen: true, presenting: false })).toBe(true);
    expect(hoverBlocked({ frozen: false, presenting: true })).toBe(true);
  });
});
