import { describe, expect, it } from 'vitest';
import { arrowHead, pointAtHalf, roundedPath, trimEnd, trimStart } from './path';
import { routeOrthogonal } from './route';

describe('routeOrthogonal', () => {
  it('draws a straight horizontal line when boxes overlap vertically', () => {
    expect(routeOrthogonal({ x: 0, y: 0, w: 100, h: 50 }, { x: 200, y: 10, w: 100, h: 50 })).toEqual({
      points: [[100, 30], [200, 30]], sourceSide: 'right', targetSide: 'left',
    });
  });
  it('draws a straight vertical line when boxes overlap horizontally', () => {
    expect(routeOrthogonal({ x: 0, y: 0, w: 100, h: 50 }, { x: 20, y: 150, w: 100, h: 50 }).points).toEqual([[60, 50], [60, 150]]);
  });
  it('uses a Z elbow for diagonal boxes along the dominant axis', () => {
    expect(routeOrthogonal({ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 200, w: 100, h: 50 }).points).toEqual([
      [100, 25], [200, 25], [200, 225], [300, 225],
    ]);
  });
  it('routes leftwards', () => {
    const route = routeOrthogonal({ x: 300, y: 0, w: 100, h: 50 }, { x: 0, y: 0, w: 100, h: 50 });
    expect(route.points).toEqual([[300, 25], [100, 25]]);
    expect(route.sourceSide).toBe('left');
  });
});

describe('routeOrthogonal around touching boxes', () => {
  const inside = (p: [number, number], r: { x: number; y: number; w: number; h: number }) => p[0] > r.x && p[0] < r.x + r.w && p[1] > r.y && p[1] < r.y + r.h;

  it('goes around stacked boxes on the right instead of running under them', () => {
    const a = { x: 40, y: 40, w: 280, h: 200 }, b = { x: 80, y: 240, w: 200, h: 160 };
    const { points, sourceSide, targetSide } = routeOrthogonal(a, b);
    expect([sourceSide, targetSide]).toEqual(['right', 'right']);
    expect(points).toEqual([[320, 140], [336, 140], [336, 320], [280, 320]]);
    for (const p of points) expect(inside(p, a) || inside(p, b)).toBe(false);
  });

  it('goes around side-by-side touching boxes underneath', () => {
    const a = { x: 0, y: 0, w: 100, h: 60 }, b = { x: 100, y: 10, w: 100, h: 60 };
    expect(routeOrthogonal(a, b)).toEqual({ points: [[50, 60], [50, 86], [150, 86], [150, 70]], sourceSide: 'bottom', targetSide: 'bottom' });
  });
});

describe('paths', () => {
  it('builds straight and rounded paths', () => {
    expect(roundedPath([[0, 0], [10, 0]])).toBe('M 0 0 L 10 0');
    expect(roundedPath([[0, 0], [20, 0], [20, 20]])).toBe('M 0 0 L 12 0 Q 20 0 20 8 L 20 20');
    expect(roundedPath([])).toBe('');
  });
  it('finds the midpoint along the polyline', () => {
    expect(pointAtHalf([[0, 0], [10, 0], [10, 10]])).toEqual([10, 0]);
  });
  it('trims ends for arrowheads', () => {
    expect(trimEnd([[0, 0], [10, 0]], 3)).toEqual([[0, 0], [7, 0]]);
    expect(trimStart([[0, 0], [10, 0]], 3)).toEqual([[3, 0], [10, 0]]);
  });
  it('draws an arrowhead with its tip on the endpoint', () => {
    expect(arrowHead([10, 0], [0, 0], 10)).toBe('M 10 0 L 0 4.5 L 0 -4.5 Z');
  });
});
