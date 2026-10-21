import * as core from '@strukt/core';
import { computeRects } from '@strukt/core';
import type { NodeBox } from '@strukt/core';
import { edgeLabelSize, orthogonalRouter, routeKey, routeOrthogonal } from '@strukt/layout';
import type { EdgeRouter } from '@strukt/layout';
import { describe, expect, it, vi } from 'vitest';
import { toFlow } from '../diagram/toFlow';
import { createDiagramStore } from './diagramStore';
import { computeRoutes, geometryKey, startRouting } from './routing';
import type { Schedule } from './routing';

// computeRects is wrapped (delegating to the real one) only so a test can count calls per refresh.
vi.mock('@strukt/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@strukt/core')>();
  return { ...actual, computeRects: vi.fn(actual.computeRects) };
});

const immediately: Schedule = (task) => {
  task();
  return () => {};
};

/** Tasks wait until `flush()`, like a timer that fires only when the test says so. */
function manualSchedule() {
  const queue = new Set<() => void>();
  const schedule: Schedule = (task) => {
    const run = () => task();
    queue.add(run);
    return () => queue.delete(run);
  };
  const flush = () => {
    const tasks = [...queue];
    queue.clear();
    for (const task of tasks) task();
  };
  return { schedule, flush, queue };
}

/** Lets the runner promise and the refresh continuation settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function setup(schedule: Schedule = immediately) {
  const route = vi.fn<EdgeRouter['route']>((model) =>
    Object.fromEntries(model.edges.map((edge) => [edge.id, [[-1, -1], [-2, -2]] as [number, number][]])),
  );
  const store = createDiagramStore();
  const stop = startRouting(store, async (model, rects) => computeRoutes(model, rects, { route }), schedule);
  store.getState().apply(
    [
      { op: 'add_node', id: 'A' },
      { op: 'add_node', id: 'B' },
      { op: 'add_node', id: 'C' },
      { op: 'connect', from: 'A', to: 'B' },
      { op: 'connect', from: 'B', to: 'C' },
    ],
    { A: { x: 0, y: 0 }, B: { x: 300, y: 0 }, C: { x: 600, y: 0 } },
  );
  await settle();
  return { store, route, stop };
}

describe('startRouting', () => {
  it('invalidates routing hints and group titles even when endpoint geometry is unchanged', async()=>{
    const {store,route}=await setup();
    const old=store.getState(), rects=computeRects(old.model,old.layout), key=geometryKey(old.model,rects);
    store.getState().apply([{op:'update_edge',edgeId:'A→B',set:{fromPort:'top'}}]);
    await settle();
    expect(geometryKey(store.getState().model,rects)).not.toBe(key);
    expect(route).toHaveBeenCalledTimes(2);
  });
  it('caches keyed routes after a commit and the canvas draws them', async () => {
    const { store, route } = await setup();
    const { model, layout } = store.getState();
    const rects = computeRects(model, layout);
    expect(route).toHaveBeenCalledTimes(1);
    expect(layout.edges['A→B']).toEqual({ points: [[-1, -1], [-2, -2]], key: routeKey(rects.A!, rects.B!) });
    const { edges } = toFlow(model, layout, { nodes: [], edges: [] }, 'light');
    expect(edges[0]!.data!.points).toEqual([[-1, -1], [-2, -2]]);
  });

  it('does not route mid-drag; moved edges fall back until the gesture ends', async () => {
    const { store, route } = await setup();
    store.getState().beginGesture();
    store.getState().moveLive({ C: { x: 600, y: 300 } });
    expect(route).toHaveBeenCalledTimes(1);
    const live = store.getState();
    const rects = computeRects(live.model, live.layout);
    const { edges } = toFlow(live.model, live.layout, { nodes: [], edges: [] }, 'light');
    expect(edges.find((e) => e.id === 'A→B')!.data!.points).toEqual([[-1, -1], [-2, -2]]);
    expect(edges.find((e) => e.id === 'B→C')!.data!.points).toEqual(routeOrthogonal(rects.B!, rects.C!).points);
    store.getState().endGesture();
    await settle();
    expect(route).toHaveBeenCalledTimes(2);
    expect(store.getState().layout.edges['B→C']?.key).toBe(routeKey(rects.B!, rects.C!));
  });

  it('reroutes when an unconnected node or empty group moves: routes avoid every rect, not only their ends', async () => {
    const { store, route } = await setup();
    store.getState().apply([{ op: 'add_node', id: 'D' }, { op: 'add_group', id: 'G' }], { D: { x: 300, y: 300 }, G: { x: 0, y: 500 } });
    await settle();
    expect(route).toHaveBeenCalledTimes(2);
    for (const moved of [{ D: { x: 150, y: 0 } }, { G: { x: 100, y: -60 } }] as Record<string, NodeBox>[]) {
      store.getState().beginGesture();
      store.getState().moveLive(moved);
      store.getState().endGesture();
      await settle();
    }
    expect(route).toHaveBeenCalledTimes(4);
    store.getState().setRoutes({ ...store.getState().layout.edges });
    await settle();
    expect(route).toHaveBeenCalledTimes(4);
  });

  it('places labels with the routes and places them again when a label text changes, although nothing moved', async () => {
    const { store, route } = await setup();
    expect(route).toHaveBeenCalledTimes(1);
    store.getState().apply([{ op: 'update_edge', edgeId: 'A→B', set: { label: 'HTTP' } }]);
    await settle();
    expect(route).toHaveBeenCalledTimes(2);
    const {model,layout}=store.getState(), label=layout.edges['A→B']!.label!, size=edgeLabelSize('HTTP');
    const box={x:label[0]-size.w/2,y:label[1]-size.h/2,...size};
    for(const rect of Object.values(computeRects(model,layout)))expect(box.x+box.w<=rect.x||box.x>=rect.x+rect.w||box.y+box.h<=rect.y||box.y>=rect.y+rect.h).toBe(true);
    expect(store.getState().layout.edges['B→C']!.label).toBeUndefined();
  });

  it('recomputes routes after undo/redo instead of restoring them, and stops when unsubscribed', async () => {
    const { store, route, stop } = await setup();
    store.getState().apply([{ op: 'update', id: 'A', set: { label: 'Alfa' } }]);
    await settle();
    expect(route).toHaveBeenCalledTimes(2);
    store.getState().undo();
    await settle();
    expect(route).toHaveBeenCalledTimes(3);
    expect(store.getState().layout.edges['A→B']?.points).toEqual([[-1, -1], [-2, -2]]);
    store.getState().redo();
    await settle();
    expect(route).toHaveBeenCalledTimes(4);
    stop();
    store.getState().apply([{ op: 'connect', from: 'A', to: 'C' }]);
    expect(route).toHaveBeenCalledTimes(4);
  });

  it('coalesces a burst of commits (arrow-key nudges) into one reroute of the latest geometry', async () => {
    const clock = manualSchedule();
    const { store, route } = await setup(clock.schedule);
    clock.flush();
    await settle();
    expect(route).toHaveBeenCalledTimes(1);
    for (const x of [301, 302, 303, 304]) store.getState().apply([], { B: { x, y: 0 } });
    expect(route).toHaveBeenCalledTimes(1);
    expect(clock.queue.size).toBe(1);
    // Meanwhile the canvas draws the moved edges as quick orthogonal lines.
    const live = store.getState();
    const rects = computeRects(live.model, live.layout);
    expect(toFlow(live.model, live.layout, { nodes: [], edges: [] }, 'light').edges[0]!.data!.points).toEqual(
      routeOrthogonal(rects.A!, rects.B!).points,
    );
    clock.flush();
    await settle();
    expect(route).toHaveBeenCalledTimes(2);
    expect(store.getState().layout.edges['A→B']?.key).toBe(routeKey(rects.A!, rects.B!));
  });

  it('drops routes computed for a layout that changed meanwhile, then routes the new one', async () => {
    const clock = manualSchedule();
    const { store, route } = await setup(clock.schedule);
    route.mockImplementationOnce((model) => {
      store.getState().apply([], { C: { x: 900, y: 0 } });
      return Object.fromEntries(model.edges.map((edge) => [edge.id, [[7, 7], [8, 8]] as [number, number][]]));
    });
    clock.flush();
    await settle();
    expect(store.getState().layout.edges).toEqual({});
    clock.flush();
    await settle();
    expect(route).toHaveBeenCalledTimes(2);
    expect(store.getState().layout.edges['B→C']?.points).toEqual([[-1, -1], [-2, -2]]);
  });

  it('computes the rects once per reroute and cancels pending work when stopped', async () => {
    const clock = manualSchedule();
    const { store, route, stop } = await setup(clock.schedule);
    vi.mocked(core.computeRects).mockClear();
    clock.flush();
    await settle();
    expect(route).toHaveBeenCalledTimes(1);
    expect(core.computeRects).toHaveBeenCalledTimes(1);
    store.getState().apply([], { A: { x: 10, y: 0 } });
    stop();
    clock.flush();
    expect(route).toHaveBeenCalledTimes(1);
  });

  it('drops a result that resolves after the geometry changed, and never applies out-of-order results', async () => {
    const clock = manualSchedule();
    const store = createDiagramStore();
    const pending: Array<(edges: Parameters<ReturnType<typeof store.getState>['setRoutes']>[0]) => void> = [];
    const runner = () => new Promise<Parameters<ReturnType<typeof store.getState>['setRoutes']>[0]>((resolve) => pending.push(resolve));
    const stop = startRouting(store, runner, clock.schedule);
    store.getState().apply([{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }, { op: 'connect', from: 'A', to: 'B' }], { A: { x: 0, y: 0 }, B: { x: 300, y: 0 } });
    clock.flush();
    expect(pending).toHaveLength(1);
    store.getState().apply([], { B: { x: 400, y: 0 } });
    pending[0]!({ 'A→B': { points: [[1, 1], [2, 2]], key: 'old' } });
    await settle();
    expect(store.getState().layout.edges).toEqual({});
    clock.flush();
    expect(pending).toHaveLength(2);
    // A newer refresh with an unchanged geometry supersedes the one in flight: only the latest may land.
    store.getState().apply([{ op: 'update', id: 'A', set: { label: 'x' } }]);
    clock.flush();
    expect(pending).toHaveLength(3);
    pending[2]!({ 'A→B': { points: [[5, 5], [6, 6]], key: 'new' } });
    await settle();
    pending[1]!({ 'A→B': { points: [[3, 3], [4, 4]], key: 'older' } });
    await settle();
    expect(store.getState().layout.edges['A→B']?.key).toBe('new');
    stop();
  });

  it('logs a failing runner once, without an unhandled rejection, and later refreshes still land', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const clock = manualSchedule();
    const store = createDiagramStore();
    let failing = true;
    const runner = vi.fn(async (model: Parameters<typeof computeRoutes>[0], rects: Parameters<typeof computeRoutes>[1]) => {
      if (failing) throw new Error('worker exploded');
      return computeRoutes(model, rects, orthogonalRouter);
    });
    const stop = startRouting(store, runner, clock.schedule);
    store.getState().apply([{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }, { op: 'connect', from: 'A', to: 'B' }], { A: { x: 0, y: 0 }, B: { x: 300, y: 0 } });
    clock.flush();
    await settle();
    store.getState().apply([], { B: { x: 400, y: 0 } });
    clock.flush();
    await settle();
    expect(runner).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
    expect(store.getState().layout.edges).toEqual({});

    failing = false;
    store.getState().apply([], { B: { x: 500, y: 0 } });
    clock.flush();
    await settle();
    expect(store.getState().layout.edges['A→B']).toBeDefined();
    stop();
    error.mockRestore();
  });
});
