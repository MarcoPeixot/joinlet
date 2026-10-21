import { useRef, useState } from 'react';

interface InlineInputProps {
  initial: string;
  placeholder?: string;
  label: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  className?: string;
}

/** Focused text input for naming things in place: Enter or blur commits, Escape cancels. */
export function InlineInput({ initial, placeholder, label, onCommit, onCancel, className = '' }: InlineInputProps) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit && value.trim()) onCommit(value.trim());
    else onCancel();
  };
  return (
    <input
      autoFocus
      aria-label={label}
      className={`h-7 w-full rounded-control border border-accent bg-panel px-2 text-body text-ink shadow-[0_0_0_3px_var(--sk-accent-soft)] outline-none placeholder:text-faint ${className}`}
      value={value}
      placeholder={placeholder}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(true);
        if (event.key === 'Escape') finish(false);
      }}
    />
  );
}
