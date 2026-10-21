import { uiText } from '../../i18n';
import type { NodeEl } from '@strukt/core';
import { ICON_LABEL, iconCaption, iconLabelSize } from '@strukt/core';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { CANVAS, FONT_STACK } from '../../ui/theme';
import { EditableLabel } from '../EditableLabel';
import { IconGlyph } from '../icons/IconGlyph';
import { captionColor, nodeColors, stickerFill } from '../palette';
import type { ElementNode } from '../toFlow';
import { DocBadge } from './DocBadge';
import { NodeHandles } from './NodeHandles';

export const IconNode = memo(function IconNode({ id, data, selected, width = 56, height = 56 }: NodeProps<ElementNode>) {
  const el = data.el as NodeEl;
  const colors = nodeColors(el.color, 'outline', data.theme);
  // The icon and its label float over the canvas background, not over `colors.fill` — so an
  // uncolored icon and its label must use the canvas ink, not "ink-on-fill" (which can be white
  // in `bold` mode and would then be invisible against the canvas). A colored icon keeps its
  // accent stroke; the label stays canvas ink either way.
  const ink = CANVAS[data.theme].ink;
  const captionSize = iconLabelSize(el);
  const caption = iconCaption(el, captionSize.w);
  return (
    <div className="strukt-icon-node" data-selected={selected || undefined} style={{ width, height, fontFamily: FONT_STACK[data.typeface], '--icon-label-gap': `${ICON_LABEL.gap}px`, '--sticker': stickerFill(el.color, data.theme) } as React.CSSProperties}>
      {el.icon && <IconGlyph name={el.icon} size={Math.min(width, height)} color={el.color ? colors.stroke : ink} legibleOn={data.theme} />}
      <div className="strukt-icon-node__label" style={{ color: ink, width: captionSize.w }}>
        <EditableLabel id={id} text={el.label ?? el.id} displayText={caption.title.join("\n")} />
        {caption.technology.length > 0 && <span className="strukt-icon-node__technology" title={el.tech} style={{ color: captionColor(data.theme) }}>{caption.technology.join("\n")}</span>}
      </div>
      <DocBadge link={el.link} evidenceCount={data.evidenceCount} />
      <NodeHandles />
    </div>
  );
});
