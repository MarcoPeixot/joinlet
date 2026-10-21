import { describe, expect, it } from 'vitest';
import { miniMapTransform } from './minimap';

describe('miniMapTransform', () => {
  it('frames negative coordinates with padding and preserves the aspect ratio', () => {
    const map = miniMapTransform([{ x: -800, y: -300, w: 1000, h: 500 }])!;
    expect(map.x - 800 * map.scale).toBeCloseTo(10);
    expect(map.x + 200 * map.scale).toBeCloseTo(158);
    expect(map.y - 300 * map.scale).toBeGreaterThanOrEqual(10);
    expect(map.y + 200 * map.scale).toBeLessThanOrEqual(86);
    expect(map.scale).toBeCloseTo(148 / 1000);
  });
  it('includes nested groups and distant nodes without taking the viewport into account', () => {
    const map = miniMapTransform([{ x: 0, y: 0, w: 100, h: 100 }, { x: 5000, y: 300, w: 200, h: 100 }])!;
    expect(map.bounds).toEqual({ x: 0, y: 0, w: 5200, h: 400 });
    const target = { x: 5100, y: 350 };
    const pixel = { x: map.x + target.x * map.scale, y: map.y + target.y * map.scale };
    expect((pixel.x - map.x) / map.scale).toBeCloseTo(target.x);
    expect((pixel.y - map.y) / map.scale).toBeCloseTo(target.y);
  });
  it('handles an empty or degenerate diagram without invalid SVG coordinates', () => {
    expect(miniMapTransform([])).toBeNull();
    const map = miniMapTransform([{ x: 0, y: 0, w: 0, h: 0 }])!;
    expect(Number.isFinite(map.scale)).toBe(true);
    expect(Number.isFinite(map.x)).toBe(true);
    expect(Number.isFinite(map.y)).toBe(true);
  });
});
