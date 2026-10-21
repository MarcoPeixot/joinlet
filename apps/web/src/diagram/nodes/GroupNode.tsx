import { uiText } from '../../i18n';
import type { NodeProps } from '@xyflow/react';
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
  return (
    <div
      className="strukt-group"
      data-canvas-frame={el.kind === 'group' && el.canvasFrame || undefined}
      data-selected={selected || undefined}
      style={{
        width,
        height,
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
      <DocBadge link={el.link} evidenceCount={data.evidenceCount} />
      <NodeHandles />
    </div>
  );
});
