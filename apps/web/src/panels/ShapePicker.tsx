import { uiText } from '../i18n';
import { BASIC_SHAPES } from '@strukt/core';
import { Sparkles } from 'lucide-react';
import type { Shape } from '@strukt/core';
import { SHAPE_LABELS } from '../diagram/labels';
import { shapeGeometry } from '../diagram/shapes';

export function ShapePicker({ value, onChange, allowIcon = false }: { value?: Shape; onChange: (shape: Shape | null) => void; allowIcon?: boolean }) {
  return (
    <div className="grid grid-cols-6 gap-1">
      {allowIcon && <button type="button" aria-label={uiText("Apenas ícone")} title={uiText("Apenas ícone")} aria-pressed={!value} onClick={() => onChange(null)} className={`flex h-8 items-center justify-center rounded-control border ${!value ? 'border-accent/50 bg-accent-soft text-accent' : 'border-transparent text-muted hover:bg-panel-2'}`}><Sparkles size={18} /></button>}
      {BASIC_SHAPES.map((shape) => (
        <button
          key={shape}
          type="button"
          title={SHAPE_LABELS[shape]}
          aria-label={SHAPE_LABELS[shape]}
          aria-pressed={shape === value}
          onClick={() => onChange(shape)}
          className={`flex h-8 items-center justify-center rounded-control border transition-colors duration-(--sk-motion-fast) ${
            shape === value ? 'border-accent/50 bg-accent-soft text-accent' : 'border-transparent text-muted hover:bg-panel-2 hover:text-ink'
          }`}
        >
          <svg width="30" height="20" viewBox="-1 -1 32 22" aria-hidden>
            <path d={shapeGeometry(shape, 30, 20).d} fill="none" stroke="currentColor" strokeWidth="1.25" />
            {shapeGeometry(shape, 30, 20).detail && <path d={shapeGeometry(shape, 30, 20).detail} fill="none" stroke="currentColor" strokeWidth="1" />}
          </svg>
        </button>
      ))}
    </div>
  );
}
