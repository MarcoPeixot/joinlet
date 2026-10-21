import { uiText } from '../i18n';
import { RefreshCw, X } from 'lucide-react';
import { openGithub } from '../github/session';
import { reloadWorkspace, useWorkspace, workspace } from '../workspace/appWorkspace';

const plural = (n: number) => uiText("{0} arquivo{1}", [n, n === 1 ? '' : 's']);

/**
 * Shown when the open folder changed on disk outside the app (an agent, a checkout, another editor).
 * Reloading drops pending writes — the disk version wins — so it asks first when something is unsaved.
 */
export function ExternalChangesBanner() {
  const external = useWorkspace((s) => s.external);
  if (!external) return null;
  return (
    <div role="status" className="sk-float absolute bottom-[68px] left-1/2 z-30 flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-lg px-3 py-2 text-caption">
      <RefreshCw size={14} className="shrink-0 text-accent" />
      <span className="min-w-0 truncate">{uiText("O")} <code>{".arch/"}</code> {uiText("mudou no disco (")}{plural(external.files.length)}{uiText(") — um agente ou outra ferramenta escreveu.")}</span>
      <button type="button" className="ml-auto shrink-0 font-medium text-accent hover:underline" onClick={() => void reloadWorkspace()}>{uiText("Recarregar")}</button>
      <button type="button" className="shrink-0 text-muted hover:text-ink" onClick={openGithub}>{uiText("Ver no GitHub")}</button>
      <button type="button" aria-label={uiText("Ignorar mudanças no disco")} className="shrink-0 text-muted hover:text-ink" onClick={() => workspace.dismissExternal()}>
        <X size={14} />
      </button>
    </div>
  );
}
