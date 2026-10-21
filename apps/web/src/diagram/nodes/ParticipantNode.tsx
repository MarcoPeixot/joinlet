import { uiText } from '../../i18n';
import { labelLines, participantSize } from '@strukt/core';
import type { NodeEl } from '@strukt/core';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { FONT_STACK } from '../../ui/theme';
import { EditableLabel } from '../EditableLabel';
import { IconGlyph } from '../icons/IconGlyph';
import { cardColors } from '../palette';
import type { ElementNode } from '../toFlow';
import { DocBadge } from './DocBadge';
import { NodeHandles } from './NodeHandles';

export const ParticipantNode = memo(function ParticipantNode({ id, data, selected, width = 180, height = 300 }: NodeProps<ElementNode>) {
  const el = data.el as NodeEl;
  const header = participantSize(el, width).h;
  const colors = cardColors(el.color, undefined, data.theme);
  return <div className="strukt-participant" data-selected={selected || undefined} style={{ width, height, color: colors.text, fontFamily: FONT_STACK[data.typeface] }}>
    <div className="strukt-participant__lifeline" style={{ top: header, borderColor: colors.muted }} />
    <div className="strukt-participant__header" style={{ height: header, background: colors.fill, borderColor: colors.stroke }}>
      {el.icon && <IconGlyph name={el.icon} size={24} color={colors.icon} legibleOn={data.theme} />}
      <div className="strukt-participant__copy"><EditableLabel id={id} text={el.label ?? id} displayText={labelLines(el.label ?? id, width - 32 - (el.icon ? 32 : 0), 15).join("\n")} />
        {el.tech && <div className="strukt-participant__technology" title={el.tech} style={{ color: colors.muted }}>{el.tech}</div>}
      </div>
      <DocBadge link={el.link} evidenceCount={data.evidenceCount} /><NodeHandles />
    </div>
  </div>;
});
