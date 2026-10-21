import { m } from 'motion/react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { GLIDE } from './motion';

/** Field labels read as plain small text; the mono caps "stamp" is for section titles (`PanelSection`). */
const fieldLabel = 'text-caption font-medium text-muted';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

/** Like `Field`, for a set of buttons (`Segmented`): a `<label>` would name and click only the first one. */
export function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      <span className={fieldLabel}>{label}</span>
      {children}
    </div>
  );
}

/** Text inputs, textareas and selects share this look (hover lifts the border, focus rings in the accent). */
export const inputClass =
  'sk-input w-full rounded-control border border-transparent bg-panel-2 px-2.5 text-body text-ink outline-none transition-[border-color,background-color,box-shadow] duration-(--sk-motion-fast) placeholder:text-faint focus:border-accent focus:bg-panel focus:shadow-[0_0_0_3px_var(--sk-accent-soft)] disabled:opacity-60';

interface TextFieldProps {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  list?: string;
  mono?: boolean;
}

/** Commits on Enter/blur (one history step per edit), Escape reverts. */
export function TextField({ value, onCommit, placeholder, list, mono }: TextFieldProps) {
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className={`${inputClass} h-8 ${mono ? 'font-mono text-caption' : ''}`}
      value={draft}
      placeholder={placeholder}
      list={list}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          cancelled.current = true;
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function TextArea({ value, onCommit, placeholder }: { value: string; onCommit: (value: string) => void; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      className={`${inputClass} min-h-20 resize-y py-2 leading-relaxed`}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
    />
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  options: readonly { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
}

/** Options side by side; the chosen one sits on a pill that glides between them. */
export function Segmented<T extends string>({ value, options, onChange }: SegmentedProps<T>) {
  const pill = useId();
  return (
    <div
      className="grid gap-0.5 rounded-control border border-transparent bg-panel-2 p-0.5"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            title={option.title}
            aria-pressed={on}
            onClick={() => onChange(option.value)}
            className={`relative h-7 rounded-[7px] text-caption font-medium transition-colors duration-(--sk-motion-fast) ${on ? 'text-ink' : 'text-muted hover:text-ink'}`}
          >
            {on && (
              <m.span
                layoutId={pill}
                transition={GLIDE}
                className="absolute inset-0 rounded-[7px] bg-panel shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
