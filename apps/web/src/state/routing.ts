import { computeRects, groupTitleBox, visualBox } from '@strukt/core';
import type { DiagramModel, ID, LayoutState, Rect } from '@strukt/core';
import { edgeLabelSize, placeLabels, routeKey, sequenceMessages } from '@strukt/layout';
import type { EdgeRouter } from '@strukt/layout';
import type { DiagramStore } from './diagramStore';
import type { RouteRunner } from './routeRunner';

/** Every routable edge has a cached route computed for its current endpoint rects. */
export function routesFresh(model: DiagramModel, layout: LayoutState, rects: Readonly<Record<ID, Rect>>): boolean {
  return model.edges.every((edge) => {
    const a = rects[edge.from];
    const b = rects[edge.to];
    return !a || !b || layout.edges[edge.id]?.key === routeKey(a, b);
  });
}

/**
 * Routes every edge and places the labels on the routes (clear of each other, of the nodes with their
 * names and of group borders), the same way for the canvas and the export.
 */
export function computeRoutes(model: DiagramModel, rects: Readonly<Record<ID, Rect>>, router: EdgeRouter): LayoutState['edges'] {
  const sequence = sequenceMessages(model, rects);
  const points = router.route(model, rects);
  const edges: LayoutState['edges'] = {};
  for (const edge of model.edges) {
    const a = rects[edge.from];
    const b = rects[edge.to];
    const route = points[edge.id];
    if (a && b && route) edges[edge.id] = { points: sequence[edge.id]?.points ?? route, key: routeKey(a, b), ...(sequence[edge.id] ? { label: sequence[edge.id]!.label } : {}) };
  }
  const requests = model.edges.flatMap((edge) => {
    const route = edges[edge.id];
    return edge.label && route && !sequence[edge.id] ? [{ id: edge.id, points: route.points, ...edgeLabelSize(edge.label) }] : [];
  });
  if (!requests.length) return edges;
  const boxes: Rect[] = [];
  const borders: Rect[] = [];
  for (const id of model.order) {
    const el = model.elements[id];
    const r = rects[id];
    if (!el || !r) continue;
    if (el.kind === 'group') { borders.push(r); boxes.push(groupTitleBox(el, r)); }
    else boxes.push(visualBox(el, r));
  }
  for (const [id, label] of Object.entries(placeLabels(requests, { boxes, borders, routes: points }))) edges[id] = { ...edges[id]!, label };
  return edges;
}

/** Identifies the whole geometry: routes avoid every rect, so moving any element can change any route. */
export function geometryKey(model: DiagramModel, rects: Readonly<Record<ID, Rect>>): string {
  return JSON.stringify([
    model.style.direction,
    model.order.map(id=>{const el=model.elements[id];return [id,rects[id],el?.kind,el?.parentId,el?.presentation,el?.layoutRole,el?.kind==='node'?el.shape:undefined,el?.label,el?.icon,el?.tech];}),
    model.edges.map(edge=>[edge.id,edge.from,edge.to,edge.connector,edge.fromPort,edge.toPort,edge.label]),
  ]);
}

/** Runs `task` later and returns a function that cancels it (a timer in the app, a manual queue in tests). */
export type Schedule = (task: () => void) => () => void;

/**
 * A full reroute takes ~100 ms on a mid-size diagram and arrow-key nudges commit per keypress (spec §11):
 * route once the commits pause. Until then `cachedRoute` draws the moved edges as orthogonal lines.
 */
const ROUTE_DELAY_MS = 100;
export const afterPause: Schedule = (task) => {
  const timer = setTimeout(task, ROUTE_DELAY_MS);
  return () => clearTimeout(timer);
};

/**
 * Routes all edges after commits (apply, end of drag, undo/redo, load) and caches them in `layout.edges`;
 * a burst of commits is routed once, for the latest geometry. Mid-drag nothing is routed: the canvas falls
 * back to orthogonal lines for moved edges.
 */
export function startRouting(store: DiagramStore, run: RouteRunner, schedule: Schedule = afterPause): () => void {
  /** `geometryKey` of the rects the cached routes were computed for. */
  let routedFor = '';
  let cancel: (() => void) | null = null;
  /** Counts refreshes: a result is applied only if no newer refresh (or stop) happened while it was computed. */
  let latest = 0;
  /** A failing runner would log on every commit: once per routing session is enough. */
  let reported = false;
  const refresh = async () => {
    cancel = null;
    const { model, layout, pending } = store.getState();
    if (pending || !model.edges.length) return;
    const rects = computeRects(model, layout);
    const geometry = geometryKey(model, rects);
    if (geometry === routedFor && routesFresh(model, layout, rects)) return;
    const ticket = ++latest;
    const edges = await run(model, rects);
    const now = store.getState();
    // Routes for a geometry that changed meanwhile are stale; that change already asked for another refresh.
    if (ticket !== latest || now.model !== model || now.layout !== layout) return;
    routedFor = geometry;
    now.setRoutes(edges);
  };
  const request = () => {
    cancel?.();
    cancel = schedule(() => {
      // A failed reroute leaves the cache as it was (the canvas keeps its orthogonal fallback) and the next commit tries again.
      refresh().catch((err: unknown) => {
        if (reported) return;
        reported = true;
        console.error('Joinlet: could not route the connections', err);
      });
    });
  };
  request();
  const unsubscribe = store.subscribe((state, prev) => {
    if (state.model !== prev.model || state.layout !== prev.layout || state.pending !== prev.pending) request();
  });
  return () => {
    latest++;
    cancel?.();
    unsubscribe();
  };
}
