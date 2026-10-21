import { uiText } from '../i18n';
import { Ban, Search, X } from 'lucide-react';
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { IconCatalog, IconEntry } from '../diagram/icons/catalog';
import { IconGlyph } from '../diagram/icons/IconGlyph';
import { diagramStore } from '../state/appStore';
import type { Theme } from '../ui/theme';
import { useUi } from '../ui/uiStore';
import { layoutGrid, moveActive, scrollToReveal, visibleRange } from './virtualGrid';
import type { GridMove } from './virtualGrid';

type CatalogModule = typeof import('../diagram/icons/catalog');
interface LoadedCatalog {
  catalog: IconCatalog;
  search: CatalogModule['searchIcons'];
  browse: CatalogModule['browseSections'];
  find: CatalogModule['findIcon'];
}

let loading: Promise<LoadedCatalog> | null = null;

/** The catalog chunk (names, categories, search) loads the first time a picker opens. */
function loadCatalog(): Promise<LoadedCatalog> {
  loading ??= import('../diagram/icons/catalog')
    .then(async (mod) => ({ catalog: await mod.loadIconCatalog(), search: mod.searchIcons, browse: mod.browseSections, find: mod.findIcon }))
    .catch((error: unknown) => {
      loading = null;
      throw error;
    });
  return loading;
}

const WIDTH = 448;
const HEIGHT = 520;
const MARGIN = 8;
const PAD = 8;
const GAP = 4;
const MIN_TILE = 60;
const HEADER_ROW = 28;
const OVERSCAN = 3;

/** `null` is the "Sem ícone" tile. */
type Item = IconEntry | null;
interface Section {
  key: string;
  title?: string;
  items: Item[];
}

const optionId = (index: number) => `sk-icon-option-${index}`;

function arrowMove(key: string): GridMove | null {
  switch (key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    default:
      return null;
  }
}

interface IconFieldProps {
  value?: string;
  onChange: (icon: string | null) => void;
  inline?: boolean;
}

/**
 * Inspector "Ícone": the current icon and a trigger that opens the picker. Enter and Space activate the trigger
 * like any button (the global shortcuts leave plain keys aimed at a focused button alone); ArrowDown opens it too.
 */
export function IconField({ value, onChange, inline = false }: IconFieldProps) {
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const theme = useUi((s) => s.theme);
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);
  const pick = useCallback(
    (icon: string | null) => {
      if ((icon ?? '') !== (value ?? '')) onChange(icon);
      close(true);
    },
    [value, onChange, close],
  );
  return (
    <div ref={field} className={`flex items-center gap-2 ${inline ? 'flex-wrap' : ''}`}>
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-control border border-line">
        {value ? <IconGlyph name={value} size={18} legibleOn={theme} /> : null}
      </span>
      <button
        ref={trigger}
        type="button"
        title={uiText("Escolher ícone")}
        aria-label={uiText("Ícone: {0}", [value || uiText("nenhum")])}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`h-8 min-w-0 flex-1 cursor-pointer truncate rounded-control border border-line bg-panel-2 px-2 text-left outline-none transition-colors hover:border-line-strong focus:border-accent ${value ? 'text-ink' : 'text-muted'}`}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {value || uiText("Sem ícone")}
      </button>
      {open && field.current && <IconPickerPopover anchor={field.current} value={value} theme={theme} onPick={pick} onClose={close} inline={inline} />}
    </div>
  );
}

/** Beside the Inspector (over the canvas) when there is room, else under the field; always inside the window. */
function placement(anchor: DOMRect): { left: number; top: number; width: number; height: number } {
  const width = Math.min(WIDTH, window.innerWidth - 2 * MARGIN);
  const height = Math.min(HEIGHT, window.innerHeight - 2 * MARGIN);
  const clamp = (value: number, max: number) => Math.max(MARGIN, Math.min(value, max));
  const beside = anchor.left - 24 - width;
  if (beside >= MARGIN) return { left: beside, top: clamp(anchor.top - 72, window.innerHeight - height - MARGIN), width, height };
  return { left: clamp(anchor.right - width, window.innerWidth - width - MARGIN), top: clamp(anchor.bottom + 6, window.innerHeight - height - MARGIN), width, height };
}

interface PopoverProps {
  anchor: HTMLElement;
  value?: string;
  theme: Theme;
  onPick: (icon: string | null) => void;
  onClose: (refocus: boolean) => void;
  inline?: boolean;
}

function IconPickerPopover({ anchor, value, theme, onPick, onClose, inline = false }: PopoverProps) {
  const [data, setData] = useState<LoadedCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [, setResized] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const sidebar = useRef<HTMLElement>(null);

  const load = useCallback(() => {
    setFailed(false);
    loadCatalog().then(setData, () => setFailed(true));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !anchor.contains(target)) onClose(false);
    };
    const onResize = () => setResized((n) => n + 1);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onResize);
    };
  }, [anchor, onClose]);

  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const measure = () => setViewport({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [data]);

  const usedIcons = useMemo(() => Object.values(diagramStore.getState().model.elements).flatMap((el) => (el.icon ? [el.icon] : [])), []);
  const searching = query.trim() !== '';
  const sections = useMemo((): Section[] => {
    if (!data) return [];
    if (searching) return [{ key: 'results', items: data.search(data.catalog, query, category ?? undefined) }];
    if (category) return [{ key: category, items: data.search(data.catalog, '', category) }];
    return data.browse(data.catalog, usedIcons).map((section, i) => ({
      key: section.id,
      title: section.title,
      items: i === 0 && value ? [null, ...section.entries] : section.entries,
    }));
  }, [data, searching, query, category, usedIcons, value]);
  const items = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const currentName = data && value ? (data.find(data.catalog, value)?.name ?? value) : value;

  const gridWidth = viewport.width - 2 * PAD;
  const columns = Math.max(1, Math.floor((gridWidth + GAP) / (MIN_TILE + GAP)));
  const tile = Math.max(MIN_TILE, (gridWidth - GAP * (columns - 1)) / columns);
  const layout = useMemo(
    () => layoutGrid(sections.map((s) => ({ key: s.key, title: s.title, size: s.items.length })), { columns, rowHeight: tile + GAP, headerHeight: HEADER_ROW }),
    [sections, columns, tile],
  );

  // The active tile belongs to one list of sections; a new search or category starts over (on the current icon when browsing).
  const [cursor, setCursor] = useState<{ sections: Section[]; index: number } | null>(null);
  const initial = useMemo(() => {
    const index = searching || category ? -1 : items.findIndex((item) => item?.name === currentName);
    return index >= 0 ? index : items.length ? 0 : -1;
  }, [items, searching, category, currentName]);
  const active = cursor?.sections === sections ? cursor.index : initial;
  const setActive = useCallback((index: number) => setCursor({ sections, index }), [sections]);

  useLayoutEffect(() => {
    if (grid.current) grid.current.scrollTop = 0;
    setScrollTop(0);
  }, [sections]);
  useEffect(() => {
    sidebar.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [category, data]);

  // Rows sit PAD below their layout offset: revealing in layout space with a viewport 2·PAD shorter keeps a PAD margin.
  const reveal = (index: number) => {
    const el = grid.current;
    if (!el) return;
    const top = scrollToReveal(layout, index, el.scrollTop, el.clientHeight - 2 * PAD);
    if (top !== el.scrollTop) el.scrollTop = top;
  };

  const pickItem = useCallback((item: Item) => onPick(item ? item.name : null), [onPick]);
  const categoryIds = data ? [null, ...data.catalog.categories.map((c) => c.id)] : [null];

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const move = arrowMove(event.key);
    if (move) {
      event.preventDefault();
      const next = moveActive(layout, active, move);
      setActive(next);
      reveal(next);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (active >= 0 && active < items.length) pickItem(items[active] as Item);
      else if (searching && data && !items.length) onPick(query.trim());
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (inline) event.stopPropagation();
      onClose(true);
    } else if (event.key === 'Tab' && data) {
      event.preventDefault();
      const at = categoryIds.indexOf(category);
      setCategory(categoryIds[(at + (event.shiftKey ? -1 : 1) + categoryIds.length) % categoryIds.length] ?? null);
    }
  };

  const chooseCategory = (id: string | null) => {
    setCategory(id);
    input.current?.focus();
  };
  const categoryLabel = category && data?.catalog.categories.find((c) => c.id === category)?.label;
  const activeItem = active >= 0 ? items[active] : undefined;
  const { from, to } = visibleRange(layout, Math.max(0, scrollTop - PAD), viewport.height, OVERSCAN);
  const box = inline ? { width: '100%', height: 400 } : placement(anchor.getBoundingClientRect());

  const content = (
    <div
      ref={root}
      role="dialog"
      data-inline-picker={inline || undefined}
      aria-label={uiText("Escolher ícone")}
      className={`${inline ? 'relative basis-full' : 'fixed z-40'} flex flex-col overflow-hidden rounded-panel border border-line bg-panel text-ink shadow-panel`}
      style={box}
      // Clicks inside keep the focus in the search field (keys go to the grid through it).
      onMouseDown={(event) => {
        if (event.target !== input.current) event.preventDefault();
      }}
    >
      <div className="flex h-11 flex-none items-center gap-2 border-b border-line px-3">
        <Search size={15} className="flex-none text-muted" aria-hidden />
        <input
          ref={input}
          role="combobox"
          aria-label={uiText("Buscar ícones")}
          aria-expanded
          aria-controls="sk-icon-grid"
          aria-autocomplete="list"
          aria-activedescendant={activeItem !== undefined ? optionId(active) : undefined}
          placeholder={uiText("Buscar ícones…")}
          spellCheck={false}
          autoComplete="off"
          className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-muted"
          style={{ outline: 'none' }}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={(event) => {
            if (event.relatedTarget && !root.current?.contains(event.relatedTarget as Node)) onClose(false);
          }}
        />
        {query && (
          <button type="button" tabIndex={-1} aria-label={uiText("Limpar busca")} className="flex h-6 w-6 flex-none items-center justify-center rounded-control text-muted hover:bg-panel-2 hover:text-ink" onClick={() => setQuery('')}>
            <X size={14} />
          </button>
        )}
      </div>
      <div className="flex h-8 flex-none items-center gap-1.5 border-b border-line px-3 text-[12px] text-muted">
        <Crumb label={uiText("Todas as categorias")} current={!category && !searching} onClick={() => { setQuery(''); chooseCategory(null); }} />
        {categoryLabel && (
          <>
            <span aria-hidden>/</span>
            <Crumb label={categoryLabel} current={!searching} onClick={() => setQuery('')} />
          </>
        )}
        {searching && (
          <>
            <span aria-hidden>/</span>
            <span className="text-ink">{uiText("Busca")}</span>
            {data && <span className="sk-num">{"·"} {items.length}</span>}
          </>
        )}
        {value && (
          <button type="button" tabIndex={-1} className="ml-auto flex-none rounded px-1 hover:text-danger" onClick={() => onPick(null)}>{uiText("Remover ícone")}</button>
        )}
      </div>
      <div className="flex min-h-0 flex-1">
        <nav ref={sidebar} aria-label={uiText("Categorias")} className="w-[164px] flex-none overflow-y-auto border-r border-line py-1">
          {data && (
            <>
              <CategoryButton label={uiText("Todas as categorias")} count={data.catalog.entries.length} selected={category === null} onClick={() => chooseCategory(null)} />
              {data.catalog.categories.map((c, i) => (
                <Fragment key={c.id}>
                  {c.group && c.group !== data.catalog.categories[i - 1]?.group && (
                    <div className="px-2.5 pb-1 pt-3 text-[10px] font-medium uppercase leading-tight tracking-wide text-muted">{c.group}</div>
                  )}
                  <CategoryButton label={c.label} count={c.count} selected={category === c.id} onClick={() => chooseCategory(c.id)} />
                </Fragment>
              ))}
            </>
          )}
        </nav>
        <div
          ref={grid}
          id="sk-icon-grid"
          role="listbox"
          aria-label={categoryLabel || (searching ? uiText("Resultados da busca") : uiText("Ícones"))}
          className="relative min-w-0 flex-1 overflow-y-auto"
          style={{ scrollbarGutter: 'stable' }}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          {!data ? (
            <Status>
              {failed ? (
                <>{uiText("Não foi possível carregar os ícones.")}<button type="button" tabIndex={-1} className="text-accent hover:underline" onClick={load}>{uiText("Tentar de novo")}</button>
                </>
              ) : (
                uiText("Carregando ícones…")
              )}
            </Status>
          ) : !items.length ? (
            <Status>
              <span>{uiText("Nenhum ícone para “")}{query.trim()}”.</span>
              {category && (
                <button type="button" tabIndex={-1} className="text-accent hover:underline" onClick={() => chooseCategory(null)}>{uiText("Buscar em todas as categorias")}</button>
              )}
              <button type="button" tabIndex={-1} className="text-accent hover:underline" onClick={() => onPick(query.trim())}>{uiText("Usar “")}{query.trim()}{uiText("” como nome (Enter)")}</button>
            </Status>
          ) : (
            viewport.width > 0 && (
              <div className="relative" style={{ height: layout.height + 2 * PAD }}>
                {layout.rows.slice(from, to).map((row) =>
                  row.kind === 'header' ? (
                    <div
                      key={row.key}
                      className="absolute flex items-end gap-1.5 pb-1.5 text-[11px] font-medium text-muted"
                      style={{ top: row.top + PAD, left: PAD + 2, right: PAD, height: row.height }}
                    >
                      <span className="truncate">{row.title}</span>
                      <span className="sk-num opacity-70">{row.count}</span>
                    </div>
                  ) : (
                    <div
                      key={row.key}
                      className="absolute grid"
                      style={{ top: row.top + PAD, left: PAD, right: PAD, height: tile, gap: GAP, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
                    >
                      {items.slice(row.start, row.end).map((item, i) => (
                        <Tile
                          key={item?.name ?? '∅'}
                          item={item}
                          index={row.start + i}
                          active={row.start + i === active}
                          current={item ? item.name === currentName : false}
                          theme={theme}
                          onHover={setActive}
                          onPick={pickItem}
                        />
                      ))}
                    </div>
                  ),
                )}
              </div>
            )
          )}
        </div>
      </div>
      <div className="flex h-8 flex-none items-center gap-3 border-t border-line px-3 text-[11px] text-muted">
        <span className="flex-none">{uiText("↑↓ navegar · Enter aplicar · Tab categoria")}</span>
        <span className="ml-auto min-w-0 truncate font-mono text-ink">{activeItem === null ? uiText("Remover ícone") : activeItem?.name}</span>
      </div>
    </div>
  );
  return inline ? content : createPortal(content, document.body);
}

function Crumb({ label, current, onClick }: { label: string; current: boolean; onClick: () => void }) {
  if (current) return <span className="truncate text-ink">{label}</span>;
  return (
    <button type="button" tabIndex={-1} className="truncate hover:text-ink hover:underline" onClick={onClick}>
      {label}
    </button>
  );
}

function CategoryButton({ label, count, selected, onClick }: { label: string; count: number; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-pressed={selected}
      aria-label={uiText("{0}, {1} ícones", [label, count])}
      className={`flex min-h-7 w-full items-center gap-1.5 px-2.5 py-1 text-left text-[12px] leading-tight transition-colors ${selected ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-panel-2'}`}
      onClick={onClick}
    >
      <span className="min-w-0 flex-1">{label}</span>
      <span className={`flex-none text-[10.5px] sk-num ${selected ? '' : 'text-muted'}`}>{count}</span>
    </button>
  );
}

function Status({ children }: { children: ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-[12px] text-muted">{children}</div>;
}

interface TileProps {
  item: Item;
  index: number;
  active: boolean;
  current: boolean;
  theme: Theme;
  onHover: (index: number) => void;
  onPick: (item: Item) => void;
}

const Tile = memo(function Tile({ item, index, active, current, theme, onHover, onPick }: TileProps) {
  return (
    <div
      id={optionId(index)}
      role="option"
      aria-selected={active}
      aria-label={item ? `${item.label} (${item.name})` : uiText("Remover ícone")}
      title={item ? `${item.label} · ${item.name}` : uiText("Remover ícone")}
      data-active={active || undefined}
      data-current={current || undefined}
      className="flex min-w-0 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-control border border-transparent px-1 text-ink transition-colors hover:bg-panel-2 data-[current]:border-accent data-[active]:bg-accent-soft"
      onMouseMove={() => {
        if (!active) onHover(index);
      }}
      onClick={() => onPick(item)}
    >
      {item ? <IconGlyph name={item.name} size={26} legibleOn={theme} /> : <Ban size={24} strokeWidth={1.5} className="text-muted" aria-hidden />}
      <span className="w-full truncate text-center text-[10.5px] leading-tight text-muted">{item ? item.label : uiText("Sem ícone")}</span>
    </div>
  );
});
