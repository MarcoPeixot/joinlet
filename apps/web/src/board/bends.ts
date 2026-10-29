import { own } from '@strukt/core';
import type { DiagramModel, ID, LayoutState, Rect } from '@strukt/core';
import { routeKey } from '@strukt/layout';
import { connectionRoute } from './connectionPath';

/**
 * The Overview's manual elbows on top of the router: an edge whose connection has a `bend` is drawn as the plain
 * elbow with its middle run there (the grip moves it), its label on that run; every other edge keeps its route.
 */
export function withBends(
  routes: LayoutState['edges'],
  model: DiagramModel,
  rects: Readonly<Record<ID, Rect>>,
  bendOf: (edgeId: ID) => number | undefined,
): LayoutState['edges'] {
  const out: LayoutState['edges'] = { ...routes };
  for (const edge of model.edges) {
    const bend = bendOf(edge.id);
    const a = own(rects, edge.from);
    const b = own(rects, edge.to);
    if (bend === undefined || !a || !b) continue;
    const route = connectionRoute(a, b, bend);
    if (route.points.length < 3) continue;
    out[edge.id] = { points: route.points, key: routeKey(a, b), ...(edge.label ? { label: route.handle } : {}) };
  }
  return out;
}
