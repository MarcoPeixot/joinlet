import { cardinalityGlyph, connectorStyle } from '@strukt/core';
import { arrowHead, pointAtHalf, roundedPath, trimEnd, trimStart } from '@strukt/layout';
import { BaseEdge, EdgeLabelRenderer } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import { memo } from 'react';
import { CANVAS, FONT_STACK } from '../../ui/theme';
import { useUi } from '../../ui/uiStore';
import { edgeColor, edgeLabelColor } from '../palette';
import type { StruktEdge } from '../toFlow';
import { FlowPulses } from './FlowPulses';
import { pulseDirections, pulseTracks } from './flowPulse';

const ARROW = 10;
const DIFF_COLOR = { added: 'var(--sk-diff-added)', removed: 'var(--sk-diff-removed)', changed: 'var(--sk-diff-changed)' } as const;
const DIFF_TEXT = { added: 'var(--sk-diff-added-text)', removed: 'var(--sk-diff-removed-text)', changed: 'var(--sk-diff-changed-text)' } as const;
/** Requests leaving the focused element in Iris, arriving at it in cyan: the two ends of the brand gradient. */
const FOCUS_COLOR = { out: 'var(--sk-flow-out)', in: 'var(--sk-flow-in)' } as const;

export const StruktEdgeView = memo(function StruktEdgeView({ id, data, selected }: EdgeProps<StruktEdge>) {
  const flowing = useUi((s) => s.flowAnimation);
  if (!data) return null;
  const { edge, points, labelAt, sequenceOrder, theme, typeface, diff, focus, dimmed, draw } = data;
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
      <BaseEdge
        id={id}
        path={roundedPath(line)}
        interactionWidth={18}
        // Normalised length, so the CSS draw-in (sk-edge-draw) needs no measuring; only while it runs.
        pathLength={draw ? 1 : undefined}
        style={{ stroke: color, strokeWidth: strong ? 2.25 : 1.5, strokeDasharray: style.dashed || diff === 'removed' ? '6 5' : undefined, fill: 'none' }}
      />
      {endArrow && last > 0 && <path d={arrowHead(points[last], points[last - 1], ARROW)} fill={color} />}
      {startArrow && last > 0 && <path d={arrowHead(points[0], points[1], ARROW)} fill={color} />}
      {last > 0 && (['fromCardinality', 'toCardinality'] as const).map(key => {
        const cardinality = edge[key];
        if (!cardinality) return null;
        const glyph = cardinalityGlyph(cardinality, points[key === 'fromCardinality' ? 0 : last]!, points[key === 'fromCardinality' ? 1 : last - 1]!);
        return <g key={key} aria-label={cardinality}><path d={glyph.path} fill="none" stroke={color} strokeWidth={1.5}/>{glyph.circle && <circle cx={glyph.circle[0]} cy={glyph.circle[1]} r={4.5} fill={CANVAS[theme].bg} stroke={color} strokeWidth={1.5}/>}</g>;
      })}
      {/* Diff previews (AI draft, version compare) stay still. */}
      {/* The focused element's edges pulse even with "Animar fluxo" off. */}
      {(flowing || focus) && !diff && <FlowPulses tracks={pulseTracks(points, pulseDirections(style))} color={focus ? FOCUS_COLOR[focus] : color} />}
      {(edge.label || sequenceOrder) && (
        <EdgeLabelRenderer>
          <div
            className="strukt-edge-label nodrag nopan"
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
    </>
  );
});
