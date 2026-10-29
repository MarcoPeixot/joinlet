import type { Rect } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { BORDER_BAND, edgeLabelSize, placeLabels } from './labels';
import type { Point } from './route';

const size = { w: 40, h: 20 };
const boxAt = ([x, y]: Point, s = size): Rect => ({ x: x - s.w / 2, y: y - s.h / 2, w: s.w, h: s.h });
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('edgeLabelSize', () => {
  it('estimates the pill from the text (0.56 em per character at 12 px, 6 px padding each side, 20 px tall)', () => {
    expect(edgeLabelSize('cache')).toEqual({ w: 5 * 12 * 0.56 + 18, h: 22 });
  });
});

describe('placeLabels', () => {
  it('slides a label away from another connector crossing the middle of its segment', () => {
    const own: Point[] = [[0, 0], [400, 0]], other: Point[] = [[200, -100], [200, 100]];
    const at = placeLabels([{ id: 'own', points: own, ...size }], { boxes: [], routes: { own, other } }).own!;
    expect(at[1]).toBe(0);
    expect(overlaps(boxAt(at), { x: 199, y: -100, w: 2, h: 200 })).toBe(false);
  });

  it('keeps a wide label beside a parallel bundle while still touching its own connector', () => {
    const own: Point[] = [[0, 0], [0, 140]], wide = { w: 66, h: 20 };
    const routes = { own, one: [[8, 0], [8, 140]], two: [[16, 0], [16, 140]], three: [[24, 0], [24, 140]] } as Record<string, Point[]>;
    const at = placeLabels([{ id: 'own', points: own, ...wide }], { boxes: [], routes }).own!;
    const box = boxAt(at, wide);
    expect(box.x).toBeLessThanOrEqual(0);
    expect(box.x + box.w).toBeGreaterThanOrEqual(0);
    for (const x of [8, 16, 24]) expect(overlaps(box, { x: x - 1, y: 0, w: 2, h: 140 })).toBe(false);
  });

  it('ignores its own connector and preserves body clearance when other lines cannot be avoided', () => {
    const own: Point[] = [[0, 0], [100, 0]], other: Point[] = [[0, 0], [100, 0]];
    const boxes = [{ x: -40, y: -100, w: 180, h: 90 }, { x: -40, y: 10, w: 180, h: 90 }];
    expect(placeLabels([{ id: 'own', points: own, ...size }], { boxes: [], routes: { own } }).own).toEqual([50, 0]);
    const at = placeLabels([{ id: 'own', points: own, ...size }], { boxes, routes: { own, other } }).own!;
    for (const box of boxes) expect(overlaps(boxAt(at), box)).toBe(false);
  });

  it('retains the established placement for large route batches', () => {
    const own: Point[] = [[0, 0], [400, 0]];
    const routes = Object.fromEntries(Array.from({ length: 151 }, (_, index) => [String(index), [[200, -100], [200, 100]] as Point[]]));
    expect(placeLabels([{ id: 'own', points: own, ...size }], { boxes: [], routes }).own).toEqual([200, 0]);
  });

  it('stays on its own short connector between two adjacent cards, even if it has to cover them a little', () => {
    const own: Point[] = [[500, 42], [528, 42]], wide = { w: 180, h: 20 };
    const caption = { x: 0, y: -36, w: 180, h: 22 };
    const boxes = [{ x: 400, y: 0, w: 100, h: 84 }, { x: 528, y: 0, w: 100, h: 84 }, caption];
    const at = placeLabels([{ id: 'own', points: own, ...wide }], { boxes, borders: [{ x: -28, y: -44, w: 684, h: 156 }], routes: { own } }).own!;
    expect(Math.abs(at[1] - 42)).toBeLessThanOrEqual(wide.h / 2);
  });

  it('never leaves its own line to dodge other lines: the line runs through the pill or along its edge', () => {
    const own: Point[] = [[0, 0], [400, 0]];
    const routes = { own, ...Object.fromEntries([-8, 8, 16, 24, 40, 60].map((y) => [String(y), [[0, y], [400, y]] as Point[]])) };
    const at = placeLabels([{ id: 'own', points: own, ...size }], { boxes: [], routes }).own!;
    expect(Math.abs(at[1])).toBeLessThanOrEqual(size.h / 2);
  });

  it('puts a label in the middle of the longest segment when nothing is in the way', () => {
    const points: Point[] = [[0, 0], [40, 0], [40, 300], [100, 300]];
    expect(placeLabels([{ id: 'e', points, ...size }], { boxes: [] })).toEqual({ e: [40, 150] });
  });

  it('slides along the segment away from a node box, staying on the line', () => {
    const node = { x: 180, y: -30, w: 60, h: 60 };
    const at = placeLabels([{ id: 'e', points: [[0, 0], [400, 0]], ...size }], { boxes: [node] }).e!;
    expect(at[1]).toBe(0);
    expect(overlaps(boxAt(at), node)).toBe(false);
    // The closest clear spot to the middle, in 8 px steps.
    expect(Math.abs(at[0] - 200)).toBeLessThanOrEqual(50 + 8);
  });

  it('keeps clear of labels placed before it', () => {
    const shared: Point[] = [[0, 0], [300, 0]];
    const out = placeLabels(
      [
        { id: 'a', points: shared, ...size },
        { id: 'b', points: shared, ...size },
      ],
      { boxes: [] },
    );
    expect(overlaps(boxAt(out.a!), boxAt(out.b!))).toBe(false);
  });

  it('moves a label slightly beside its route when parallel routes leave no on-line room', () => {
    const routes = [
      { id: 'web', points: [[116, 108], [172, 108], [172, 180], [330, 180]] as Point[], ...edgeLabelSize('HTTPS') },
      { id: 'mobile', points: [[116, 268], [172, 268], [172, 196], [330, 196]] as Point[], ...edgeLabelSize('HTTPS') },
    ];
    const placed = placeLabels(routes, { boxes: [{ x: 288, y: 160, w: 140, h: 92 }], borders: [{ x: -10, y: 36, w: 196, h: 324 }] });
    expect(overlaps(boxAt(placed.web!, edgeLabelSize('HTTPS')), boxAt(placed.mobile!, edgeLabelSize('HTTPS')))).toBe(false);
  });

  it('keeps off a group border (a band on both sides of it)', () => {
    const group = { x: -300, y: -100, w: 450, h: 200 };
    const at = placeLabels([{ id: 'e', points: [[0, 0], [300, 0]], ...size }], { boxes: [], borders: [group] }).e!;
    const box = boxAt(at);
    const border = group.x + group.w;
    expect(box.x > border + BORDER_BAND || box.x + box.w < border - BORDER_BAND).toBe(true);
  });

  it('tries the other segments when the longest one has no room', () => {
    const points: Point[] = [[0, 0], [0, 200], [120, 200]];
    const wall = { x: -40, y: -10, w: 80, h: 220 };
    expect(placeLabels([{ id: 'e', points, ...size }], { boxes: [wall] }).e![1]).toBe(200);
  });

  it('settles for the least overlap when nothing fits', () => {
    // The box covers the segment up to x = 185: the spot furthest right (label 160..200) overlaps it least.
    const box = { x: -20, y: -20, w: 205, h: 40 };
    expect(placeLabels([{ id: 'e', points: [[0, 0], [200, 0]], ...size }], { boxes: [box] })).toEqual({ e: [180, 0] });
  });

  it('skips a route with fewer than 2 points', () => {
    expect(placeLabels([{ id: 'e', points: [[5, 5]], ...size }], { boxes: [] })).toEqual({});
  });
});
