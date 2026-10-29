import { describe, expect, it } from 'vitest';
import { placeTooltip } from './tooltipPlacement';

const viewport = { w: 1000, h: 800 };
const size = { w: 100, h: 24 };

describe('placeTooltip', () => {
  it('centers the bubble off the asked side', () => {
    expect(placeTooltip({ x: 500, y: 100, w: 32, h: 32 }, size, 'bottom', viewport)).toEqual({ x: 466, y: 139, side: 'bottom' });
    expect(placeTooltip({ x: 500, y: 100, w: 32, h: 32 }, size, 'right', viewport)).toEqual({ x: 539, y: 104, side: 'right' });
  });

  it('flips when the asked side has no room', () => {
    expect(placeTooltip({ x: 500, y: 770, w: 32, h: 24 }, size, 'bottom', viewport).side).toBe('top');
    expect(placeTooltip({ x: 940, y: 300, w: 32, h: 32 }, size, 'right', viewport).side).toBe('left');
  });

  it('stays inside the viewport along the other axis', () => {
    expect(placeTooltip({ x: 980, y: 10, w: 16, h: 16 }, size, 'bottom', viewport).x).toBe(892);
    expect(placeTooltip({ x: 0, y: 10, w: 16, h: 16 }, size, 'bottom', viewport).x).toBe(8);
  });
});
