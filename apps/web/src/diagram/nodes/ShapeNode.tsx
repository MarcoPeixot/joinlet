import type { NodeEl } from '@strukt/core';
import { drawingShape } from '@strukt/core';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { FONT_STACK } from '../../ui/theme';
import { EditableLabel } from '../EditableLabel';
import { IconGlyph } from '../icons/IconGlyph';
import { nodeColors } from '../palette';
import { labelBox, shapeGeometry } from '../shapes';
import type { ElementNode } from '../toFlow';
import { SHADOW_FILTER_ID, SHADOW_OFFSET, WATERCOLOR_FILTER_ID } from '../watercolor';
import { DocBadge } from './DocBadge';
import { NodeHandles } from './NodeHandles';

export const ShapeNode = memo(function ShapeNode({ id, data, selected, width = 160, height = 64 }: NodeProps<ElementNode>) {
  const el = data.el as NodeEl;
  const shape = drawingShape(el.shape);
  const colors = nodeColors(el.color, data.colorMode, data.theme);
  const geo = shapeGeometry(shape, width, height);
  const box = labelBox(shape, width, height);
  const watercolor = data.styleMode === 'watercolor';
  const fill = colors.fill === 'transparent' ? 'none' : colors.fill;
  return (
    <div className="strukt-node" data-selected={selected || undefined} style={{ width, height, fontFamily: FONT_STACK[data.typeface] }}>
      <svg className="strukt-node__paint" width={width} height={height} aria-hidden>
        {data.styleMode === 'shadow' && fill !== 'none' && (
          <path d={geo.d} transform={`translate(0 ${SHADOW_OFFSET})`} fill={colors.shadow} filter={`url(#${SHADOW_FILTER_ID})`} />
        )}
        <path d={geo.d} fill={fill} filter={watercolor ? `url(#${WATERCOLOR_FILTER_ID})` : undefined} stroke={watercolor ? 'none' : colors.stroke} strokeWidth={1} />
        {watercolor && <path d={geo.d} fill="none" stroke={colors.stroke} strokeWidth={1} opacity={0.6} />}
        {geo.detail && <path d={geo.detail} fill="none" stroke={colors.stroke} strokeWidth={1} />}
      </svg>
      <div className="strukt-node__content" style={{ left: box.x, top: box.y, width: box.w, height: box.h, color: colors.text }}>
        {el.icon && <IconGlyph name={el.icon} size={20} color={colors.icon} legibleOn={data.theme} />}
        <EditableLabel id={id} text={el.label ?? el.id} />
      </div>
      <DocBadge link={el.link} evidenceCount={data.evidenceCount} />
      <NodeHandles />
    </div>
  );
});
