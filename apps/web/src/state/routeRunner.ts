import type { DiagramModel, ID, LayoutState, Rect } from '@strukt/core';
import { orthogonalRouter } from '@strukt/layout';
import type { EdgeRouter } from '@strukt/layout';
import { loadEraserRouter } from './eraserRouter';
import { computeRoutes } from './routing';

export type RouteRunner = (model: DiagramModel, rects: Readonly<Record<ID, Rect>>) => Promise<LayoutState['edges']>;

/** Above this many edges the eraser router is too slow (seconds); plain orthogonal routes are used instead. */
export const ORTHOGONAL_THRESHOLD = 300;

export type RouteRequest = { id: number; model: DiagramModel; rects: Readonly<Record<ID, Rect>>; orthogonal: boolean };
export type RouteResponse = { id: number; edges: LayoutState['edges'] };

type Pending = { request: RouteRequest; resolve: (edges: LayoutState['edges']) => void };

/**
 * Routes in a module Web Worker (the worker always uses the eraser router, or the orthogonal one past the
 * threshold); without `Worker`, or if it fails, `router` runs on the calling thread (loaded on demand when
 * not given, so the initial bundle does not carry it). `router` is used only in that fallback: in worker mode
 * the worker's own routers decide, whatever is passed here.
 */
export function createRouteRunner(router?: EdgeRouter): RouteRunner {
  const pending = new Map<number, Pending>();
  let worker: Worker | null = null;
  let broken = typeof Worker === 'undefined';
  let nextId = 0;

  const sync = async ({ model, rects, orthogonal }: RouteRequest) => computeRoutes(model, rects, orthogonal ? orthogonalRouter : (router ?? (await loadEraserRouter())));

  const fail = () => {
    broken = true;
    worker?.terminate();
    worker = null;
    const orphans = [...pending.values()];
    pending.clear();
    for (const { request, resolve } of orphans) void sync(request).then(resolve);
  };

  const start = (): Worker | null => {
    if (broken) return null;
    if (worker) return worker;
    try {
      const created = new Worker(new URL('./routeWorker.ts', import.meta.url), { type: 'module' });
      created.onmessage = ({ data }: MessageEvent<RouteResponse>) => {
        const entry = pending.get(data.id);
        if (!entry) return;
        pending.delete(data.id);
        entry.resolve(data.edges);
      };
      created.onerror = fail;
      created.onmessageerror = fail;
      worker = created;
      return created;
    } catch {
      broken = true;
      return null;
    }
  };

  return (model, rects) => {
    const request: RouteRequest = { id: nextId++, model, rects, orthogonal: model.edges.length > ORTHOGONAL_THRESHOLD };
    const target = start();
    if (!target) return sync(request);
    return new Promise((resolve) => {
      pending.set(request.id, { request, resolve });
      try {
        target.postMessage(request);
      } catch {
        fail();
      }
    });
  };
}
