import { connectorStyle } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { PULSE_BAR, pulseBar, pulseDirections, pulseDuration, pulseTracks } from './flowPulse';

describe('pulseDuration', () => {
  it('keeps the speed constant (120 px/s) with a 1.2 s minimum', () => {
    expect(pulseDuration(240)).toBe(2);
    expect(pulseDuration(600)).toBe(5);
    expect(pulseDuration(60)).toBe(1.2);
    expect(pulseDuration(0)).toBe(1.2);
  });
});

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
  const elbow: [number, number][] = [[0, 0], [100, 0], [100, 140]];

  it('runs along the drawn route (rounded corners included), reversed for the backward direction', () => {
    const [forward, backward] = pulseTracks(elbow, ['forward', 'backward']);
    expect(forward).toEqual({ path: 'M 0 0 L 92 0 Q 100 0 100 8 L 100 140', dur: 2, length: 240 });
    expect(backward).toEqual({ path: 'M 100 140 L 100 8 Q 100 0 92 0 L 0 0', dur: 2, length: 240 });
  });

  it('has nothing to animate on a route with fewer than 2 points', () => {
    expect(pulseTracks([[5, 5]], ['forward'])).toEqual([]);
    expect(pulseTracks([], ['forward'])).toEqual([]);
  });
});

describe('pulseBar (the request drawn as a bar, not a dot)', () => {
  it('is one fixed-length dash that enters at the start and leaves past the end', () => {
    expect(pulseBar(240)).toEqual({ dasharray: `${PULSE_BAR} 240`, from: PULSE_BAR, to: -240 });
  });

  it('keeps the bar the same size on any edge, shrinking only on edges shorter than it', () => {
    expect(pulseBar(1000).dasharray).toBe(`${PULSE_BAR} 1000`);
    expect(pulseBar(10)).toEqual({ dasharray: '5 10', from: 5, to: -10 });
  });
});
