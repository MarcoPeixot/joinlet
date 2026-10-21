import { uiText } from '../i18n';
import { Check, ChevronDown, ChevronUp, X } from 'lucide-react';
import { m } from 'motion/react';
import { useState } from 'react';
import { aiStore } from '../ai/session';
import { openGithub } from '../github/session';
import { useDiagram } from '../state/appStore';
import { IconButton } from '../ui/IconButton';
import { FADE } from '../ui/motion';
import { openSaveVersion, useVersions } from '../versions/session';
import { CHECKLIST_ITEMS, checklistProgress, readChecklist, writeChecklist } from './checklistState';
import type { ChecklistItem, ChecklistState } from './checklistState';
import { isPristineSample } from './firstRun';
import { onboardingSurface } from './surface';
import { startTour } from './tour';
import { useFirstRunVisible, useStartCardVisible } from './useFirstRun';

const LABELS: Record<ChecklistItem, string> = {
  node: uiText("Criar um nó"),
  ai: uiText("Gerar com IA"),
  version: uiText("Salvar uma versão"),
  publish: uiText("Publicar no GitHub"),
};

const RUN: Record<ChecklistItem, () => void> = {
  node: () => {},
  ai: () => {
    const ai = aiStore.getState();
    ai.setMode('generate');
    ai.setOpen(true);
  },
  version: openSaveVersion,
  publish: openGithub,
};

/**
 * "Primeiros passos" in the sidebar footer: small, collapsible, progress kept in localStorage. It waits while the
 * first-run note is over the sample or an empty diagram shows its start card: one onboarding surface at a time.
 */
export function Checklist() {
  const [state, setState] = useState<ChecklistState>(readChecklist);
  const hasNodes = useDiagram((s) => s.model.order.length > 0 && !isPristineSample(s.model));
  const hasVersions = useVersions((s) => s.entries.length > 0);
  const firstRun = useFirstRunVisible();
  const emptyDiagram = useStartCardVisible();
  if (onboardingSurface({ firstRun, emptyDiagram, checklist: state }) !== 'checklist') return null;
  const update = (next: ChecklistState) => {
    setState(next);
    writeChecklist(next);
  };
  const { done, total } = checklistProgress(state, { node: hasNodes, version: hasVersions });
  return (
    <m.section aria-label={uiText("Primeiros passos")} className="mx-2 mb-2 shrink-0 rounded-[12px] bg-panel-2 px-2 py-1.5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={FADE}>
      <div className="flex items-center gap-1 pl-1.5">
        <span className="flex-1 whitespace-nowrap text-caption font-medium text-muted">{uiText("Começando ·")} {done.length}/{total}</span>
        <IconButton label={uiText("Fazer o tour")} className="h-6 min-w-6 px-1.5 text-caption" onClick={startTour}>Tour</IconButton>
        <IconButton label={state.collapsed ? uiText("Expandir primeiros passos") : uiText("Recolher primeiros passos")} className="h-6 min-w-6 px-1" onClick={() => update({ ...state, collapsed: !state.collapsed })}>
          {state.collapsed ? <ChevronUp /> : <ChevronDown />}
        </IconButton>
        <IconButton label={uiText("Ocultar primeiros passos")} className="h-6 min-w-6 px-1" onClick={() => update({ ...state, hidden: true })}>
          <X />
        </IconButton>
      </div>
      <div className="mx-1.5 mt-1 h-0.5 overflow-hidden rounded-full bg-line-strong" aria-hidden>
        <div className="h-full rounded-full bg-accent transition-[width] duration-(--sk-motion)" style={{ width: `${(done.length / total) * 100}%` }} />
      </div>
      {!state.collapsed && (
        <ul className="mt-1 flex flex-col">
          {CHECKLIST_ITEMS.map((item) => {
            const checked = done.includes(item);
            return (
              <li key={item}>
                <button
                  type="button"
                  aria-pressed={checked}
                  className="flex h-7 w-full items-center gap-2 rounded-control pl-1.5 text-left text-caption text-muted transition-colors hover:bg-panel-3/60 hover:text-ink"
                  onClick={() => {
                    RUN[item]();
                    if (!checked) update({ ...state, done: { ...state.done, [item]: true } });
                  }}
                >
                  <span className={`flex h-4 w-4 flex-none items-center justify-center rounded-full border ${checked ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong'}`}>
                    {checked && <Check size={10} />}
                  </span>
                  <span className={checked ? 'text-faint line-through' : ''}>{LABELS[item]}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </m.section>
  );
}
