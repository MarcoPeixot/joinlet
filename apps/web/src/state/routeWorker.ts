import { eraserRouter, orthogonalRouter } from '@strukt/layout';
import type { RouteRequest, RouteResponse } from './routeRunner';
import { computeRoutes } from './routing';

// Worker entry: routing is pure geometry, so it runs off the main thread.
self.onmessage = ({ data: { id, model, rects, orthogonal } }: MessageEvent<RouteRequest>) => {
  const edges = computeRoutes(model, rects, orthogonal ? orthogonalRouter : eraserRouter);
  self.postMessage({ id, edges } satisfies RouteResponse);
};
