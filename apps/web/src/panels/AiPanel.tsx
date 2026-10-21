import { uiText } from '../i18n';
import type { ModelChanges } from '@strukt/core';
import { ArrowUp, Sparkles, X } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { useEffect, useRef } from 'react';
import { aiStore, toggleAi, useAi } from '../ai/session';
import { openSettings } from '../settings/store';
import type { AiMode } from '../ai/client';
import { useDiagram } from '../state/appStore';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Keys } from '../ui/Kbd';
import { Segmented, inputClass } from '../ui/controls';
import { EASE_OUT, SPRING } from '../ui/motion';
import { uiStore } from '../ui/uiStore';

const MODES: { value: AiMode; label: string }[] = [
  { value: 'edit', label: uiText("Editar diagrama") },
  { value: 'generate', label: uiText("Gerar do zero") },
];

const PLACEHOLDER: Record<AiMode, string> = {
  edit: uiText("Ex.: adicione um Redis entre API Gateway e Pedidos"),
  generate: uiText("Ex.: e-commerce com app web, API, pagamentos e PostgreSQL"),
};

/** "2 adicionados · 1 removido · 1 alterado", counting elements and connections. */
function tally({ elements: e, edges: c }: ModelChanges): { label: string; color: string }[] {
  const rows: [number, string, string, string][] = [
    [e.added.length + c.added.length, uiText("adicionado"), uiText("adicionados"), 'var(--sk-diff-added)'],
    [e.removed.length + c.removed.length, uiText("removido"), uiText("removidos"), 'var(--sk-diff-removed)'],
    [e.changed.length + c.changed.length, uiText("alterado"), uiText("alterados"), 'var(--sk-diff-changed)'],
  ];
  return rows.filter(([n]) => n > 0).map(([n, one, many, color]) => ({ label: `${n} ${n === 1 ? one : many}`, color }));
}

const MORPH = 'ai-composer';

function BrandMark({ size = 14 }: { size?: number }) {
  return (
    <span className="flex h-6 w-6 flex-none items-center justify-center rounded-chip bg-accent-soft text-accent">
      <Sparkles size={size} />
    </span>
  );
}

/**
 * The advanced composer opens from commands or ⌘J. The permanent bottom control belongs to details.
 */
export function AiComposer() {
  const open = useAi((s) => s.open);
  return (
    // Sized by the canvas (a container), not the window: the sidebar and the code dock narrow it too.
    <div className="sk-composer @container pointer-events-none absolute inset-x-0 bottom-3 z-20">
      {/* Pill and card share one grid cell, so the one leaving never pushes the one arriving aside. */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-end justify-items-center px-[196px] @max-[900px]:px-3">
        <AnimatePresence initial={false}>{open ? <ComposerCard key="card" /> : null}</AnimatePresence>
      </div>
    </div>
  );
}

/** Space (px) the open composer takes from the bottom of the canvas: its height plus the gap to the edge. */
const COMPOSER_GAP = 24;

/** While the card is open, tells `fitView` to keep the diagram clear of it (see fitOptionsFor). */
function useFitInset(ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    const set = (px: number) => uiStore.setState({ fitInsetBottom: px });
    if (!el) return;
    set(Math.round(el.getBoundingClientRect().height + COMPOSER_GAP));
    if (typeof ResizeObserver === 'undefined') return () => set(0);
    const observer = new ResizeObserver(() => set(Math.round(el.getBoundingClientRect().height + COMPOSER_GAP)));
    observer.observe(el);
    return () => {
      observer.disconnect();
      set(0);
    };
  }, [ref]);
}

function ComposerCard() {
  const card = useRef<HTMLElement>(null);
  useFitInset(card);
  const mode = useAi((s) => s.mode);
  const prompt = useAi((s) => s.prompt);
  const useSelection = useAi((s) => s.useSelection);
  const status = useAi((s) => s.status);
  const notice = useAi((s) => s.notice);
  const offlineReason = useAi((s) => s.offlineReason);
  const draft = useAi((s) => s.draft);
  const selected = useDiagram((s) => s.selection.nodes.length);
  const ai = aiStore.getState();
  const loading = status === 'loading';

  return (
    <m.section
      ref={card}
      layoutId={MORPH}
      aria-label={uiText("Assistente de IA")}
      transition={SPRING}
      className="sk-float pointer-events-auto col-start-1 row-start-1 flex max-h-[45vh] w-full max-w-[560px] flex-col overflow-hidden rounded-panel @max-[900px]:ml-[180px] @max-[900px]:w-[calc(100%-180px)] @max-[560px]:mb-14 @max-[560px]:ml-0 @max-[560px]:w-full"
    >
      <m.div
        className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.2, delay: 0.06, ease: EASE_OUT } }}
        exit={{ opacity: 0, transition: { duration: 0.08 } }}
      >
        <header className="flex flex-wrap items-center gap-2.5">
          <BrandMark />
          <span className="text-title font-semibold">{uiText("Diagrama com IA")}</span>
          {offlineReason && (
            <button
              type="button"
              title={uiText("{0} Clique para configurar um provider.", [offlineReason])}
              onClick={() => openSettings('ai')}
              className="rounded-full border border-line bg-panel-2 px-2 py-0.5 text-meta text-muted transition-colors hover:border-accent/40 hover:text-accent"
            >{uiText("modo offline")}</button>
          )}
          <div className="ml-auto flex items-center gap-2 @max-[560px]:w-full @max-[560px]:justify-between">
            {!draft && (
              <div className="w-[236px]">
                <Segmented value={mode} options={MODES} onChange={ai.setMode} />
              </div>
            )}
            <IconButton label={uiText("Fechar IA")} onClick={toggleAi}>
              <X />
            </IconButton>
          </div>
        </header>

        {draft ? (
          <>
            <p className="text-body leading-relaxed">{draft.summary}</p>
            <div className="flex flex-wrap items-center gap-1.5 text-caption">
              {tally(draft.changes).map(({ label, color }) => (
                <span key={label} className="rounded-full border px-2 py-0.5 font-medium" style={{ color, borderColor: `color-mix(in srgb, ${color} 35%, transparent)` }}>
                  {label}
                </span>
              ))}
              {draft.changes.style && (
                <span className="rounded-full border px-2 py-0.5 font-medium" style={{ color: 'var(--sk-diff-changed)', borderColor: 'color-mix(in srgb, var(--sk-diff-changed) 35%, transparent)' }}>{uiText("estilo alterado")}</span>
              )}
              <span className="ml-auto font-mono text-meta text-faint">{draft.source === 'offline' ? uiText("regras locais") : draft.model}</span>
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={ai.discard}>{uiText("Descartar")}</Button>
              <Button variant="brand" onClick={() => void ai.apply()}>{uiText("Aplicar")}</Button>
            </div>
          </>
        ) : (
          <>
            <div className="relative">
              <textarea
                aria-label={uiText("Instrução para a IA")}
                autoFocus
                rows={3}
                className={`${inputClass} min-h-[84px] resize-none py-2.5 pr-12 leading-relaxed`}
                placeholder={PLACEHOLDER[mode]}
                value={prompt}
                disabled={loading}
                onChange={(event) => ai.setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void ai.submit();
                  }
                  if (event.key === 'Escape') toggleAi();
                }}
              />
              <button
                type="button"
                aria-label={loading ? uiText("Pensando…") : uiText("Enviar")}
                title={uiText("Enviar (⌘↵)")}
                disabled={loading || !prompt.trim()}
                onClick={() => void ai.submit()}
                className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-control bg-accent-strong text-accent-ink transition-[filter,opacity] duration-(--sk-motion-fast) hover:brightness-110 disabled:opacity-40"
              >
                <ArrowUp size={16} strokeWidth={2.25} />
              </button>
            </div>
            <div className="flex min-h-5 items-center gap-3 text-caption">
              {mode === 'edit' && selected > 0 && (
                <label className="flex items-center gap-2 text-muted">
                  <input type="checkbox" className="accent-(--sk-accent)" checked={useSelection} onChange={(event) => ai.setUseSelection(event.target.checked)} />{uiText("Usar seleção (")}{selected}{")"}</label>
              )}
              <AnimatePresence mode="wait" initial={false}>
                {loading ? (
                  <m.span key="thinking" className="sk-shimmer font-medium" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>{uiText("Pensando…")}</m.span>
                ) : notice ? (
                  <m.span key={notice.text} className={notice.kind === 'error' ? 'text-danger' : 'text-muted'} initial={{ opacity: 0, y: 2 }} animate={{ opacity: 1, y: 0 }}>
                    {notice.text}
                  </m.span>
                ) : null}
              </AnimatePresence>
              <span className="ml-auto flex items-center gap-1.5 text-faint">
                <Keys combo="⌘↵" /> {uiText("envia · a proposta aparece no canvas antes de aplicar")}</span>
            </div>
          </>
        )}
      </m.div>
    </m.section>
  );
}
