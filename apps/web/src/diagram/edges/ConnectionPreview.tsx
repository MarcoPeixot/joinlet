import { computeRects, connectorStyle, own } from '@strukt/core';
import type { DiagramModel, ID, Rect } from '@strukt/core';
import { arrowHead, roundedPath, trimEnd } from '@strukt/layout';
import type { ConnectionLineComponentProps } from '@xyflow/react';
import { useMemo } from 'react';
import { useCanvasStore } from '../../canvas/scope';
import { useUi } from '../../ui/uiStore';
import { edgeColor } from '../palette';
import type { ElementNode } from '../toFlow';
import { previewRoute } from './preview';

const ARROW = 10;

/** The smallest element (a node before the group around it) under a point, other than `except`. */
function elementAt(model: DiagramModel, rects: Readonly<Record<ID, Rect>>, x: number, y: number, except: ID): ID | undefined {
  let best: { id: ID; area: number } | undefined;
  for (const id of model.order) {
    const r = own(rects, id);
    if (id === except || !r || x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue;
    if (!best || r.w * r.h < best.area) best = { id, area: r.w * r.h };
  }
  return best?.id;
}
/** New connections are `connect` ops without a connector: the default one. */
const STYLE = connectorStyle('>');

/** The connection being dragged, in the same route, color, width and arrow as the edge it creates on release. */
export function ConnectionPreview({ fromNode, toNode, toX, toY }: ConnectionLineComponentProps<ElementNode>) {
  const model = useCanvasStore((s) => s.model);
  const layout = useCanvasStore((s) => s.layout);
  const theme = useUi((s) => s.theme);
  // Positions only change on commit, never mid-drag: the rects are computed once per drag.
  const rects = useMemo(() => computeRects(model, layout), [model, layout]);
  const from = own(rects, fromNode.id);
  if (!from) return null;
  // Near a port React Flow names the target; anywhere over an element the drop connects too (DiagramCanvas
  // onConnectEnd): the innermost element under the pointer, so the preview is the line the drop makes.
  const under = toNode ? undefined : elementAt(model, rects, toX, toY, fromNode.id);
  const targetId = toNode && toNode.id !== fromNode.id ? toNode.id : under;
  const target = targetId ? own(rects, targetId) : undefined;
  const points = previewRoute(from, target ?? [toX, toY]);
  const last = points.length - 1;
  if (last < 1) return null;
  const color = edgeColor(undefined, theme);
  return (
    <g className="strukt-connection-preview">
      <path d={roundedPath(STYLE.endArrow ? trimEnd(points, ARROW - 1) : points)} fill="none" style={{ stroke: color, strokeWidth: 1.5 }} />
      {STYLE.endArrow && last > 0 && <path d={arrowHead(points[last]!, points[last - 1]!, ARROW)} fill={color} />}
    </g>
  );
}
