import { SHAPES } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { labelBox, shapeGeometry } from './shapes';

describe('shapeGeometry', () => {
  it.each(SHAPES)('%s builds a finite closed path', (shape) => {
    const geo = shapeGeometry(shape, 160, 80);
    expect(geo.d.startsWith('M')).toBe(true);
    expect(geo.d).not.toMatch(/NaN|Infinity/);
    const box = labelBox(shape, 160, 80);
    expect(box.w).toBeGreaterThan(0);
    expect(box.h).toBeGreaterThan(0);
  });
  it('cylinders expose the front lip of the top ellipse', () => {
    expect(shapeGeometry('cylinder', 120, 88).detail).toMatch(/^M 0 12 A 60 12/);
  });
});
