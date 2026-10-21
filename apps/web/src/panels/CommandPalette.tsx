import { uiText } from '../i18n';
import { CornerDownLeft, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import type { Command } from '../actions/commands';
import { Keys } from '../ui/Kbd';
import { Modal } from '../ui/Modal';
import { uiStore, useUi } from '../ui/uiStore';
import { paletteGroups } from './commandSearch';
import { pushRecent, readRecents } from './recentCommands';

export function CommandPalette({ commands }: { commands: Command[] }) {
  const open = useUi((s) => s.paletteOpen);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const [recents, setRecents] = useState<string[]>([]);
  // Re-read on every open: another tab (or the last run) may have changed them.
  useEffect(() => {
    if (open) setRecents(readRecents());
  }, [open]);
  const groups = useMemo(() => paletteGroups(commands, query, recents), [commands, query, recents]);
  const items = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const close = () => {
    uiStore.setState({ paletteOpen: false });
    setQuery('');
    setActive(0);
  };
  const run = (command: Command) => {
    close();
    pushRecent(command.id);
    command.run();
  };
  // Keep the highlighted row in view while moving with the arrows.
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <Modal open={open} onClose={close} label={uiText("Comandos")} placement="top" width={560} bare>
      <PaletteContent
        groups={groups}
        query={query}
        active={active}
        listRef={list}
        onQuery={(value) => {
          setQuery(value);
          setActive(0);
        }}
        onHover={setActive}
        onRun={run}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((i) => Math.min(i + 1, items.length - 1));
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          }
          if (event.key === 'Enter' && items[active]) {
            // The command may open another dialog and focus its first button; this Enter must not press it.
            event.preventDefault();
            run(items[active]);
          }
        }}
      />
    </Modal>
  );
}

interface PaletteContentProps {
  groups: { label: string; items: Command[] }[];
  query: string;
  active: number;
  listRef: RefObject<HTMLUListElement | null>;
  onQuery(value: string): void;
  onKeyDown(event: KeyboardEvent<HTMLInputElement>): void;
  onHover(index: number): void;
  onRun(command: Command): void;
}

/** Search box + results as an ARIA combobox/listbox: focus stays in the input, the active row is `aria-activedescendant`. */
export function PaletteContent({ groups, query, active, listRef, onQuery, onKeyDown, onHover, onRun }: PaletteContentProps) {
  const base = useId();
  const count = groups.reduce((sum, group) => sum + group.items.length, 0);
  const listId = `${base}-list`;
  const optionId = (index: number) => `${base}-opt-${index}`;
  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <Search size={16} className="text-muted" />
        <input
          autoFocus
          role="combobox"
          aria-label={uiText("Buscar comandos")}
          aria-autocomplete="list"
          aria-expanded={count > 0}
          aria-controls={count > 0 ? listId : undefined}
          aria-activedescendant={count > 0 ? optionId(Math.min(active, count - 1)) : undefined}
          className="h-full flex-1 bg-transparent text-title outline-none placeholder:text-faint"
          placeholder={uiText("Digite um comando…")}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <kbd>esc</kbd>
      </div>
      {count > 0 ? (
        <ul ref={listRef} id={listId} role="listbox" aria-label={uiText("Comandos")} className="max-h-[min(360px,50vh)] overflow-y-auto p-1.5">
          {groups.map((group, groupIndex) => {
            const offset = groups.slice(0, groupIndex).reduce((sum, other) => sum + other.items.length, 0);
            const labelId = `${base}-grp-${groupIndex}`;
            return (
              <li key={group.label} role="presentation">
                <div id={labelId} className="px-3 pb-1 pt-2 text-caption font-medium text-muted">{group.label}</div>
                <ul role="group" aria-labelledby={labelId}>
                  {group.items.map((command, i) => {
                    const index = offset + i;
                    return (
                      <li key={command.id} role="presentation">
                        <button
                          type="button"
                          role="option"
                          id={optionId(index)}
                          aria-selected={index === active}
                          tabIndex={-1}
                          data-index={index}
                          onMouseMove={() => onHover(index)}
                          onClick={() => onRun(command)}
                          className={`flex h-9 w-full items-center justify-between gap-3 rounded-[8px] px-3 text-left text-body ${index === active ? 'bg-accent-soft text-ink' : 'text-muted'}`}
                        >
                          <span className="truncate">{command.title}</span>
                          {command.hint ? <Keys combo={command.hint} /> : index === active ? <CornerDownLeft size={13} className="text-faint" /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      ) : (
        <div role="status" className="px-3 py-8 text-center text-body text-muted">{uiText("Nenhum comando para “")}{query}{"”"}</div>
      )}
      <footer className="flex h-9 shrink-0 items-center gap-3 border-t border-line px-4 text-caption text-faint">
        <span className="flex items-center gap-1.5"><Keys combo="↑↓" /> {uiText("navegar")}</span>
        <span className="flex items-center gap-1.5"><Keys combo="↵" /> {uiText("executar")}</span>
        <span className="flex items-center gap-1.5"><Keys combo="esc" /> {uiText("fechar")}</span>
      </footer>
    </>
  );
}
