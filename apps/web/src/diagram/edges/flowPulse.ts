import type { ConnectorStyle } from '@strukt/core';
import { polylineLength, roundedPath } from '@strukt/layout';
import type { Point } from '@strukt/layout';

/** Every request travels at this speed (diagram units per second) on every connection, short or long. */
export const PULSE_SPEED = 120;
/** And one leaves every this many seconds on every connection: the same rhythm (and spacing) everywhere. */
export const PULSE_PERIOD = 1.6;
/** Length of the bar that stands for a request travelling along the line. */
export const PULSE_BAR = 18;
/** The trail is this many times the bar: a soft tail behind a bright head. */
export const PULSE_TRAIL = 2.5;
/** Layers that build the trail's gradient (more is smoother, each is one more animated dash). */
export const PULSE_LAYERS = 5;

export type PulseDirection = 'forward' | 'backward';

export interface PulseTrack {
  /** SVG path the packet follows, from where the request leaves to where it arrives. */
  path: string;
  /** Length of the route. */
  length: number;
  /** Requests on the route at once, one PULSE_PERIOD apart. */
  count: number;
  /** Seconds before a request leaves again (count × PULSE_PERIOD): long enough to cross the whole route. */
  cycle: number;
}

/** Requests travel toward the arrow; both arrows → both ways; no arrow → from → to. */
export function pulseDirections(style: Pick<ConnectorStyle, 'startArrow' | 'endArrow'>): PulseDirection[] {
  if (style.startArrow && style.endArrow) return ['forward', 'backward'];
  return style.startArrow ? ['backward'] : ['forward'];
}

/** Length of a pulse's trail on a route of `length`: half the route at most. */
export function pulseTrail(length: number): number {
  return Math.min(PULSE_BAR * PULSE_TRAIL, Math.round((length / 2) * 100) / 100);
}

/**
 * One track per direction along the drawn line. A request leaves every PULSE_PERIOD and moves at PULSE_SPEED, so
 * a short line sees one now and then and a long one several at once, always the same distance apart. Each request
 * repeats every `cycle` (whole periods, enough to cross the route with its trail) and, in between, travels on past
 * the end where nothing is drawn.
 */
export function pulseTracks(points: readonly Point[], directions: readonly PulseDirection[]): PulseTrack[] {
  if (points.length < 2) return [];
  const length = polylineLength(points);
  const trip = (length + pulseTrail(length)) / PULSE_SPEED;
  const count = Math.max(1, Math.ceil(trip / PULSE_PERIOD - 1e-9));
  const cycle = Math.round(count * PULSE_PERIOD * 1000) / 1000;
  return directions.map((direction) => ({ path: roundedPath(direction === 'forward' ? points : [...points].reverse()), length, count, cycle }));
}

export interface PulseLayer {
  dasharray: string;
  from: number;
  to: number;
  opacity: number;
}

/**
 * The request as a comet: dashes of shrinking length that all end at the same head, each faint, so where they
 * overlap (near the head) the light adds up and the tail fades out — a gradient along the line, which a single
 * SVG stroke cannot have. Each layer starts with its head at the route's start and covers PULSE_SPEED × `cycle`
 * per cycle (one speed everywhere); the gap after the dash is long enough that only one dash ever shows.
 */
export function pulseLayers(length: number, cycle: number, layers = PULSE_LAYERS): PulseLayer[] {
  const head = pulseTrail(length);
  const distance = Math.round(PULSE_SPEED * cycle * 100) / 100;
  const opacity = Math.round((1 - Math.pow(0.1, 1 / layers)) * 1000) / 1000;
  return Array.from({ length: layers }, (_, i) => {
    const dash = Math.round(((head * (layers - i)) / layers) * 100) / 100;
    return { dasharray: `${dash} ${Math.round((distance + length) * 100) / 100}`, from: dash, to: Math.round((dash - distance) * 100) / 100, opacity };
  });
}
