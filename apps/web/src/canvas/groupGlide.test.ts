import { describe, expect, it } from 'vitest';
import { createGroupGlide, glideRect } from './groupGlide';

describe('glideRect', () => {
  it('moves only the edges whose place changes', () => {
    // The left edge goes out by 40: x and w both change, the right edge stays put.
    const next = glideRect({ x: 100, y: 0, w: 200, h: 100 }, { x: 60, y: 0, w: 240, h: 100 }, 16);
    expect(next.x).toBeLessThan(100);
    expect(next.x).toBeGreaterThan(60);
    expect(next.x + next.w).toBe(300);
    expect(next.y).toBe(0);
    expect(next.y + next.h).toBe(100);
  });

  it('keeps an untouched edge still even when the target changes on the way', () => {
    let rect = { x: 0, y: 100, w: 200, h: 100 };
    for (const top of [60, 80, 40, 90, 50]) {
      rect = glideRect(rect, { x: 0, y: top, w: 200, h: 200 - top }, 16);
      expect(rect.y + rect.h).toBe(200);
      expect(rect.x + rect.w).toBe(200);
    }
  });

  it('lands exactly', () => {
    let rect = { x: 0, y: 0, w: 100, h: 100 };
    for (let i = 0; i < 60; i++) rect = glideRect(rect, { x: 10, y: 20, w: 130, h: 80 }, 16);
    expect(rect).toEqual({ x: 10, y: 20, w: 130, h: 80 });
  });
});

describe('createGroupGlide', () => {
  it('paints frames from where a group is to its target, then reports it landed', () => {
    const frames: (() => void)[] = [];
    let clock = 0;
    const painted: number[] = [];
    let landed = false;
    const glide = createGroupGlide((shown) => painted.push(shown.G!.w), (tick) => frames.push(tick), () => {}, () => clock);
    glide.settle({ G: { x: 0, y: 0, w: 300, h: 100 } }, { G: { x: 0, y: 0, w: 200, h: 100 } }, () => { landed = true; });
    while (frames.length && painted.length < 200) { clock += 16; frames.shift()!(); }
    expect(painted[0]).toBeGreaterThan(200);
    expect(painted.at(-1)).toBe(300);
    expect(painted).toEqual([...painted].sort((a, b) => a - b));
    expect(landed).toBe(true);
  });
});
