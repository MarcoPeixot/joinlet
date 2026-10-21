import type { DiagramModel, EdgeEl, EdgeRoute, ID, Rect } from '@strukt/core';
import { nodeVariant } from '@strukt/core';
import { pointAtHalf } from './path';
import { routeOrthogonal } from './route';
import type { Point } from './route';
import { sequenceMessages } from './sequence';

export interface RouteOptions {
  /** Run the router's repair pass (slower, nicer). Default true. */
  repair?: boolean;
}

/** The routing seam: positioned rects in, one absolute polyline per edge whose endpoints have rects. */
export interface EdgeRouter {
  route(model: DiagramModel, rects: Readonly<Record<ID, Rect>>, options?: RouteOptions): Record<ID, Point[]>;
}

/** Identifies the endpoint geometry a cached route was computed for. */
export function routeKey(from: Rect, to: Rect): string {
  return `${from.x},${from.y},${from.w},${from.h}|${to.x},${to.y},${to.w},${to.h}`;
}

/** M1 behavior behind the seam: obstacle-unaware elbows. Also the live fallback while dragging. */
export const orthogonalRouter: EdgeRouter = {
  route(model, rects) {
    const out: Record<ID, Point[]> = {};
    for (const edge of model.edges) {
      const a = rects[edge.from];
      const b = rects[edge.to];
      if (a && b) out[edge.id] = routeOrthogonal(a, b).points;
    }
    for (const [id, message] of Object.entries(sequenceMessages(model, rects))) out[id] = message.points;
    return out;
  },
};

/** What canvas and export draw: the cached route while both endpoints stay put, else a quick orthogonal line. */
export function cachedRoute(cache: Readonly<Record<ID, EdgeRoute>>, edge: EdgeEl, from: Rect, to: Rect, model?: DiagramModel): Point[] {
  const cached = cache[edge.id];
  const points = cached && cached.key === routeKey(from, to) ? cached.points : routeOrthogonal(from, to).points;
  if (!model || points.length < 2) return points;
  // A router attaches to bounding boxes. Extend the first/last segment to the actual curved outline.
  const attach = (id: ID, rect: Rect, at: Point, toward: Point): Point => {
    const el = model.elements[id];
    if (!el || el.kind !== 'node' || nodeVariant(el) !== 'shape' || !['circle','ellipse'].includes(el.shape ?? '')) return at;
    const cx=rect.x+rect.w/2, cy=rect.y+rect.h/2;
    const rx=el.shape==='circle'?Math.min(rect.w,rect.h)/2:rect.w/2;
    const ry=el.shape==='circle'?rx:rect.h/2;
    if(rx<=0 || ry<=0) return at;
    if(Math.abs(at[1]-toward[1])<0.001 && Math.abs(at[1]-cy)<=ry) {
      const dx=rx*Math.sqrt(Math.max(0,1-((at[1]-cy)/ry)**2));
      return [cx+(at[0]>=cx?dx:-dx),at[1]];
    }
    if(Math.abs(at[0]-toward[0])<0.001 && Math.abs(at[0]-cx)<=rx) {
      const dy=ry*Math.sqrt(Math.max(0,1-((at[0]-cx)/rx)**2));
      return [at[0],cy+(at[1]>=cy?dy:-dy)];
    }
    return at;
  };
  const start=attach(edge.from,from,points[0]!,points[1]!);
  const end=attach(edge.to,to,points[points.length-1]!,points[points.length-2]!);
  return start===points[0] && end===points[points.length-1] ? points : [start,...points.slice(1,-1),end];
}

/** Where to draw an edge's label: its placed position while the cached route holds, else halfway along `points`. */
export function cachedLabel(cache: Readonly<Record<ID, EdgeRoute>>, edge: EdgeEl, from: Rect, to: Rect, points: readonly Point[]): Point {
  const cached = cache[edge.id];
  return cached?.label && cached.key === routeKey(from, to) ? cached.label : pointAtHalf(points);
}
