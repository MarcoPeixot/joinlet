import { uiText } from '../i18n';
import { arrowHead, roundedPath, trimEnd } from '@strukt/layout';
import type { Point } from '@strukt/layout';
import { own } from '@strukt/core';
import { updateConnection } from '@strukt/workspace';
import { BaseEdge, EdgeLabelRenderer, useInternalNode, useReactFlow } from '@xyflow/react';
import type { EdgeProps, InternalNode } from '@xyflow/react';
import { memo, useState } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
import { useStore } from 'zustand';
import { FlowPulses } from '../diagram/edges/FlowPulses';
import { pulseTracks } from '../diagram/edges/flowPulse';
import { CANVAS } from '../ui/theme';
import { useUi } from '../ui/uiStore';
import { workspace } from '../workspace/appWorkspace';
import type { BoardEdge } from './boardFlow';
import { boardRoutesStore, connectionView } from './boardRoutes';
import { bendFromPointer } from './connectionPath';
import { LinkLabelInput } from './LinkLabelInput';

const ARROW = 10;
/** Centers an HTML overlay (label, grip, dot) on a flow point. */
const at = ([x, y]: Point) => `translate(-50%, -50%) translate(${x}px, ${y}px)`;

function boxOf(node: InternalNode) {
  return { x: node.internals.positionAbsolute.x, y: node.internals.positionAbsolute.y, w: node.measured.width ?? 0, h: node.measured.height ?? 0 };
}

const save = (id: string, patch: { label?: string | null; bend?: number | null }) =>
  workspace.updateBoard((board) => updateConnection(board, id, patch));

/**
 * A Overview connection (IcePanel-like): orthogonal line with rounded corners, routed around the cards
 * (`boardRoutes`), a dot where it leaves, a filled arrow where it arrives and the label in a pill.
 * Double click edits the label. When selected, dragging the grip turns the line into a plain elbow
 * whose middle run follows the pointer (a manual bend); double click on the grip goes back to routing.
 */
export const FloatingEdge = memo(function FloatingEdge({ id, source, target, selected, data }: EdgeProps<BoardEdge>) {
  const from = useInternalNode(source);
  const to = useInternalNode(target);
  const theme = useUi((s) => s.theme);
  const flowing = useUi((s) => s.flowAnimation);
  const routed = useStore(boardRoutesStore, (s) => own(s.routes, id));
  const { screenToFlowPosition } = useReactFlow();
  const [editing, setEditing] = useState(false);
  /** The bend while the grip is being dragged (saved on release). */
  const [dragBend, setDragBend] = useState<number | null>(null);
  if (!from || !to || !data) return null;
  const { label } = data.connection;
  const a = boxOf(from);
  const b = boxOf(to);
  const { points, labelAt, run, axis, bendable } = connectionView(data.connection, a, b, routed, dragBend);
  const last = points.length - 1;
  const color = selected ? 'var(--sk-accent)' : 'var(--sk-muted)';
  const showGrip = selected && bendable && !editing;
  const startEditing = () => setEditing(true);

  const bendAt = (event: PointerEvent) => bendFromPointer(a, b, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  const grip = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) setDragBend(bendAt(event));
    },
    onPointerUp: () => {
      if (dragBend !== null) save(id, { bend: dragBend });
      setDragBend(null);
    },
    onPointerCancel: () => setDragBend(null),
    onDoubleClick: (event: MouseEvent) => {
      event.stopPropagation();
      save(id, { bend: null });
    },
  };

  return (
    <>
      <g onDoubleClick={startEditing}>
        <BaseEdge
          id={id}
          path={roundedPath(trimEnd(points, ARROW - 1))}
          interactionWidth={20}
          style={{ stroke: color, strokeWidth: selected ? 2 : 1.5, fill: 'none' }}
        />
      </g>
      {last > 0 && <path d={arrowHead(points[last]!, points[last - 1]!, ARROW)} style={{ fill: color }} />}
      {flowing && <FlowPulses tracks={pulseTracks(points, ['forward'])} color={color} />}
      <EdgeLabelRenderer>
        {/* Keep overlays aligned with the route's detached endpoints. */}
        <div className="strukt-link__dot" style={{ transform: at(points[0]!), background: color }} />
        {(label || editing || showGrip) && (
          <div
            className="strukt-link__mid nodrag nopan"
            data-axis={axis}
            data-run={run}
            style={{ transform: at(labelAt) }}
          >
            {editing ? (
              <LinkLabelInput
                initial={label ?? ''}
                onDone={(value) => {
                  setEditing(false);
                  if (value !== null && value !== (label ?? '')) save(id, { label: value });
                }}
              />
            ) : (
              label && (
                <div
                  className={`strukt-link__label${selected ? ' strukt-link__label--selected' : ''}`}
                  style={{ background: CANVAS[theme].bg }}
                  title={label}
                  onDoubleClick={startEditing}
                >
                  {label}
                </div>
              )
            )}
            {showGrip && (
              <div className="strukt-link__grip nodrag nopan" title={uiText("Arraste para mover o trecho · duplo clique volta ao traçado automático")} {...grip} />
            )}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
});
