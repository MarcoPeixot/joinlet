import { uiText } from '../i18n';
import { BadgeAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { requestGitHealth } from '../github/client';
import type { ArchitectureIssue } from '../github/client';
import { openGithub, useGithub } from '../github/session';
import { EmptyState } from '../ui/EmptyState';
import { diagramStore } from '../state/appStore';
import { PanelHeader, PanelSection, SidePanel } from '../ui/Panel';
import { closeRightPanel, requestFit, showToast } from '../ui/uiStore';
import { useWorkspace, workspace } from '../workspace/appWorkspace';
import { pluralize } from '../ui/plural';
import { own } from '@strukt/core';
import { integrationsApi, safeLink } from '../integrations/client';
import type { Concern } from '@strukt/workspace';

export function AccuracyPanel() {
  const data = useWorkspace((state) => state.data);
  const repo = useGithub((state) => state.repo);
  const concerns = data?.concerns?.filter((item) => item.status === 'open') ?? [];
  const [evidence, setEvidence] = useState<ArchitectureIssue[]>([]);
  const [health, setHealth] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const connected = repo && workspace.storage()?.label === repo.archDir;

  useEffect(() => {
    if (!connected) return;
    let active = true;
    setHealth('loading');
    void requestGitHealth(repo.root).then((result) => {
      if (!active) return;
      if (result.kind === 'ok') { setEvidence(result.evidence); setHealth('ready'); setError(null); }
      else { setHealth('error'); setError(result.kind === 'offline' ? result.reason : result.message); }
    });
    return () => { active = false; };
  }, [connected, repo]);

  /** One Jira task per concern; the link is kept on the concern (`issue`), so it is not created twice. */
  const createTask = async (item: Concern) => {
    setCreating(item.id);
    const title = workspace.store.getState().data?.manifest.diagrams.find((diagram) => diagram.slug === item.diagram)?.title;
    const res = await integrationsApi.jira({ id: item.id, diagram: item.diagram, ...(item.element ? { element: item.element } : {}), message: item.message }, title);
    setCreating(null);
    if (!res.ok) { showToast(res.error); return; }
    const issue = { key: res.value.key, url: res.value.url };
    workspace.setConcerns((workspace.store.getState().data?.concerns ?? []).map((entry) => entry.id === item.id ? { ...entry, issue } : entry));
    showToast(uiText("Tarefa {0} criada no Jira.", [issue.key]));
  };

  const openItem = async (diagram: string, element?: string) => {
    if (!data || own(data.diagrams, diagram) === undefined) { showToast(uiText("Diagrama não encontrado.")); return; }
    try {
      await workspace.openDiagram(diagram);
      if (element?.startsWith('edge:')) diagramStore.getState().select({ nodes: [], edges: [element.slice(5)] });
      else if (element) diagramStore.getState().select({ nodes: [element], edges: [] });
      closeRightPanel('accuracy');
      requestFit();
    } catch (cause) { showToast(cause instanceof Error ? cause.message : String(cause)); }
  };

  return <SidePanel label={uiText("Precisão da arquitetura")}>
    <PanelHeader icon={<BadgeAlert size={14} />} title={uiText("Precisão")} subtitle={concerns.length === 0 ? uiText("Nenhuma pendência aberta") : `${pluralize(concerns.length, uiText("pendência"), uiText("pendências"), 'f')} ${concerns.length === 1 ? uiText("aberta") : uiText("abertas")}`} onClose={() => closeRightPanel('accuracy')} />
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PanelSection title={uiText("Apontamentos da equipe")}>
        {concerns.map((item) => <div key={item.id} className="rounded-control border border-line p-2">
          <button type="button" className="w-full text-left text-caption font-medium hover:text-accent" onClick={() => void openItem(item.diagram, item.element)}>{data?.manifest.diagrams.find((diagram) => diagram.slug === item.diagram)?.title ?? item.diagram}{item.element ? ` › ${item.element}` : ''}</button>
          <p className="mt-1 text-body">{item.message}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
          {item.issue
            ? <a className="text-caption text-accent hover:underline" href={safeLink(item.issue.url) ?? undefined} target="_blank" rel="noopener noreferrer">{"Jira:"} {item.issue.key}</a>
            : <button type="button" className="text-caption text-accent hover:underline disabled:opacity-50" disabled={creating === item.id} onClick={() => void createTask(item)}>{creating === item.id ? uiText("Criando tarefa…") : uiText("Criar tarefa no Jira")}</button>}
          <button type="button" className="text-caption text-accent hover:underline" onClick={() => workspace.setConcerns((data?.concerns ?? []).map((entry) => entry.id === item.id ? { ...entry, status: 'resolved' } : entry))}>{uiText("Marcar como resolvido")}</button>
          </div>
        </div>)}
        {concerns.length === 0 && (
          <EmptyState
            illustration="accuracy"
            title={uiText("Nenhum apontamento aberto")}
            text={uiText("Se algo no desenho estiver incorreto, selecione o componente e registre uma pendência.")}
            action={connected ? undefined : { label: uiText("Conectar repositório"), onClick: openGithub }}
          />
        )}
      </PanelSection>
      <PanelSection title={uiText("Evidências no repositório")}>
        {!connected && <p className="text-caption text-muted">{uiText("Conectar o repositório permite verificar arquivos e linhas ligados ao desenho.")}</p>}
        {connected && health === 'loading' && <p className="text-caption text-muted">{uiText("Verificando referências…")}</p>}
        {connected && health === 'error' && <p role="alert" className="text-caption text-danger">{error}</p>}
        {connected && health === 'ready' && evidence.length === 0 && <p className="text-caption text-muted">{uiText("Nenhuma referência quebrada.")}</p>}
        {evidence.map((item, index) => <button key={`${index}:${item.diagram}:${item.id}`} type="button" className="w-full rounded-control border border-line p-2 text-left text-caption hover:border-line-strong" onClick={() => void openItem(item.diagram, item.id)}>
          <strong>{item.diagram} › {item.id}</strong><span className="mt-1 block text-muted">{item.path || uiText("Referência sem componente")} {"·"} {item.message}</span>
        </button>)}
      </PanelSection>
    </div>
  </SidePanel>;
}
