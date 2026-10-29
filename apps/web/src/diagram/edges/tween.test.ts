import { describe, expect, it } from 'vitest';
import { easeOut, lerpRoute, matchRoutes } from './tween';

describe('route tween', () => {
  it('pads the shorter route with collinear corners, keeping both ends', () => {
    const [from, to] = matchRoutes([[0, 0], [100, 0]], [[0, 0], [50, 0], [50, 40], [100, 40]]);
    expect(from).toEqual([[0, 0], [25, 0], [50, 0], [100, 0]]);
    expect(to).toHaveLength(4);
    expect(from[0]).toEqual([0, 0]);
    expect(from.at(-1)).toEqual([100, 0]);
  });

  it('starts on the old route and lands exactly on the new one', () => {
    const [from, to] = matchRoutes([[0, 0], [10, 0], [10, 10]], [[0, 8], [20, 8], [20, 10]]);
    expect(lerpRoute(from, to, 0)).toEqual(from);
    expect(lerpRoute(from, to, 1)).toEqual(to);
    expect(lerpRoute(from, to, 0.5)).toEqual([[0, 4], [15, 4], [15, 10]]);
  });

  it('eases out from 0 to 1', () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });
});
