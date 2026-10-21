import type { Locator } from '@playwright/test';

/** Client coordinates of `samples + 1` evenly spaced points along an SVG path, both ends included. */
export function pathPoints(path: Locator, samples = 40): Promise<{ x: number; y: number }[]> {
  return path.evaluate((el, n) => {
    const svg = el as SVGPathElement;
    const m = svg.getScreenCTM()!;
    const total = svg.getTotalLength();
    return Array.from({ length: n + 1 }, (_, i) => {
      const p = svg.getPointAtLength((total * i) / n);
      return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
    });
  }, samples);
}
