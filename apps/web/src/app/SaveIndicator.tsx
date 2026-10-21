import { uiText } from '../i18n';
import { useWorkspace } from '../workspace/appWorkspace';
import { retrySave } from '../workspace/boot';

const dot = 'h-1.5 w-1.5 flex-none rounded-full';

/**
 * Autosave state (spec §11): a dot while saved or saving, "Não salvo" with a retry when writes keep failing, and a
 * permanent warning when the browser blocked storage (memory workspace: nothing of this tab is saved).
 */
export function SaveIndicator() {
  const save = useWorkspace((s) => s.save);
  const error = useWorkspace((s) => s.saveError);
  const memory = useWorkspace((s) => s.source?.kind === 'memory');
  if (memory) {
    return (
      <span
        className="flex items-center gap-1.5 px-1 text-caption text-danger"
        role="status" aria-live="polite"
        title={uiText("O navegador bloqueou o armazenamento local: nada desta aba é salvo. Exporte um .zip para guardar o trabalho.")}
      >
        <span className={`${dot} bg-danger`} />{uiText("Não salvo · só nesta aba")}</span>
    );
  }
  if (save === 'error') {
    return (
      <span className="flex items-center gap-2 px-1 text-caption text-danger" title={error ?? undefined} role="status" aria-live="polite">
        <span className={`${dot} bg-danger`} />{uiText("Não salvo")}<button type="button" className="rounded-chip border border-line-strong px-2 py-0.5 text-ink hover:bg-panel-2" onClick={() => void retrySave()}>{uiText("Tentar de novo")}</button>
      </span>
    );
  }
  // The normal case stays a quiet dot (the words are for assistive tech and the tooltip); only trouble gets text.
  const text = save === 'saved' ? uiText("Salvo") : uiText("Salvando…");
  return (
    <span className="flex h-8 items-center px-1.5" role="status" aria-live="polite" title={save === 'saved' ? uiText("Salvo: todas as mudanças estão guardadas") : text}>
      <span className={`${dot} ${save === 'saved' ? 'bg-(--sk-diff-added) opacity-70' : 'animate-pulse bg-(--sk-diff-changed)'}`} />
      <span className="sr-only">{text}</span>
    </span>
  );
}
