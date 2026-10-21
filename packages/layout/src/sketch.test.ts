import { describe, it, expect } from 'vitest';
import { layoutSketch } from './sketch';
import type { SketchShape } from '@strukt/core';
const node = (id: string): SketchShape => ({ id, type: 'rectangle', text: id, x: 80, y: 160, width: 192, height: 88 });
const arrow: SketchShape = { id: 'flow', type: 'arrow', from: 'API', to: 'Cache', x: 0, y: 0, width: 0, height: 0, text: 'consulta' };
describe('sketch graph composition', () => {
  it.each(['horizontal', 'vertical'] as const)('routes a %s graph outside the measured nodes', async (direction) => {
    const result = await layoutSketch([node('API'), node('Cache'), arrow], direction);
    const [api, cache, flow] = result;
    expect(api!.x).toBe(80); expect(api!.y).toBe(160);
    if (direction === 'horizontal') expect(cache!.x).toBeGreaterThan(api!.x + api!.width);
    else expect(cache!.y).toBeGreaterThan(api!.y + api!.height);
    expect(flow!.points!.length).toBeGreaterThanOrEqual(2);
    const end = flow!.points!.at(-1)!;
    const ex = flow!.x + end[0], ey = flow!.y + end[1];
    expect(ex).toBeGreaterThanOrEqual(cache!.x); expect(ex).toBeLessThanOrEqual(cache!.x + cache!.width);
    expect(ey).toBeGreaterThanOrEqual(cache!.y); expect(ey).toBeLessThanOrEqual(cache!.y + cache!.height);
  });
});
