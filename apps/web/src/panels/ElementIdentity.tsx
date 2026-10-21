import { uiText } from '../i18n';
import type { DiagramElement } from '@strukt/core';
import { Group, Square } from 'lucide-react';
import { IconGlyph } from '../diagram/icons/IconGlyph';
import { useUi } from '../ui/uiStore';

/** Uses the same icon and theme treatment as the component on the canvas. */
export function ElementGlyph({ el, size = 18 }: { el?: DiagramElement; size?: number }) {
  const theme = useUi((s) => s.theme);
  return el?.icon ? <IconGlyph name={el.icon} size={size} legibleOn={theme} />
    : el?.kind === 'group' ? <Group size={size} /> : <Square size={size} />;
}

export function ElementIdentity({ el }: { el: DiagramElement }) {
  return <div className="sk-inspector-identity">
    <span className="sk-inspector-glyph" aria-hidden><ElementGlyph el={el} size={24} /></span>
    <div className="min-w-0 flex-1">
      <h3 className="sk-inspector-name" title={el.label || el.id}>{el.label || el.id}</h3>
      <p className="mt-1 truncate text-caption text-muted" title={el.tech || el.id}>{el.tech || (el.kind === 'group' ? uiText("Grupo de componentes") : uiText("Componente do diagrama"))}</p>
    </div>
  </div>;
}
