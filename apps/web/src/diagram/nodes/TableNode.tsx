import { uiText } from '../../i18n';
import { cardCaption, tableSize } from '@strukt/core';
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

export const TableNode = memo(function TableNode({ id, data, selected, width = 280, height }: NodeProps<ElementNode>) {
  const el = data.el as NodeEl;
  const size = tableSize(el, width);
  const caption = cardCaption(el, width);
  const colors = cardColors(el.color, undefined, data.theme);
  return <div className="strukt-data-table" data-selected={selected || undefined} style={{ width, height: height ?? size.h, background: colors.fill, borderColor: colors.stroke, color: colors.text, fontFamily: FONT_STACK[data.typeface] }}>
    <div className="strukt-data-table__header" style={{ height: size.header, borderColor: colors.stroke }}>
      {el.icon && <IconGlyph name={el.icon} size={28} color={colors.icon} legibleOn={data.theme} />}
      <div className="strukt-data-table__heading"><EditableLabel id={id} text={el.label ?? id} displayText={caption.title.join("\n")} />
        {el.tech && <div className="strukt-data-table__technology" style={{ color: colors.muted }}>{caption.technology.join("\n")}</div>}
      </div>
    </div>
    {(el.fields ?? []).map((field, index) => <div className="strukt-data-table__row" key={index} style={{ borderColor: colors.stroke }}>
      <span className="strukt-data-table__key" data-key={field.key} title={field.key === 'PK' ? uiText("Chave primária") : field.key === 'FK' ? uiText("Chave estrangeira") : undefined}>{field.key ?? "·"}</span>
      <span className="strukt-data-table__name" title={field.name}>{field.name}</span>
      <span className="strukt-data-table__type" title={field.type} style={{ color: colors.muted }}>{field.type}</span>
    </div>)}
    {!el.fields?.length && <div className="strukt-data-table__empty" style={{ color: colors.muted }}>{uiText("Adicione campos nas propriedades")}</div>}
    <DocBadge link={el.link} evidenceCount={data.evidenceCount} /><NodeHandles />
  </div>;
});
