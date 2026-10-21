import { uiText } from '../i18n';
import { useRef } from 'react';

/** Shared mouse, touch and keyboard resizing for the workbench's two structural dividers. */
export function PanelDivider({ label, side, value, min, max, initial, onChange, onDragging }: { label: string; side: 'left' | 'right'; value: number; min: number; max: number; initial: number; onChange: (width: number, persist?: boolean) => void; onDragging: (dragging: boolean) => void }) {
  const drag = useRef<{ x: number; width: number; current: number } | null>(null);
  const finish = () => { if (!drag.current) return; const width = drag.current.current; drag.current = null; onDragging(false); onChange(width, true); };
  return <div role="separator" tabIndex={0} aria-orientation="vertical" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(value)}
    aria-description={uiText("Arraste para redimensionar. Duplo clique restaura a largura.")}
    className={`sk-workbench-divider ${side === 'left' ? 'is-left' : 'is-right'}`}
    onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, width: value, current: value }; onDragging(true); }}
    onPointerMove={event => { if (drag.current) { const width = Math.max(min, Math.min(max, drag.current.width + (event.clientX - drag.current.x) * (side === 'left' ? -1 : 1))); drag.current.current = width; onChange(width); } }}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onDoubleClick={() => onChange(initial, true)}
    onKeyDown={event => {
      let next: number;
      if (event.key === 'Home') next = min;
      else if (event.key === 'End') next = max;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = value + (event.key === 'ArrowRight' ? 20 : -20) * (side === 'left' ? -1 : 1);
      else return;
      event.preventDefault(); onChange(Math.max(min, Math.min(max, next)), true);
    }} />;
}
