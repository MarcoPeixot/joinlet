import { uiText } from '../i18n';
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { COMMENT_LIMITS } from '@strukt/workspace';
import { Button } from '../ui/Button';
import { inputClass } from '../ui/controls';
import { useCollaborationSlice } from '../workspace/collaborationView';
import { applyMention, mentionQuery } from './mention';
import { currentCandidates, setCommentName, useWho } from './session';

/** Asks for a name once, before the first comment: who someone is in a comment is what they chose here. */
export function NameGate({ children }: { children: React.ReactNode }) {
  const who = useWho();
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  if (who.named) return <>{children}</>;
  const save = () => {
    try { setCommentName(name); setProblem(null); }
    catch (error) { setProblem(error instanceof Error ? error.message : String(error)); }
  };
  return (
    <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-muted">{uiText("Como você quer aparecer nos comentários?")}</span>
        <input className={`${inputClass} h-8`} value={name} maxLength={COMMENT_LIMITS.name} placeholder={uiText("Seu nome")} autoFocus onChange={(event) => setName(event.target.value)} />
      </label>
      {problem && <p role="alert" className="text-caption text-danger">{problem}</p>}
      <Button type="submit" variant="primary" size="sm" disabled={!name.trim()} className="self-start">{uiText("Continuar")}</Button>
    </form>
  );
}

interface ComposerProps {
  placeholder: string;
  submitLabel: string;
  /** Sends the text; resolves true when it is in the file (the box then empties). */
  onSubmit(text: string): Promise<boolean>;
  onCancel?(): void;
  initial?: string;
  autoFocus?: boolean;
  label: string;
}

/** A comment box with @-mentions: the names of who is in the room (and who commented before) complete as you type. */
export function Composer({ placeholder, submitLabel, onSubmit, onCancel, initial = '', autoFocus, label }: ComposerProps) {
  const who = useWho();
  const [text, setText] = useState(initial);
  const [caret, setCaret] = useState(initial.length);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const list = useId();
  // The room changes who can be mentioned: re-read when someone comes or goes.
  useCollaborationSlice((state) => state.others.map((person) => person.name).join("\n"));
  const typing = mentionQuery(text, caret);
  const options = typing && dismissed !== typing.at ? currentCandidates(typing.query) : [];
  const open = options.length > 0;
  const chosen = Math.min(pick, Math.max(0, options.length - 1));

  useEffect(() => { if (autoFocus) box.current?.focus(); }, [autoFocus]);

  const send = async () => {
    const clean = text.trim();
    if (!clean || busy) return;
    setBusy(true);
    const ok = await onSubmit(clean);
    setBusy(false);
    if (ok) { setText(''); setCaret(0); }
  };
  const insert = (name: string) => {
    if (!typing) return;
    const next = applyMention(text, typing.at, caret, name);
    setText(next.text);
    setCaret(next.caret);
    setPick(0);
    // The name is in: the list closes (it would still match "@Ana ") until the next thing typed.
    setDismissed(typing.at);
    requestAnimationFrame(() => { box.current?.focus(); box.current?.setSelectionRange(next.caret, next.caret); });
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (open) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setPick((chosen + 1) % options.length); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); setPick((chosen - 1 + options.length) % options.length); return; }
      if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); insert(options[chosen]!.name); return; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(typing!.at); return; }
    }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); return; }
    if (event.key === 'Escape' && onCancel) { event.preventDefault(); event.stopPropagation(); onCancel(); }
  };

  if (!who.canWrite) return <p className="text-caption text-muted">{uiText("Seu link só permite ver os comentários.")}</p>;
  return (
    <NameGate>
      <div className="relative flex flex-col gap-1.5">
        <textarea
          ref={box}
          aria-label={label}
          aria-autocomplete="list"
          aria-controls={open ? list : undefined}
          aria-expanded={open}
          role="combobox"
          rows={2}
          className={`${inputClass} min-h-14 resize-y py-2 leading-snug`}
          value={text}
          maxLength={COMMENT_LIMITS.text}
          placeholder={placeholder}
          disabled={busy}
          onChange={(event) => { setText(event.target.value); setCaret(event.target.selectionStart); setDismissed(null); }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={onKey}
        />
        {open && (
          <ul id={list} role="listbox" aria-label={uiText("Pessoas para mencionar")} className="max-h-40 overflow-y-auto rounded-control border border-line bg-panel p-1">
            {options.map((person, index) => (
              <li key={person.name} role="option" aria-selected={index === chosen}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insert(person.name)}
                  className={`flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-body ${index === chosen ? 'bg-panel-2' : ''}`}
                >
                  <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: person.color }} />
                  <span className="min-w-0 flex-1 truncate">{person.name}</span>
                  {person.here && <span className="text-caption text-faint">{uiText("na sala")}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <span className="flex-1 text-caption text-faint">{uiText("Enter envia · @ menciona")}</span>
          {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>{uiText("Cancelar")}</Button>}
          <Button size="sm" variant="primary" disabled={busy || !text.trim()} onClick={() => void send()}>{busy ? uiText("Enviando…") : submitLabel}</Button>
        </div>
      </div>
    </NameGate>
  );
}
