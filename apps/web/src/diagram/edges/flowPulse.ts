import type { ConnectorStyle } from '@strukt/core';
import { polylineLength, roundedPath } from '@strukt/layout';
import type { Point } from '@strukt/layout';

/** "Animar fluxo": packets travel at a constant speed, so a long line takes longer than a short one. */
const PULSE_SPEED = 120;
const PULSE_MIN_SECONDS = 1.2;
/** Length of the bar that stands for a request travelling along the line. */
export const PULSE_BAR = 18;

export type PulseDirection = 'forward' | 'backward';

export interface PulseTrack {
  /** SVG path the packet follows, from where the request leaves to where it arrives. */
  path: string;
  /** Seconds per trip. */
  dur: number;
  /** Length of the route, for the bar's dash. */
  length: number;
}

export function pulseDuration(length: number): number {
  return Math.max(PULSE_MIN_SECONDS, Math.round((length / PULSE_SPEED) * 100) / 100);
}

/** Requests travel toward the arrow; both arrows → both ways; no arrow → from → to. */
export function pulseDirections(style: Pick<ConnectorStyle, 'startArrow' | 'endArrow'>): PulseDirection[] {
  if (style.startArrow && style.endArrow) return ['forward', 'backward'];
  return style.startArrow ? ['backward'] : ['forward'];
}

/** One track per direction along the drawn route (same rounded corners), full length: border to arrow tip. */
export function pulseTracks(points: readonly Point[], directions: readonly PulseDirection[]): PulseTrack[] {
  if (points.length < 2) return [];
  const length = polylineLength(points);
  const dur = pulseDuration(length);
  return directions.map((direction) => ({ path: roundedPath(direction === 'forward' ? points : [...points].reverse()), dur, length }));
}

/**
 * One dash of a fixed length followed by a gap as long as the route: animating the offset from `from` to
 * `to` slides that single bar in at the start and out past the end (never more than half the route).
 */
export function pulseBar(length: number): { dasharray: string; from: number; to: number } {
  const bar = Math.min(PULSE_BAR, Math.round((length / 2) * 100) / 100);
  return { dasharray: `${bar} ${length}`, from: bar, to: -length };
}
