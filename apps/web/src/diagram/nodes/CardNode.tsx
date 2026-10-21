import { uiText } from '../../i18n';
import { cardCaption } from '@strukt/core';
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

export const CardNode = memo(function CardNode({ id, data, selected, width = 204, height = 84 }: NodeProps<ElementNode>) {
  const el = data.el as NodeEl;
  const caption = cardCaption(el, width);
  const colors = cardColors(el.color, el.layoutRole, data.theme);
  return <div className="strukt-scene-card" data-selected={selected || undefined} data-role={el.layoutRole} style={{width,height,backgroundColor:colors.fill,borderColor:colors.stroke,color:colors.text,fontFamily:FONT_STACK[data.typeface]}}>
    {el.icon && <span className="strukt-scene-card__icon"><span className="strukt-scene-card__chip" style={{color:colors.icon}}><IconGlyph name={el.icon} size={20} color={colors.icon} legibleOn={data.theme}/></span></span>}
    <div className="strukt-scene-card__copy">
      <div className="strukt-scene-card__title" style={{fontSize:caption.fontSize}}><EditableLabel id={id} text={el.label??id} displayText={caption.title.join("\n")}/></div>
      {caption.technology.length>0 && <div className="strukt-scene-card__technology" style={{color:colors.muted}}>{caption.technology.join("\n")}</div>}
    </div>
    <DocBadge link={el.link} evidenceCount={data.evidenceCount}/><NodeHandles/>
  </div>;
});
