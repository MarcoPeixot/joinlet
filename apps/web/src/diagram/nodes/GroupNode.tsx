import { uiText } from '../../i18n';
import { NodeResizer } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { useCanvasScope, useCanvasStore } from '../../canvas/scope';
import { memo } from 'react';
import { FONT_STACK } from '../../ui/theme';
import { EditableLabel } from '../EditableLabel';
import { IconGlyph } from '../icons/IconGlyph';
import { groupColors } from '../palette';
import type { ElementNode } from '../toFlow';
import { SHADOW_OFFSET } from '../watercolor';
import { DocBadge } from './DocBadge';
import { NodeHandles } from './NodeHandles';

export const GroupNode = memo(function GroupNode({ id, data, selected, width, height }: NodeProps<ElementNode>) {
  const el = data.el;
  const colors = groupColors(el.color, data.colorMode, data.theme);
  const watercolor = data.styleMode === 'watercolor';
  // An Overview section hugs its cards; an empty one keeps the size it is given, by hand.
  const overview = useCanvasScope().kind === 'overview';
  const empty = useCanvasStore((s) => overview && !Object.values(s.model.elements).some((el) => el.parentId === id));
  return (
    <div
      className="strukt-group"
      data-canvas-frame={el.kind === 'group' && el.canvasFrame || undefined}
      data-selected={selected || undefined}
      style={{
        // Fills React Flow's wrapper, which carries the size: when a group glides to a new size (canvas/groupGlide.ts,
        // drawn through `frozen`) its box and its position move together, so only the edges that change move.
        width: width === undefined ? undefined : '100%',
        height: height === undefined ? undefined : '100%',
        borderColor: colors.stroke,
        background: watercolor ? 'transparent' : colors.fill,
        boxShadow: data.styleMode === 'shadow' ? `0 ${SHADOW_OFFSET}px 12px 0 ${colors.shadow}` : undefined,
        fontFamily: FONT_STACK[data.typeface],
      }}
    >
      {watercolor && <div className="strukt-group__wash" style={{ background: colors.fill }} />}
      <div className="strukt-group__title" style={{ background: colors.titleSurface, color: colors.titleText }}>
        {el.icon && <IconGlyph name={el.icon} size={15} color={colors.stroke} legibleOn={data.theme} />}
        <EditableLabel id={id} text={el.label ?? el.id} />
        {el.kind === 'group' && el.canvasFrame && <span className="strukt-frame-caption">{uiText("Diagrama")}</span>}
      </div>
      {empty && <NodeResizer isVisible={selected} minWidth={240} minHeight={160} color="var(--sk-accent)" />}
      <DocBadge link={el.link} evidenceCount={data.evidenceCount} />
      <NodeHandles />
    </div>
  );
});
