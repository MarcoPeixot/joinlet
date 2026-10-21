import { computeRects, visualBox } from '@strukt/core';
import type { Rect } from '@strukt/core';
import { BORDER_BAND, edgeLabelSize, eraserRouter } from '@strukt/layout';
import type { Point } from '@strukt/layout';
import { describe, expect, it } from 'vitest';
import { computeRoutes } from '../state/routing';
import { exampleSnapshot } from './example';

/** True when an axis-aligned segment enters the rect's interior. */
function crosses([ax, ay]: Point, [bx, by]: Point, r: Rect): boolean {
  return Math.min(ax, bx) < r.x + r.w && Math.max(ax, bx) > r.x && Math.min(ay, by) < r.y + r.h && Math.max(ay, by) > r.y;
}

const { model, layout } = exampleSnapshot();
const rects = computeRects(model, layout);
const routes = computeRoutes(model, rects, eraserRouter);
const nodeIds = model.order.filter((id) => model.elements[id]?.kind === 'node');
const box = (id: string) => visualBox(model.elements[id]!, rects[id]!);

describe('the example diagram, routed', () => {
  it('no route runs through the icon or the name of a node that is not one of its ends', () => {
    const hits = model.edges.flatMap((edge) => {
      const points = routes[edge.id]!.points;
      return nodeIds
        .filter((id) => id !== edge.from && id !== edge.to)
        .filter((id) => points.slice(1).some((p, i) => crosses(points[i]!, p, box(id))))
        .map((id) => `${edge.id} × ${id}`);
    });
    expect(hits).toEqual([]);
  });

  it('parallel runs of different connections stay at least 12 px apart', () => {
    const runs = model.edges.flatMap((edge) => {
      const points = routes[edge.id]!.points;
      // Interior segments only: the first and last ones fan out of the node faces.
      return points.slice(1, -2).map((a, i) => ({ edge: edge.id, a, b: points[i + 2]! }));
    });
    const close = runs.flatMap((r, i) =>
      runs.slice(i + 1).flatMap((s) => {
        const vertical = r.a[0] === r.b[0] && s.a[0] === s.b[0];
        const horizontal = r.a[1] === r.b[1] && s.a[1] === s.b[1];
        if (r.edge === s.edge || (!vertical && !horizontal)) return [];
        const [across, along] = vertical ? [0, 1] : [1, 0];
        const overlap = Math.min(Math.max(r.a[along], r.b[along]), Math.max(s.a[along], s.b[along])) - Math.max(Math.min(r.a[along], r.b[along]), Math.min(s.a[along], s.b[along]));
        return overlap > 0 && Math.abs(r.a[across] - s.a[across]) < 12 ? [`${r.edge} ∥ ${s.edge}`] : [];
      }),
    );
    expect(close).toEqual([]);
  });

  it('a connection arriving from below ends under the name (Kafka → Pagamentos)', () => {
    const end = routes['Kafka→Pagamentos']!.points.at(-1)!;
    const name = box('Pagamentos');
    expect(end[1]).toBe(name.y + name.h);
  });
});

describe('the example diagram, edge labels', () => {
  const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const labelled = model.edges.filter((edge) => edge.label);
  const boxes = labelled.map((edge) => {
    const at = routes[edge.id]!.label;
    const { w, h } = edgeLabelSize(edge.label!);
    return { edge: edge.id, box: at ? { x: at[0] - w / 2, y: at[1] - h / 2, w, h } : null };
  });

  it('every labelled edge gets a position on its route', () => {
    expect(boxes.filter((b) => !b.box).map((b) => b.edge)).toEqual([]);
  });

  it('labels overlap neither each other, the nodes (with their names) nor a group border', () => {
    const groups = model.order.filter((id) => model.elements[id]?.kind === 'group');
    const band = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
    const hits = boxes.flatMap(({ edge, box }, i) => [
      ...boxes.slice(i + 1).filter((other) => overlaps(box!, other.box!)).map((other) => `${edge} × ${other.edge}`),
      ...nodeIds.filter((id) => overlaps(box!, visualBox(model.elements[id]!, rects[id]!))).map((id) => `${edge} × ${id}`),
      ...groups
        .filter((id) => overlaps(box!, band(rects[id]!, BORDER_BAND)) && !contains(band(rects[id]!, -BORDER_BAND), box!))
        .map((id) => `${edge} × borda ${id}`),
    ]);
    expect(hits).toEqual([]);
  });
});

function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}
