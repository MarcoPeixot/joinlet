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
