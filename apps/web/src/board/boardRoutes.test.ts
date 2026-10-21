import { routeKey } from '@strukt/layout';
import type { Point } from '@strukt/layout';
import { NOTE_SIZE, addNote, connectCards, emptyBoard, moveBoard, updateCard, updateConnection } from '@strukt/workspace';
import type { Board, WorkspaceData } from '@strukt/workspace';
import { emptyManifest } from '@strukt/workspace';
import { describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';
import type { Schedule } from '../state/routing';
import { boardRoutesStore, computeBoardRoutes, connectionView, linkLabelSize, startBoardRouting } from './boardRoutes';
import type { BoardRoute } from './boardRoutes';
import { connectionRoute } from './connectionPath';

type Box = { x: number; y: number; w: number; h: number };
const crosses = ([ax, ay]: Point, [bx, by]: Point, r: Box) =>
  Math.min(ax, bx) < r.x + r.w && Math.max(ax, bx) > r.x && Math.min(ay, by) < r.y + r.h && Math.max(ay, by) > r.y;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const allFinite = (points: readonly Point[]) => points.every((p) => p.every(Number.isFinite));
const card = (board: Board, id: string) => board.cards.find((c) => c.id === id)!;

/** Three notes in a row (n0, n1, n2) and a connection n0 → n2 that the straight line would draw behind n1. */
function row(): Board {
  let board = emptyBoard();
  for (const [i, x] of [0, 280, 560].entries()) board = addNote(board, `n${i}`, { x, y: 0 });
  return connectCards(board, 'c', 'n0', 'n2');
}

describe('computeBoardRoutes', () => {
  it('routes a connection around a card between its ends', () => {
    const board = row();
    const route = computeBoardRoutes(board).c!;
    const middle = card(board, 'n1');
    expect(route.points.slice(1).some((p, i) => crosses(route.points[i]!, p, middle))).toBe(false);
    expect(route.key).toBe(routeKey(card(board, 'n0'), card(board, 'n2')));
  });

  it('keeps its detour at least 12 px from the cards, still starting and ending on their borders', () => {
    const board = row();
    const { points } = computeBoardRoutes(board).c!;
    const middle = card(board, 'n1');
    const grown = { x: middle.x - 12, y: middle.y - 12, w: middle.w + 24, h: middle.h + 24 };
    expect(points.slice(1).some((p, i) => crosses(points[i]!, p, grown))).toBe(false);
    expect(points[0]![0]).toBe(200);
    expect(points.at(-1)![0]).toBe(560);
  });

  it('places the label on the route, clear of every card', () => {
    const board = updateConnection(row(), 'c', { label: 'HTTP' });
    const route = computeBoardRoutes(board).c!;
    const { w, h } = linkLabelSize('HTTP');
    const pill = { x: route.label![0] - w / 2, y: route.label![1] - h / 2, w, h };
    expect(board.cards.filter((c) => overlaps(pill, c)).map((c) => c.id)).toEqual([]);
  });

  it('leaves out a connection with a manual bend: the user’s own elbow wins', () => {
    expect(computeBoardRoutes(updateConnection(row(), 'c', { bend: 0.3 }))).toEqual({});
  });

  it('leaves out what the router cannot route (flush cards): their own route is drawn instead', () => {
    let board = addNote(addNote(emptyBoard(), 'a', { x: 0, y: 0 }), 'b', { x: 0, y: NOTE_SIZE.h });
    board = connectCards(board, 'c', 'a', 'b');
    expect(computeBoardRoutes(board)).toEqual({});
  });
});

describe('connectionView', () => {
  const a = { x: 0, y: 0, w: 200, h: 160 };
  const b = { x: 400, y: 100, w: 200, h: 160 };
  const connection = { id: 'c', from: 'a', to: 'b' };
  const routed: BoardRoute = { points: [[200, 80], [300, 80], [300, 180], [400, 180]], label: [250, 80], key: routeKey(a, b) };

  it('draws the routed path and its placed label while the route holds', () => {
    const view = connectionView(connection, a, b, routed, null);
    expect(view.points).toBe(routed.points);
    expect(view.labelAt).toEqual([250, 80]);
    expect(view.run).toBe('h');
  });

  it('falls back to the plain elbow (label and grip on its middle run) until routed or once a card moved', () => {
    const plain = connectionRoute(a, b);
    for (const cached of [undefined, { ...routed, key: 'stale' }]) {
      const view = connectionView(connection, a, b, cached, null);
      expect(view.points).toEqual(plain.points);
      expect(view.labelAt).toEqual(plain.handle);
      expect(allFinite(view.points)).toBe(true);
      expect(view.run).toBe('v');
    }
  });

  it('a manual bend, or one being dragged, is the plain elbow at that bend, whatever was routed', () => {
    expect(connectionView({ ...connection, bend: 0.2 }, a, b, routed, null).points).toEqual(connectionRoute(a, b, 0.2).points);
    expect(connectionView(connection, a, b, routed, 0.8).points).toEqual(connectionRoute(a, b, 0.8).points);
  });

  it('flush cards get a visible route around them, with a grip', () => {
    const view = connectionView(connection, a, { x: 0, y: 160, w: 200, h: 160 }, undefined, null);
    expect(view.points).toHaveLength(4);
    expect(view.bendable).toBe(true);
  });
});

describe('startBoardRouting', () => {
  function setup() {
    const queue: (() => void)[] = [];
    const schedule: Schedule = (task) => {
      queue.push(task);
      return () => {
        if (queue.includes(task)) queue.splice(queue.indexOf(task), 1);
      };
    };
    const data: WorkspaceData = { manifest: emptyManifest('x'), diagrams: {}, docs: {}, sketches: {}, board: row() };
    const store = createStore<{ data: WorkspaceData | null }>()(() => ({ data }));
    const setBoard = (update: (board: Board) => Board) => store.setState((s) => ({ data: { ...s.data!, board: update(s.data!.board) } }));
    const flush = () => queue.splice(0).forEach((task) => task());
    return { store, setBoard, flush, queue, stop: startBoardRouting(store, schedule) };
  }

  it('routes once the changes pause, again when a card moves, not when a note is typed in', () => {
    const { setBoard, flush, queue, stop } = setup();
    flush();
    const first = boardRoutesStore.getState().routes;
    expect(first.c).toBeDefined();
    setBoard((board) => updateCard(board, 'n1', { text: 'oi' }));
    flush();
    expect(boardRoutesStore.getState().routes).toBe(first);
    setBoard((board) => moveBoard(board, { n1: { y: 400 } }));
    setBoard((board) => moveBoard(board, { n1: { y: 420 } }));
    expect(queue).toHaveLength(1);
    flush();
    expect(boardRoutesStore.getState().routes).not.toBe(first);
    stop();
    setBoard((board) => moveBoard(board, { n1: { y: 0 } }));
    expect(queue).toHaveLength(0);
  });
});
