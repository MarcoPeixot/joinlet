import { uiText } from '../i18n';
import { CONNECTION_LABEL_MAX } from '@strukt/workspace';
import { useRef } from 'react';

/** Inline label editor: Enter or leaving confirms, Esc cancels; an empty label removes it. */
export function LinkLabelInput({ initial, onDone }: { initial: string; onDone: (value: string | null) => void }) {
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  return (
    <input
      className="strukt-link__label strukt-link__input nodrag nopan"
      aria-label={uiText("Rótulo da conexão")}
      autoFocus
      defaultValue={initial}
      maxLength={CONNECTION_LABEL_MAX}
      size={Math.max(6, initial.length + 1)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') finish(event.currentTarget.value);
        if (event.key === 'Escape') finish(null);
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
    />
  );
}
