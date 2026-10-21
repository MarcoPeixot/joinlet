import { LayoutManager, routeCorridorConnectionBatch } from '@eraserlabs/layout';
import type { LayoutEntity, NewConnection } from '@eraserlabs/layout';
import { connectorStyle, groupTitleBox, nodeVariant, participantSize, visualBox } from '@strukt/core';
import type { DiagramElement, ID, Rect } from '@strukt/core';
import { nudgeParallels } from './nudge';
import { routeOrthogonal } from './route';
import { compositionRoutes } from './compositionRoutes';
import { groupCompositionRoutes } from './groupRoutes';
import { sequenceMessages } from './sequence';
import type { Point } from './route';
import type { EdgeRouter, RouteOptions } from './router';

type RouteBatch = typeof routeCorridorConnectionBatch;

/**
 * What the router sees of an element. An icon node draws its name under the icon, so its obstacle is
 * icon + label (`visualBox`): the box spans the label's width and the label is external text below it,
 * which also makes a connection arriving from below end under the label. The outline is the icon
 * itself, so side connections still attach to the icon and not to the edge of the wider box.
 */
function entityOf(id: ID, el: DiagramElement, r: Rect): LayoutEntity {
  const base = { id, containerId: el.parentId ?? null, isContainer: el.kind === 'group' };
  if (el.kind === 'group') {
    const title = groupTitleBox(el, r);
    return { ...base, x: r.x, y: r.y, width: r.w, height: r.h, textPlacement: { relativeX: title.x - r.x, relativeY: title.y - r.y, width: title.w, height: title.h } };
  }
  if (el.presentation === 'participant') return { ...base, x: r.x, y: r.y, width: r.w, height: participantSize(el, r.w).h };
  if (el.kind !== 'node' || nodeVariant(el) !== 'icon') return { ...base, x: r.x, y: r.y, width: r.w, height: r.h };
  const box = visualBox(el, r);
  const left = ((r.x - box.x) / box.w) * 100;
  const right = ((r.x + r.w - box.x) / box.w) * 100;
  return {
    ...base,
    x: box.x,
    y: r.y,
    width: box.w,
    height: r.h,
    outline: { kind: 'polygon', vertices: [[left, 0], [right, 0], [right, 100], [left, 100]] },
    textPlacement: { relativeX: 0, relativeY: r.h, width: box.w, height: box.h - r.h },
  };
}

/** What the corridor router takes for each box (an element of the diagram, a card of the Quadro). */
export type CorridorEntity = LayoutEntity;
export type CorridorConnection = NewConnection;

/**
 * Routes `connections` around `entities` with the @eraserlabs/layout corridor router and returns the
 * absolute points of the ones it could route; the rest (and everything, if it crashes) is left out for
 * the caller's own fallback.
 */
export function routeCorridors(
  entities: readonly CorridorEntity[],
  connections: readonly CorridorConnection[],
  options: RouteOptions = {},
  batch: RouteBatch = routeCorridorConnectionBatch,
): Record<ID, Point[]> {
  const out: Record<ID, Point[]> = {};
  if (!connections.length) return out;
  try {
    const manager = new LayoutManager({ entities: [...entities], connections: [] });
    for (const result of batch({ layoutManager: manager, connectionsToRoute: connections, options: { repair: options.repair ?? true } }) ?? []) {
      const routed = result.status === 'valid' ? manager.getConnectionById(result.connectionId) : undefined;
      if (routed && routed.points.length >= 2) out[result.connectionId] = routed.points.map(([x, y]): Point => [routed.x + x, routed.y + y]);
    }
  } catch (err) {
    console.warn('Falha ao rotear com @eraserlabs/layout; usando roteamento ortogonal.', err);
    return {};
  }
  return out;
}

/**
 * @eraserlabs/layout corridor router; any edge it cannot route (or a crash) falls back to `routeOrthogonal`.
 * Parallel runs closer than `PARALLEL_GAP` are then spread apart (the router's own track gap is 8 px).
 */
export function createEraserRouter(batch: RouteBatch = routeCorridorConnectionBatch): EdgeRouter {
  return {
    route(model, rects, options = {}) {
      const sequence = sequenceMessages(model, rects);
      const sequenceRoutes = Object.fromEntries(Object.entries(sequence).map(([id, message]) => [id, message.points]));
      const edges = model.edges.filter((edge) => rects[edge.from] && rects[edge.to] && !sequence[edge.id]);
      if (!edges.length) return sequenceRoutes;
      const entities = model.order.flatMap((id) => {
        const el = model.elements[id];
        const r = rects[id];
        return el && r ? [entityOf(id, el, r)] : [];
      });
      const occupied = new Set(model.order);
      for (const id of model.order) {
        const el = model.elements[id], r = rects[id];
        if (el?.kind !== 'group' || !r) continue;
        const title = groupTitleBox(el, r);
        if (!title.w) continue;
        let titleId = `__title_${id}`;
        while (occupied.has(titleId)) titleId += '_';
        occupied.add(titleId);
        entities.push({ id: titleId, containerId: id, isContainer: false, x: title.x, y: title.y, width: title.w, height: title.h });
      }
      const connections = edges.map((edge): CorridorConnection => {
        const style = connectorStyle(edge.connector);
        const face = (port: typeof edge.fromPort) => port==='top'?'up':port==='bottom'?'down':port;
        return { id: edge.id, from: edge.from, to: edge.to, fromArrowhead: style.startArrow, toArrowhead: style.endArrow,
          ...(edge.fromPort?{authoredFromFace:face(edge.fromPort)}:{}),...(edge.toPort?{authoredToFace:face(edge.toPort)}:{}) };
      });
      const routed = routeCorridors(entities, connections, options, batch);
      const out: Record<ID, Point[]> = {};
      for (const edge of edges) out[edge.id] = routed[edge.id] ?? routeOrthogonal(rects[edge.from]!, rects[edge.to]!).points;
      const nodes = model.order.flatMap((id) => {
        const el = model.elements[id];
        return el && rects[id] ? [el.kind === 'group' ? groupTitleBox(el, rects[id]) : visualBox(el, rects[id])] : [];
      });
      const base = { ...nudgeParallels(out, nodes), ...compositionRoutes(model, rects) };
      return { ...base, ...groupCompositionRoutes(model, rects, base), ...sequenceRoutes };
    },
  };
}

export const eraserRouter: EdgeRouter = createEraserRouter();
