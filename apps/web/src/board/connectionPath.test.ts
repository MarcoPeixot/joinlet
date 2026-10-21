import { describe, expect, it } from 'vitest';
import { bendFromPointer, connectionRoute } from './connectionPath';

const a = { x: 0, y: 0, w: 200, h: 100 };
const at = (x: number, y: number) => ({ x, y, w: 200, h: 100 });
const allFinite = (points: readonly (readonly number[])[]) => points.every((p) => p.every(Number.isFinite));

describe('connectionRoute', () => {
  it('side by side: leaves the right side, enters the left side, with the vertical segment mid-gap (H–V–H)', () => {
    const route = connectionRoute(a, at(400, 60));
    expect(route).toEqual({
      points: [[200, 50], [300, 50], [300, 110], [400, 110]],
      sourceSide: 'right',
      targetSide: 'left',
      handle: [300, 80],
      axis: 'x',
    });
  });

  it('target on the left: leaves the left side and enters the right side', () => {
    const route = connectionRoute(a, at(-400, 60));
    expect(route.points).toEqual([[0, 50], [-100, 50], [-100, 110], [-200, 110]]);
    expect([route.sourceSide, route.targetSide]).toEqual(['left', 'right']);
  });

  it('stacked: leaves the bottom, enters the top, with the horizontal segment mid-gap (V–H–V)', () => {
    expect(connectionRoute(a, at(20, 300))).toEqual({
      points: [[100, 100], [100, 200], [120, 200], [120, 300]],
      sourceSide: 'bottom',
      targetSide: 'top',
      handle: [110, 200],
      axis: 'y',
    });
    const up = connectionRoute(a, at(20, -300));
    expect(up.points).toEqual([[100, 0], [100, -100], [120, -100], [120, -200]]);
    expect([up.sourceSide, up.targetSide]).toEqual(['top', 'bottom']);
  });

  it('diagonal (a gap on both axes): goes along the axis where the centers are farther apart', () => {
    expect(connectionRoute(a, at(400, 300)).axis).toBe('x');
    expect(connectionRoute(a, at(300, 500)).axis).toBe('y');
  });

  it('a gap on one axis only wins over the center distance on the other', () => {
    // Overlapping in x (900..1000) with a gap below: vertical, although |dx| > |dy| between the centers.
    const wide = { x: 0, y: 0, w: 1000, h: 100 };
    expect(connectionRoute(wide, { x: 900, y: 300, w: 200, h: 100 }).axis).toBe('y');
  });

  it('moves the middle segment with the bend (fraction of the gap)', () => {
    expect(connectionRoute(a, at(400, 60), 0.2).points).toEqual([[200, 50], [240, 50], [240, 110], [400, 110]]);
    expect(connectionRoute(a, at(400, 60), 0.8).handle).toEqual([360, 80]);
    expect(connectionRoute(a, at(20, 300), 0.8).points[1]).toEqual([100, 260]);
  });

  it('centers aligned: a straight line of 2 points', () => {
    const route = connectionRoute(a, at(400, 0));
    expect(route.points).toEqual([[200, 50], [400, 50]]);
    expect(route.handle).toEqual([300, 50]);
    expect(connectionRoute(a, at(0, 300)).points).toEqual([[100, 100], [100, 300]]);
  });

  it('overlapping or identical boxes never produce NaN', () => {
    for (const b of [at(50, 20), at(0, 0), at(10, 60)]) {
      const route = connectionRoute(a, b);
      expect(allFinite(route.points)).toBe(true);
      expect(allFinite([route.handle])).toBe(true);
    }
  });

  describe('no room between the cards (flush, narrow or overlapping): around one side', () => {
    const segmentLengths = (points: readonly (readonly number[])[]) =>
      points.slice(1).map((p, i) => Math.hypot(p[0]! - points[i]![0]!, p[1]! - points[i]![1]!));

    it('flush and aligned, stacked: out of the right side, 16 px out, back into the right side of the target', () => {
      const route = connectionRoute(a, at(0, 100));
      expect(route).toEqual({
        points: [[200, 50], [216, 50], [216, 150], [200, 150]],
        sourceSide: 'right',
        targetSide: 'right',
        handle: [216, 100],
        axis: 'x',
      });
      // Every segment is visible and the last one holds the 10 px arrowhead.
      expect(Math.min(...segmentLengths(route.points))).toBeGreaterThanOrEqual(16);
    });

    it('flush side by side: under both cards, out of and into the bottom sides', () => {
      const route = connectionRoute(a, at(200, 30));
      expect(route.points).toEqual([[100, 100], [100, 146], [300, 146], [300, 130]]);
      expect([route.sourceSide, route.targetSide, route.axis]).toEqual(['bottom', 'bottom', 'y']);
    });

    it('a gap narrower than 20 px goes around too; 20 px is enough for facing sides', () => {
      expect(connectionRoute(a, at(210, 0)).sourceSide).toBe('bottom');
      expect(connectionRoute(a, at(220, 0)).points).toEqual([[200, 50], [220, 50]]);
    });

    it('overlapping cards go around too, with the drag axis across the outer run', () => {
      expect(connectionRoute(a, at(50, 20)).axis).toBe('y');
      expect(connectionRoute(a, at(10, 60)).axis).toBe('x');
    });

    it('the bend sets how far out the outer run goes (32 px × bend)', () => {
      expect(connectionRoute(a, at(0, 100), 0.25).points[1]).toEqual([208, 50]);
      expect(connectionRoute(a, at(0, 100), 0.95).handle).toEqual([230.4, 100]);
    });
  });
});

describe('bendFromPointer', () => {
  it('turns the pointer position into the fraction of the gap, clamped to [0.05, 0.95]', () => {
    expect(bendFromPointer(a, at(400, 60), { x: 250, y: 999 })).toBe(0.25);
    expect(bendFromPointer(a, at(400, 60), { x: -1000, y: 0 })).toBe(0.05);
    expect(bendFromPointer(a, at(400, 60), { x: 5000, y: 0 })).toBe(0.95);
    expect(bendFromPointer(a, at(20, 300), { x: 0, y: 260 })).toBeCloseTo(0.8);
  });

  it('follows the route direction (target on the left or above)', () => {
    expect(bendFromPointer(a, at(-400, 60), { x: -50, y: 0 })).toBe(0.25);
    expect(bendFromPointer(a, at(20, -300), { x: 0, y: -150 })).toBe(0.75);
  });

  it('around the cards: how far past their outer side the pointer is, over 32 px', () => {
    expect(bendFromPointer(a, at(0, 100), { x: 208, y: 0 })).toBe(0.25);
    expect(bendFromPointer(a, at(200, 30), { x: 0, y: 154 })).toBe(0.75);
  });

  it('falls back to the middle when the pointer is not a number', () => {
    expect(bendFromPointer(a, at(400, 60), { x: Number.NaN, y: 0 })).toBe(0.5);
  });
});
