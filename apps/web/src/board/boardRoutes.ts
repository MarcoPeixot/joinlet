import { nudgeParallels, placeLabels, pointAtHalf, routeCorridors, routeKey, textWidth } from '@strukt/layout';
import type { Point } from '@strukt/layout';
import type { Board, BoardConnection, WorkspaceData } from '@strukt/workspace';
import type { StoreApi } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { afterPause } from '../state/routing';
import type { Schedule } from '../state/routing';
import { connectionRoute } from './connectionPath';
import type { BendAxis } from './connectionPath';

type Box = { x: number; y: number; w: number; h: number };

/** A Overview connection routed around the cards; derived state, never saved in `board.json`. */
export interface BoardRoute {
  points: Point[];
  /** Center of the label pill (labelled connections), placed clear of the cards. */
  label?: Point;
  /** The two cards' boxes the route was computed for (`routeKey`). */
  key: string;
}

/** The label pill (`.strukt-link__label`): 12 px text, 10 px padding and a 1 px border each side, 22 px tall. */
export function linkLabelSize(text: string): { w: number; h: number } {
  return { w: Math.min(240, textWidth(text, 12) + 22), h: 22 };
}

/** Room for the label pill and visible breathing space alongside cards. */
const CLEARANCE = 28;
const LABEL_CLEARANCE = 12;
export const ENDPOINT_GAP = 12;
const grow = (box: Box, by: number): Box => ({ x: box.x - by, y: box.y - by, w: box.w + by * 2, h: box.h + by * 2 });

/** Shorten both ends along the polyline, consuming tiny leads without leaving duplicate vertices. */
export function separateEndpoints(points: readonly Point[]): Point[] {
  const length = points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i]![0], p[1] - points[i]![1]), 0);
  const gap = Math.min(ENDPOINT_GAP, length / 4);
  const trim = (input: readonly Point[]): Point[] => {
    const out = input.map(p => [...p] as Point);
    let remaining = gap;
    while (out.length > 1) {
      const a = out[0]!, b = out[1]!;
      const segment = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (segment > remaining) {
        out[0] = [a[0] + (b[0] - a[0]) * remaining / segment, a[1] + (b[1] - a[1]) * remaining / segment];
        break;
      }
      remaining -= segment;
      out.shift();
    }
    return out;
  };
  return trim(trim(points).reverse()).reverse();
}

/**
 * A card as the router sees it: grown by `CLEARANCE` so routes keep that far from it, with the card
 * itself as the outline so connections still start and end on its border.
 */
function clearanceEntity(card: Box & { id: string }) {
  const w = card.w + 2 * CLEARANCE;
  const h = card.h + 2 * CLEARANCE;
  const [left, top] = [(CLEARANCE / w) * 100, (CLEARANCE / h) * 100];
  const [right, bottom] = [100 - left, 100 - top];
  return {
    id: card.id,
    x: card.x - CLEARANCE,
    y: card.y - CLEARANCE,
    width: w,
    height: h,
    outline: { kind: 'polygon' as const, vertices: [[left, top], [right, top], [right, bottom], [left, bottom]] as [number, number][] },
  };
}

/**
 * Routes the connections without a manual bend around the cards (notes included; sections are frames,
 * not obstacles) and places their labels. A connection the router cannot route (flush cards, say) is left
 * out: `connectionView` draws its plain elbow instead.
 */
export function computeBoardRoutes(board: Board): Record<string, BoardRoute> {
  const auto = board.connections.filter((c) => c.bend === undefined);
  const cards = new Map(board.cards.map((card) => [card.id, card]));
  const entities = board.cards.map(clearanceEntity);
  const routed = nudgeParallels(
    routeCorridors(entities, auto.map((c) => ({ id: c.id, from: c.from, to: c.to, toArrowhead: true }))),
    board.cards.map(card => grow(card, CLEARANCE)),
    18,
  );
  const out: Record<string, BoardRoute> = {};
  for (const c of auto) {
    const points = routed[c.id];
    if (points) out[c.id] = { points: separateEndpoints(points), key: routeKey(cards.get(c.from)!, cards.get(c.to)!) };
  }
  const requests = auto.flatMap((c) => (c.label && out[c.id] ? [{ id: c.id, points: out[c.id]!.points, ...linkLabelSize(c.label) }] : []));
  const routes = Object.fromEntries(Object.entries(out).map(([id, route]) => [id, route.points]));
  for (const [id, label] of Object.entries(placeLabels(requests, { boxes: board.cards.map(card => grow(card, LABEL_CLEARANCE)), routes }))) out[id]!.label = label;
  return out;
}

export interface ConnectionView {
  points: Point[];
  /** Center of the label pill, and the grip's anchor (the grip sits just past the pill, or here without one). */
  labelAt: Point;
  /** Orientation of the run under `labelAt`: the grip goes after the pill along it. */
  run: 'h' | 'v';
  /** The axis dragging the grip moves the middle run along (that of the plain elbow). */
  axis: BendAxis;
  /** Whether the plain elbow has a middle run to drag (a straight line has none). */
  bendable: boolean;
}

/** Orientation of the segment of `points` that `at` lies on. */
function runAt(points: readonly Point[], at: Point): 'h' | 'v' {
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1]!, points[i]!];
    const within = (k: 0 | 1) => at[k] >= Math.min(a[k], b[k]) - 0.5 && at[k] <= Math.max(a[k], b[k]) + 0.5;
    if (within(0) && within(1) && a[0] !== b[0]) return 'h';
    if (within(0) && within(1)) return 'v';
  }
  return 'h';
}

/**
 * What FloatingEdge draws. A manual bend (the grip was dragged; `null` in `board.json` puts it back) is
 * the user's explicit override: the plain elbow at that bend, whatever was routed. Otherwise the routed
 * path while it was computed for these two card boxes, with its placed label; until then (or right
 * after a card moved) the plain elbow at the middle. On the plain elbow the label sits on the middle
 * run, at the grip, so dragging it carries the label along instead of sliding it onto a corner.
 */
export function connectionView(connection: BoardConnection, a: Box, b: Box, cached: BoardRoute | undefined, dragBend: number | null): ConnectionView {
  const bend = dragBend ?? connection.bend;
  const plain = connectionRoute(a, b, bend ?? 0.5);
  const bendable = plain.points.length > 2;
  if (bend === undefined && cached && cached.key === routeKey(a, b)) {
    const labelAt = cached.label ?? pointAtHalf(cached.points);
    return { points: cached.points, labelAt, run: runAt(cached.points, labelAt), axis: plain.axis, bendable };
  }
  return { points: separateEndpoints(plain.points), labelAt: plain.handle, run: plain.axis === 'x' ? 'v' : 'h', axis: plain.axis, bendable };
}

/** Routes of the Overview on screen, by connection id. */
export const boardRoutesStore = createStore<{ routes: Record<string, BoardRoute> }>()(() => ({ routes: {} }));

/** The geometry routes depend on: card boxes and the connections (typing in a note changes none of it). */
function geometryKey(board: Board): string {
  return JSON.stringify([
    board.cards.map((c) => [c.id, c.x, c.y, c.w, c.h]),
    board.connections.map((c) => [c.id, c.from, c.to, c.bend ?? null, c.label ?? null]),
  ]);
}

/**
 * Routes the Overview ~100 ms after its geometry stops changing (a card drag commits every frame), like the
 * diagram's `startRouting`; until then connections draw their plain elbow. Returns a stop function.
 */
export function startBoardRouting(store: StoreApi<{ data: WorkspaceData | null }>, schedule: Schedule = afterPause): () => void {
  let routedFor: string | null = null;
  let cancel: (() => void) | null = null;
  const refresh = () => {
    cancel = null;
    const board = store.getState().data?.board;
    const key = board ? geometryKey(board) : '';
    if (key === routedFor) return;
    routedFor = key;
    boardRoutesStore.setState({ routes: board ? computeBoardRoutes(board) : {} });
  };
  const request = () => {
    cancel?.();
    cancel = schedule(refresh);
  };
  request();
  const unsubscribe = store.subscribe((state, prev) => {
    if (state.data?.board !== prev.data?.board) request();
  });
  return () => {
    cancel?.();
    unsubscribe();
  };
}
