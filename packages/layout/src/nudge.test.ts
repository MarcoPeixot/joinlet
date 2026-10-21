import { describe, expect, it } from 'vitest';
import { PARALLEL_GAP, nudgeParallels } from './nudge';
import type { Point } from './route';

/** H–V–H route whose vertical middle segment sits at `x`, from (0, y0) to (300, y1). */
const elbow = (x: number, y0: number, y1: number): Point[] => [[0, y0], [x, y0], [x, y1], [300, y1]];
const middleX = (points: Point[]) => points[1]![0];

describe('nudgeParallels', () => {
  it('spreads parallel middle segments closer than the gap, keeping both ends in place', () => {
    const out = nudgeParallels({ a: elbow(100, 0, 200), b: elbow(108, 20, 220) }, []);
    expect(middleX(out.b!) - middleX(out.a!)).toBeGreaterThanOrEqual(PARALLEL_GAP);
    expect(out.a![1]![0]).toBe(out.a![2]![0]);
    expect([out.a![0], out.a![3], out.b![0], out.b![3]]).toEqual([[0, 0], [300, 200], [0, 20], [300, 220]]);
    // Spread around their middle, not pushed to one side.
    expect((middleX(out.a!) + middleX(out.b!)) / 2).toBe(104);
  });

  it('separates collinear overlapping segments, the one turning in from the left on the left', () => {
    const fromLeft: Point[] = [[0, 0], [100, 0], [100, 200], [300, 200]];
    const fromRight: Point[] = [[400, 50], [100, 50], [100, 250], [300, 250]];
    const out = nudgeParallels({ r: fromRight, l: fromLeft }, []);
    expect(middleX(out.l!)).toBeLessThan(middleX(out.r!));
    expect(middleX(out.r!) - middleX(out.l!)).toBe(PARALLEL_GAP);
  });

  it('spreads three stuck segments evenly', () => {
    const out = nudgeParallels({ a: elbow(100, 0, 200), b: elbow(108, 10, 210), c: elbow(116, 20, 220) }, []);
    expect([middleX(out.a!), middleX(out.b!), middleX(out.c!)]).toEqual([96, 108, 120]);
  });

  it('works on horizontal segments too', () => {
    const vhv = (y: number, x0: number, x1: number): Point[] => [[x0, 0], [x0, y], [x1, y], [x1, 300]];
    const out = nudgeParallels({ a: vhv(150, 0, 200), b: vhv(154, 20, 220) }, []);
    expect(out.b![1]![1] - out.a![1]![1]).toBeGreaterThanOrEqual(PARALLEL_GAP);
  });

  it('leaves alone segments far enough apart, spans that do not overlap and the same route', () => {
    const routes = { a: elbow(100, 0, 100), b: elbow(112, 0, 100), c: elbow(104, 150, 250) };
    const out = nudgeParallels(routes, []);
    expect(out).toEqual(routes);
    const zigzag: Point[] = [[0, 0], [100, 0], [100, 100], [104, 100], [104, 200], [300, 200]];
    expect(nudgeParallels({ z: zigzag }, [])).toEqual({ z: zigzag });
  });

  it('never moves the first or last segment (they attach to the nodes)', () => {
    const a: Point[] = [[100, 0], [100, 200]];
    const b: Point[] = [[104, 0], [104, 200]];
    expect(nudgeParallels({ a, b }, [])).toEqual({ a, b });
  });

  it('keeps a group as it was when spreading would fold back a short lead out of a node', () => {
    // a leaves its node's left side at x = 103 and turns 3 px later; spreading moves its run right, back into the node.
    const a: Point[] = [[103, 0], [100, 0], [100, 200], [300, 200]];
    const b: Point[] = [[0, 20], [100, 20], [100, 220], [300, 220]];
    const routes = { b, a };
    expect(nudgeParallels(routes, [])).toEqual(routes);
  });

  it('does not hold back for an obstacle a segment already crossed (a last segment through its node label box)', () => {
    const label = { x: 250, y: 190, w: 100, h: 40 };
    const out = nudgeParallels({ a: elbow(100, 0, 200), b: elbow(108, 20, 220) }, [label]);
    expect(middleX(out.b!) - middleX(out.a!)).toBe(PARALLEL_GAP);
  });

  it('keeps a group as it was when spreading would push a segment into an obstacle', () => {
    const routes = { a: elbow(100, 0, 200), b: elbow(108, 20, 220) };
    const wall = { x: 60, y: 80, w: 39, h: 40 };
    expect(nudgeParallels(routes, [wall])).toEqual(routes);
  });
});
