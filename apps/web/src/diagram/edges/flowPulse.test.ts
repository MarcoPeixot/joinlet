import { connectorStyle } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { PULSE_PERIOD, PULSE_SPEED, pulseDirections, pulseLayers, pulseTracks } from './flowPulse';

const track = (length: number) => pulseTracks([[0, 0], [length, 0]], ['forward'])[0]!;

describe('pulseDirections (the way requests travel, from the arrows)', () => {
  it('follows the arrows: end only → forward, start only → backward, both → both ways, none → forward', () => {
    expect(pulseDirections(connectorStyle('>'))).toEqual(['forward']);
    expect(pulseDirections(connectorStyle('-->'))).toEqual(['forward']);
    expect(pulseDirections(connectorStyle('<'))).toEqual(['backward']);
    expect(pulseDirections(connectorStyle('<>'))).toEqual(['forward', 'backward']);
    expect(pulseDirections(connectorStyle('-'))).toEqual(['forward']);
    expect(pulseDirections(connectorStyle('--'))).toEqual(['forward']);
  });
});

describe('pulseTracks', () => {
  it('runs along the drawn route (rounded corners included), reversed for the backward direction', () => {
    const [forward, backward] = pulseTracks([[0, 0], [100, 0], [100, 140]], ['forward', 'backward']);
    expect(forward!.path).toBe('M 0 0 L 92 0 Q 100 0 100 8 L 100 140');
    expect(backward!.path).toBe('M 100 140 L 100 8 Q 100 0 92 0 L 0 0');
    expect(forward!.length).toBe(240);
  });

  it('has nothing to animate on a route with fewer than 2 points', () => {
    expect(pulseTracks([[5, 5]], ['forward'])).toEqual([]);
    expect(pulseTracks([], ['forward'])).toEqual([]);
  });
});

describe('cadence and speed (the same on every connection)', () => {
  it('sends one request every PULSE_PERIOD, short line or long', () => {
    for (const length of [30, 60, 150, 600, 2000]) {
      const { count, cycle } = track(length);
      expect(cycle / count).toBeCloseTo(PULSE_PERIOD, 6);
    }
  });

  it('moves every request at PULSE_SPEED, however long the line', () => {
    for (const length of [30, 60, 150, 600, 2000]) {
      const { cycle } = track(length);
      const [layer] = pulseLayers(length, cycle);
      expect((layer!.from - layer!.to) / cycle).toBeCloseTo(PULSE_SPEED, 1);
    }
  });

  it('keeps one request at a time on a short line and several, evenly spaced, on a long one', () => {
    expect(track(60).count).toBe(1);
    expect(track(2000).count).toBe(Math.ceil((2000 + 45) / PULSE_SPEED / PULSE_PERIOD));
  });

  it('lets each request cross the whole line (with its trail) before it starts over', () => {
    for (const length of [60, 600]) {
      const { cycle } = track(length);
      const [layer] = pulseLayers(length, cycle);
      expect(layer!.from - layer!.to).toBeGreaterThanOrEqual(length + 45 - 1e-6);
    }
  });
});

describe('pulseLayers (the request as a comet with a gradient tail)', () => {
  it('stacks dashes of shrinking length that share one head, starting at the route start', () => {
    const layers = pulseLayers(400, track(400).cycle, 5);
    expect(layers.map((l) => Number(l.dasharray.split(' ')[0]))).toEqual([45, 36, 27, 18, 9]);
    for (const { dasharray, from } of layers) expect(Number(dasharray.split(' ')[0]) - from).toBe(0);
    // All layers travel the same distance, so their heads stay together.
    expect(new Set(layers.map((l) => Math.round((l.from - l.to) * 100)))).toHaveProperty('size', 1);
  });

  it('adds up to a bright head and a faint tail', () => {
    const [layer] = pulseLayers(400, track(400).cycle, 5);
    expect(1 - (1 - layer!.opacity) ** 5).toBeGreaterThan(0.85);
    expect(layer!.opacity).toBeLessThan(0.4);
  });

  it('keeps the trail to half of a short line', () => {
    expect(pulseLayers(40, track(40).cycle, 4)[0]!.dasharray.split(' ')[0]).toBe('20');
  });
});
