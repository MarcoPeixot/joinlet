import { uiText } from '../i18n';
import { Sparkles, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { removeAll } from '../actions/elements';
import { IconButton } from '../ui/IconButton';
import { Button } from '../ui/Button';
import { diagramStore } from '../state/appStore';
import { showToast } from '../ui/uiStore';
import { createItem } from '../workspace/actions';
import { useWorkspace } from '../workspace/appWorkspace';
import { SAMPLE_SLUG, isPristineSample } from './firstRun';
import { dismissFirstRun, useFirstRunVisible } from './useFirstRun';

/**
 * Shown once, over the sample diagram, so a first visit knows it is an editable example. While it is up the
 * sidebar's "Primeiros passos" waits (one onboarding surface at a time, see surface.ts).
 */
export function FirstRunChip() {
  const slug = useWorkspace((s) => (s.view.kind === 'diagram' ? s.diagram : null));
  const show = useFirstRunVisible();
  const wasShown = useRef(false);
  // The first edit of the sample retires the chip for good.
  useEffect(() => {
    if (show) wasShown.current = true;
    else if (wasShown.current && slug === SAMPLE_SLUG) {
      wasShown.current = false;
      dismissFirstRun();
    }
  }, [show, slug]);
  if (!show) return null;
  const done = (then?: () => void) => () => {
    dismissFirstRun();
    then?.();
  };
  const clear = () => {
    if (!isPristineSample(diagramStore.getState().model)) return showToast(uiText("O exemplo foi alterado — nada foi removido."));
    removeAll();
  };
  return (
    <div
      role="status"
      aria-label={uiText("Primeiro acesso")}
      className="sk-float pointer-events-auto absolute left-1/2 top-[calc(var(--sk-chrome-bottom,var(--sk-header-height))+12px)] z-20 max-sm:top-[calc(var(--sk-header-height)+72px)] flex w-max max-w-[calc(100%-136px)] max-sm:max-w-[calc(100%-24px)] sm:max-w-[calc(100%-9rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-0.5 gap-y-1 rounded-panel py-1 pl-3 pr-1 text-caption"
    >
      <Sparkles size={13} className="mr-1 text-accent max-sm:hidden" aria-hidden />
      {/* Short enough on a phone to keep the note on one line. */}
      <span className="mr-1 text-muted"><span className="max-sm:hidden">{uiText("Este é um exemplo editável.")}</span><span className="sm:hidden">{uiText("Exemplo editável.")}</span></span>
      <Button size="sm" variant="ghost" onClick={done(clear)}>{uiText("Limpar")}</Button>
      <Button size="sm" variant="ghost" onClick={done(() => void createItem('diagram', uiText("Meu diagrama")))}>{uiText("Começar do zero")}</Button>
      <IconButton label={uiText("Dispensar aviso")} className="h-7 min-w-7" onClick={done()}>
        <X />
      </IconButton>
    </div>
  );
}
