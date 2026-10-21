import { uiText } from '../i18n';
import { SWATCHES, resolveColor } from '../diagram/palette';
import { inputClass } from '../ui/controls';

const swatch = 'relative h-6 w-6 rounded-full transition-transform duration-(--sk-motion-fast) ease-sk hover:scale-110 active:scale-95';
const ring = 'ring-2 ring-accent ring-offset-2 ring-offset-panel';

interface ColorPickerProps {
  value?: string;
  onChange: (value: string | null) => void;
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const current = value?.trim().toLowerCase();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        title={uiText("Sem cor")}
        onClick={() => onChange(null)}
        className={`${swatch} border border-line-strong ${!current ? ring : ''}`}
      >
        <span className="absolute left-1/2 top-1/2 h-px w-5 -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-muted" />
      </button>
      {SWATCHES.map((name) => (
        <button
          key={name}
          type="button"
          title={name}
          onClick={() => onChange(name)}
          className={`${swatch} shadow-[inset_0_0_0_1px_rgba(0,0,0,0.15)] ${current === name ? ring : ''}`}
          style={{ background: resolveColor(name) ?? undefined }}
        />
      ))}
      <input
        key={value ?? ''}
        className={`${inputClass} h-7 w-20 px-2 font-mono text-caption`}
        placeholder="#hex"
        defaultValue={current?.startsWith('#') ? current : ''}
        onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
        onBlur={(event) => {
          const next = event.currentTarget.value.trim();
          if (next && resolveColor(next) && next.toLowerCase() !== current) onChange(next);
        }}
      />
    </div>
  );
}
