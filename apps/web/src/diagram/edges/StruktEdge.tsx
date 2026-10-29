import { cardinalityGlyph, connectorStyle } from '@strukt/core';
import { arrowHead, pointAtHalf, roundedPath, trimEnd, trimStart } from '@strukt/layout';
import type { Point } from '@strukt/layout';
import { BaseEdge, EdgeLabelRenderer, useInternalNode, useReactFlow } from '@xyflow/react';
import type { InternalNode } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import { memo, useEffect, useRef, useState } from 'react';
import { CANVAS, FONT_STACK } from '../../ui/theme';
import { useUi } from '../../ui/uiStore';
import { edgeColor, edgeLabelColor } from '../palette';
import type { StruktEdge } from '../toFlow';
import { FlowPulses } from './FlowPulses';
import { pulseDirections, pulseTracks } from './flowPulse';
import { ROUTE_TWEEN_MS, easeOut, lerpPoint, lerpRoute, matchRoutes } from './tween';
import { useCanvasScope } from '../../canvas/scope';
import { bendFromPointer, connectionRoute } from '../../board/connectionPath';
import { LinkLabelInput } from '../../board/LinkLabelInput';
import { uiText } from '../../i18n';

const ARROW = 10;
const DIFF_COLOR = { added: 'var(--sk-diff-added)', removed: 'var(--sk-diff-removed)', changed: 'var(--sk-diff-changed)' } as const;
const DIFF_TEXT = { added: 'var(--sk-diff-added-text)', removed: 'var(--sk-diff-removed-text)', changed: 'var(--sk-diff-changed-text)' } as const;
/** Requests leaving the focused element in Iris, arriving at it in cyan: the two ends of the brand gradient. */
const FOCUS_COLOR = { out: 'var(--sk-flow-out)', in: 'var(--sk-flow-in)' } as const;

const sameRoute = (a: readonly Point[], b: readonly Point[]) =>
  a === b || (a.length === b.length && a.every((p, i) => p[0] === b[i]![0] && p[1] === b[i]![1]));

type Glide = { from: Point[]; to: Point[]; fromLabel?: Point; start: number };

/**
 * What to draw this frame. When the router replaces a route whose ends did not move (another connection was added
 * or removed, a drag ended), the line glides from the one on screen to the new one; a moved end (dragging) snaps.
 * Only the gliding edges re-render, once per frame, for ROUTE_TWEEN_MS.
 */
function useGlide(points: Point[], labelAt: Point | undefined, ends: string | undefined, still: boolean): { points: Point[]; labelAt?: Point } {
  const [, repaint] = useState(0);
  const glide = useRef<Glide | null>(null);
  const last = useRef({ points, ends, drawn: points, drawnLabel: labelAt });
  if (!sameRoute(last.current.points, points)) {
    const glides = !still && ends !== undefined && last.current.ends === ends && last.current.drawn.length > 1 && points.length > 1;
    if (glides) {
      const [from, to] = matchRoutes(last.current.drawn, points);
      glide.current = { from, to, fromLabel: last.current.drawnLabel, start: performance.now() };
    } else glide.current = null;
    last.current = { ...last.current, points, ends };
  }
  const running = glide.current;
  const t = running ? Math.min(1, (performance.now() - running.start) / ROUTE_TWEEN_MS) : 1;
  const k = easeOut(t);
  const drawn = running && t < 1 ? lerpRoute(running.from, running.to, k) : points;
  const drawnLabel = running && t < 1 && labelAt && running.fromLabel ? lerpPoint(running.fromLabel, labelAt, k) : labelAt;
  last.current.drawn = drawn;
  last.current.drawnLabel = drawnLabel;
  useEffect(() => {
    if (!running) return;
    let frame = requestAnimationFrame(function tick() {
      if (glide.current !== running) return;
      if (performance.now() - running.start >= ROUTE_TWEEN_MS) glide.current = null;
      repaint((n) => n + 1);
      if (glide.current) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [running]);
  return { points: drawn, labelAt: drawnLabel };
}

const boxOf = (node: InternalNode | undefined) =>
  node ? { x: node.internals.positionAbsolute.x, y: node.internals.positionAbsolute.y, w: node.measured.width ?? node.width ?? 0, h: node.measured.height ?? node.height ?? 0 } : undefined;

export const StruktEdgeView = memo(function StruktEdgeView({ id, source, target, data, selected }: EdgeProps<StruktEdge>) {
  const flowing = useUi((s) => s.flowAnimation);
  const reduceMotion = useUi((s) => s.reduceMotion);
  const { store, overview } = useCanvasScope();
  const { screenToFlowPosition } = useReactFlow();
  const fromNode = useInternalNode(source);
  const toNode = useInternalNode(target);
  /** Overview: the label being typed, and the manual elbow while its grip is dragged (saved on release). */
  const [editing, setEditing] = useState(false);
  const [dragBend, setDragBend] = useState<number | null>(null);
  const still = reduceMotion || dragBend !== null || !!data?.diff || !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const shown = useGlide(data?.points ?? [], data?.labelAt, data?.ends, still);
  if (!data) return null;
  const { edge, sequenceOrder, theme, typeface, diff, focus, dimmed, draw } = data;
  let { points, labelAt } = shown;
  const a = boxOf(fromNode);
  const b = boxOf(toNode);
  // The Overview's grip moves the middle run of a connection that has one; double click returns it to routing.
  const bendable = !!overview && !!a && !!b && connectionRoute(a, b).points.length > 2;
  if (dragBend !== null && a && b) {
    const elbow = connectionRoute(a, b, dragBend);
    points = elbow.points;
    labelAt = elbow.handle;
  }
  const showGrip = selected && bendable && !editing;
  const bendAt = (event: { clientX: number; clientY: number }) => bendFromPointer(a!, b!, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  const startEditing = overview ? () => setEditing(true) : undefined;
  const saveLabel = (value: string | null) => {
    setEditing(false);
    if (value === null || value.trim() === (edge.label ?? '')) return;
    store.getState().apply([{ op: 'update_edge', edgeId: edge.id, set: { label: value.trim() || null } }]);
  };
  const style = connectorStyle(edge.connector);
  const startArrow = style.startArrow && !edge.fromCardinality, endArrow = style.endArrow && !edge.toCardinality;
  const color = diff ? DIFF_COLOR[diff] : selected ? 'var(--sk-accent)' : edgeColor(edge.color, theme);
  // The label is text: it has its own AA colors, apart from the line's.
  const labelColor = diff ? DIFF_TEXT[diff] : selected ? 'var(--sk-accent)' : edgeLabelColor(edge.color, theme);
  const strong = selected || !!focus || diff === 'added' || diff === 'changed';
  let line = points;
  if (endArrow) line = trimEnd(line, ARROW - 1);
  if (startArrow) line = trimStart(line, ARROW - 1);
  const last = points.length - 1;
  const [mx, my] = labelAt ?? pointAtHalf(points);
  return (
    <>
      <g onDoubleClick={startEditing}>
      <BaseEdge
        id={id}
        path={roundedPath(line)}
        interactionWidth={18}
        // Normalised length, so the CSS draw-in (sk-edge-draw) needs no measuring; only while it runs.
        pathLength={draw ? 1 : undefined}
        style={{ stroke: color, strokeWidth: strong ? 2.25 : 1.5, strokeDasharray: style.dashed || diff === 'removed' ? '6 5' : undefined, fill: 'none' }}
      />
      </g>
      {endArrow && last > 0 && <path d={arrowHead(points[last], points[last - 1], ARROW)} fill={color} />}
      {startArrow && last > 0 && <path d={arrowHead(points[0], points[1], ARROW)} fill={color} />}
      {last > 0 && (['fromCardinality', 'toCardinality'] as const).map(key => {
        const cardinality = edge[key];
        if (!cardinality) return null;
        const glyph = cardinalityGlyph(cardinality, points[key === 'fromCardinality' ? 0 : last]!, points[key === 'fromCardinality' ? 1 : last - 1]!);
        return <g key={key} aria-label={cardinality}><path d={glyph.path} fill="none" stroke={color} strokeWidth={1.5}/>{glyph.circle && <circle cx={glyph.circle[0]} cy={glyph.circle[1]} r={4.5} fill={CANVAS[theme].bg} stroke={color} strokeWidth={1.5}/>}</g>;
      })}
      {/* Diff previews (AI draft, version compare) stay still. */}
      {/* The focused element's edges pulse even with "Animar fluxo" off, along the drawn line: they stop where an arrowhead begins. */}
      {(flowing || focus) && !diff && <FlowPulses tracks={pulseTracks(line, pulseDirections(style))} color={focus ? FOCUS_COLOR[focus] : color} width={strong ? 2.25 : 1.5} />}
      {editing && (
        <EdgeLabelRenderer>
          <div className="nodrag nopan" style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${mx}px, ${my}px)`, pointerEvents: 'all' }}>
            <LinkLabelInput initial={edge.label ?? ''} onDone={saveLabel} />
          </div>
        </EdgeLabelRenderer>
      )}
      {!editing && (edge.label || sequenceOrder) && (
        <EdgeLabelRenderer>
          <div
            className="strukt-edge-label nodrag nopan"
            onDoubleClick={startEditing}
            style={{
              transform: `translate(-50%, -50%) translate(${mx}px, ${my}px)`,
              color: labelColor,
              background: CANVAS[theme].bg,
              fontFamily: FONT_STACK[typeface],
              opacity: dimmed ? 0.3 : 1,
            }}
          >
            {sequenceOrder ? `${sequenceOrder}. ${edge.label ?? ''}` : edge.label}
          </div>
        </EdgeLabelRenderer>
      )}
      {showGrip && (
        <EdgeLabelRenderer>
          <div
            className="strukt-link__grip nodrag nopan"
            title={uiText("Arraste para mover o trecho · duplo clique volta ao traçado automático")}
            style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${mx}px, ${my + (edge.label ? 16 : 0)}px)`, pointerEvents: 'all' }}
            onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setDragBend(bendAt(event)); }}
            onPointerUp={() => { if (dragBend !== null) overview!.setBend(edge.id, dragBend); setDragBend(null); }}
            onPointerCancel={() => setDragBend(null)}
            onDoubleClick={(event) => { event.stopPropagation(); overview!.setBend(edge.id, null); }}
          />
        </EdgeLabelRenderer>
      )}
    </>
  );
});
