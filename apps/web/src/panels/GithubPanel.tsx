import { RepositoryConnection } from './RepositoryConnection';
import { isBrowserGuest } from '../settings/publicAccess';
import { GuestCloudPrompt } from '../auth/GuestCloudPrompt';
import {collaborationSession} from '../workspace/boot';
import { uiText } from '../i18n';
import { Check, GitBranch, GitCompareArrows, GitPullRequest, LoaderCircle, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { renderMarkdown, useMarkdownReady } from '../docs/markdown';
import { closeGithub, useGithub } from '../github/session';
import { GithubConnection } from './GithubConnection';
import { Button } from '../ui/Button';
import { Field, inputClass } from '../ui/controls';
import { IconButton } from '../ui/IconButton';
import { PanelHeader, SidePanel } from '../ui/Panel';
import { pluralize } from '../ui/plural';
import { connectRepository } from '../workspace/boot';
import { useWorkspace, workspace } from '../workspace/appWorkspace';
import { showToast } from '../ui/uiStore';
import { branchCompareStore } from '../github/compare';

const sectionLabel = 'text-meta font-medium uppercase tracking-wide text-muted';
const card = 'flex flex-col gap-3 rounded-panel border border-line bg-panel p-3';

const CHANGE_LABEL: Record<string, string> = { M: uiText("alterado"), A: uiText("novo"), D: uiText("removido"), '??': uiText("novo"), R: uiText("renomeado") };
const CHANGE_COLOR: Record<string, string> = {
  M: 'var(--sk-diff-changed)',
  A: 'var(--sk-diff-added)',
  '??': 'var(--sk-diff-added)',
  R: 'var(--sk-diff-changed)',
  D: 'var(--sk-diff-removed)',
};

function ChangeChip({ status }: { status: string }) {
  const color = CHANGE_COLOR[status] ?? 'var(--sk-muted)';
  return (
    <span
      title={CHANGE_LABEL[status] ?? status}
      className="inline-flex h-5 w-9 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-semibold"
      style={{ color, borderColor: color }}
    >
      {status === '??' ? 'A' : status}
    </span>
  );
}

function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'muted'; children: React.ReactNode }) {
  const color = tone === 'ok' ? 'var(--sk-diff-added)' : tone === 'warn' ? 'var(--sk-diff-changed)' : 'var(--sk-muted)';
  return (
    <span className="inline-flex h-5 items-center rounded-full border px-2 text-[11px]" style={{ color, borderColor: color }}>
      {children}
    </span>
  );
}

/** The GitHub panel: what changed in `.arch/`, the semantic diff and the publish (branch + PR) flow. */
export function GithubPanel() {
  const source = useWorkspace((s) => s.source);
  const disconnectRemote = async () => {
    try {
      await workspace.flush();
      const session = await (await fetch('/api/remote/session')).json() as { csrf: string };
      const response = await fetch('/api/remote/disconnect', { method: 'POST', headers: { 'content-type': 'application/json', 'x-strukt-csrf': session.csrf }, body: '{}' });
      if (!response.ok) throw new Error(uiText("Não foi possível desconectar o Joinlet remoto."));
      window.location.reload();
    } catch (error) { showToast(error instanceof Error ? error.message : uiText("Não foi possível desconectar.")); }
  };
  if (isBrowserGuest()) return <SidePanel label="GitHub"><PanelHeader icon={<GitBranch size={14}/>} title={uiText('Repositório e sincronização')} onClose={closeGithub}/><div className="p-3"><GuestCloudPrompt /></div></SidePanel>;
  if (collaborationSession()?.mode === 'cloud') return <SidePanel label="GitHub"><PanelHeader icon={<GitBranch size={14}/>} title={uiText('Repositório e sincronização')} onClose={closeGithub}/><div className="overflow-y-auto p-3"><RepositoryConnection cloud/></div></SidePanel>;
  return source?.label.startsWith('GitHub: ') ? (
    <SidePanel label={"GitHub"}>
      <PanelHeader icon={<GitPullRequest size={14} />} title={"GitHub"} onClose={closeGithub} />
      <section className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4 text-body">
        <p className="font-medium">{source.label}</p>
        <p className="text-muted">{uiText("O editor e os agentes usam o mesmo workspace autorizado. As alterações em")} <code>{".arch/"}</code> {uiText("são salvas em uma branch do Joinlet e enviadas para revisão em um pull request.")}</p>
        <RemotePullRequest repo={source.label.slice('GitHub: '.length)} />
        <Button variant="secondary" onClick={() => void disconnectRemote()}>{uiText("Desconectar")}</Button>
      </section>
    </SidePanel>
  ) : <GithubPanelBody />;
}

function RemotePullRequest({ repo }: { repo: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void fetch(`/api/remote/pr?repo=${encodeURIComponent(repo)}`)
      .then((response) => response.ok ? response.json() as Promise<{ url: string | null }> : null)
      .then((result) => { if (active) setUrl(result?.url ?? null); })
      .catch(() => {});
    return () => { active = false; };
  }, [repo]);
  return url ? <a className="text-accent hover:underline" href={url} target="_blank" rel="noopener noreferrer">{uiText("Abrir pull request no GitHub")}</a> : null;
}

/** The two steps of the panel: sign in, then choose the folder. */
function Stepper({ authConnected, repoReady }: { authConnected: boolean; repoReady: boolean }) {
  const steps = [
    { label: uiText("1. Conta GitHub (opcional para uso local)"), done: authConnected },
    { label: uiText("2. Pasta do repositório"), done: repoReady },
  ];
  const current = steps.findIndex((step) => !step.done);
  return (
    <ol aria-label={uiText("Etapas")} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption">
      {steps.map((step, index) => (
        <li key={step.label} aria-current={index === current ? 'step' : undefined} className={`flex items-center gap-1 ${step.done ? 'text-(--sk-diff-added)' : index === current ? 'font-medium text-ink' : 'text-muted'}`}>
          {step.done && <Check size={12} aria-hidden />}
          {step.label}
          {index === 0 && <span aria-hidden className="ml-1 text-faint">{"·"}</span>}
        </li>
      ))}
    </ol>
  );
}

function GithubPanelBody() {
  const diagramSlug = useWorkspace((s) => s.diagram);
  const repoPath = useGithub((s) => s.repoPath);
  const status = useGithub((s) => s.status);
  const error = useGithub((s) => s.error);
  const repo = useGithub((s) => s.repo);
  const changes = useGithub((s) => s.changes);
  const diff = useGithub((s) => s.diff);
  const diffStatus = useGithub((s) => s.diffStatus);
  const title = useGithub((s) => s.title);
  const body = useGithub((s) => s.body);
  const draft = useGithub((s) => s.draft);
  const branch = useGithub((s) => s.branch);
  const publishing = useGithub((s) => s.publishing);
  const publishedUrl = useGithub((s) => s.publishedUrl);
  const publishError = useGithub((s) => s.publishError);
  const prText = useGithub((s) => s.prText);
  const prStatus = useGithub((s) => s.prStatus);
  const [path, setPath] = useState(repoPath);
  const [showDiff, setShowDiff] = useState(false);
  const [compareRef, setCompareRef] = useState('');
  const [authConnected, setAuthConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
  const ready = useMarkdownReady();
  const html = useMemo(() => (diff ? renderMarkdown(diff) : ''), [diff, ready]);
  const store = useGithub((s) => s);
  const connectBlock = !path.trim() ? uiText("Informe o caminho da pasta") : null;
  const canPublish = authConnected && Boolean(repo?.ghReady) && changes.length > 0 && title.trim().length > 0 && !publishing;
  const publishBlock = !authConnected ? uiText("Entre com o GitHub primeiro") : null;
  const connect = async () => {
    setConnecting(true);
    setSetupMessage(null);
    try {
      const setup = await connectRepository(path.trim());
      setSetupMessage(uiText("{0}MCP pronto para agentes. {1} de configuração criado{2}.{3}", [setup.initialized ? uiText("Workspace copiado para .arch/. ") : '', pluralize(setup.changed.length, uiText("arquivo"), uiText("arquivos")), setup.changed.length === 1 ? '' : 's', setup.conflicts.length ? uiText(" Confira os existentes: {0}.", [setup.conflicts.join(', ')]) : '']));
    } catch (cause) {
      setSetupMessage(cause instanceof Error ? cause.message : uiText("Não foi possível conectar o repositório."));
    } finally { setConnecting(false); }
  };

  return (
    <SidePanel label={"GitHub"}>
      <PanelHeader
        icon={<GitPullRequest size={14} />}
        title={"GitHub"}
        onClose={closeGithub}
        actions={(
          <IconButton label={uiText("Atualizar")} disabled={!repoPath || status === 'loading'} onClick={() => void store.refresh()}>
            <RefreshCw className={status === 'loading' ? 'animate-spin' : ''} />
          </IconButton>
        )}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-body">
        <RepositoryConnection />
        <Stepper authConnected={authConnected} repoReady={Boolean(repo)} />
        <GithubConnection onAuthChange={setAuthConnected} />

        <section className={card}>
          <div>
            <h2 className="text-title font-semibold">{uiText("2. Pasta do repositório")}</h2>
            <p className="mt-1 text-caption leading-relaxed text-muted">{uiText("Escolha o repositório local cujo")} <code>{".arch/"}</code> {uiText("você quer revisar e publicar.")}</p>
          </div>
          <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void connect(); }}>
            <Field label={uiText("Caminho absoluto no computador")}>
              <input
                className={`${inputClass} h-9 font-mono text-caption`}
                value={path}
                spellCheck={false}
                placeholder={uiText('/caminho/do/repositório')}
                onChange={(event) => setPath(event.target.value)}
              />
            </Field>
            <Button type="submit" variant="primary" disabled={Boolean(connectBlock) || connecting} aria-describedby={connectBlock ? 'connect-reason' : undefined} icon={connecting ? <LoaderCircle size={14} className="animate-spin" /> : undefined}>
              {connecting ? uiText("Conectando…") : uiText("Conectar repositório")}
            </Button>
            {connectBlock && <p id="connect-reason" className="text-caption text-muted">{connectBlock}</p>}
          </form>
          {setupMessage && <p role="status" className="text-caption text-muted">{setupMessage}</p>}
          <p className="text-caption leading-relaxed text-muted">{uiText("Funciona em Safari, Firefox e Brave, sem login no GitHub: informe a pasta local uma vez. Se faltar")} <code>{".arch/"}</code>{uiText(", o Joinlet oferece copiar o workspace atual. Editor e agentes passam a usar esses arquivos.")}</p>
        </section>

        {error && <p role="alert" className="rounded-control border border-danger/25 bg-danger-soft px-3 py-2 text-caption text-danger">{error}</p>}

        {repo && (
          <section className={card}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{repo.nameWithOwner ?? uiText("sem remoto no GitHub")}</span>
              <Pill tone="muted">
                <GitBranch size={11} className="mr-1" />
                {repo.branch}
              </Pill>
              {repo.ghReady ? <Pill tone="ok">{uiText("GitHub autenticado")}</Pill> : <Pill tone="warn">{uiText("Sem autenticação")}</Pill>}
              <code className="ml-auto max-w-[45%] truncate text-[11px] text-muted" title={repo.root}>
                {repo.root}
              </code>
            </div>
            {!repo.ghReady && <p className="text-caption text-muted">{uiText("Entre com a conta GitHub acima para habilitar a publicação.")}</p>}
            {diagramSlug && <div className="flex flex-col gap-2 border-t border-line pt-3">
              <Field label={uiText("Ref para comparar")}>
                <input aria-label={uiText("Ref para comparar")} className={`${inputClass} h-9 font-mono text-caption`} value={compareRef} placeholder={repo.defaultBase ?? 'HEAD'} onChange={(event) => setCompareRef(event.target.value)} />
              </Field>
              <Button variant="secondary" icon={<GitCompareArrows size={14} />} onClick={() => void branchCompareStore.getState().start(repo.root, diagramSlug, compareRef.trim() || repo.defaultBase || 'HEAD').then((ok) => { if (ok) closeGithub(); else showToast(branchCompareStore.getState().error ?? uiText("Não foi possível comparar.")); })}>{uiText("Comparar no canvas")}</Button>
            </div>}
          </section>
        )}

        {repo && (
          <section className={card}>
            <div className="flex items-center gap-2">
              <span className={sectionLabel}>{uiText("Mudanças da arquitetura e MCP")}</span>
              <span className="text-[12px] text-muted">{pluralize(changes.length, uiText("arquivo"), uiText("arquivos"))}</span>
              {changes.length > 0 && (
                <button
                  type="button"
                  className="ml-auto text-[12px] font-medium text-accent hover:underline"
                  onClick={() => {
                    setShowDiff(!showDiff);
                    if (!showDiff && diffStatus === 'idle') void store.loadDiff();
                  }}
                >
                  {showDiff ? uiText("Ocultar diff") : uiText("Ver diff semântico")}
                </button>
              )}
            </div>
            {changes.length === 0 ? (
              <p className="text-[12px] text-muted">{uiText("Sem mudanças pendentes. Peça ao agente para criar ou editar um diagrama e atualize aqui.")}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {changes.map((change) => (
                  <li key={change.path} className="flex items-center gap-2">
                    <ChangeChip status={change.status} />
                    <code className="min-w-0 flex-1 truncate text-[12px]">{change.path}</code>
                  </li>
                ))}
              </ul>
            )}
            {showDiff && (
              <div className="max-h-72 overflow-y-auto rounded-control border border-line bg-panel px-4 py-3">
                {diffStatus === 'loading' && <p className="text-[12px] text-muted">{uiText("Calculando o diff…")}</p>}
                {diffStatus === 'error' && <p className="text-[12px] text-danger">{uiText("Não foi possível calcular o diff.")}</p>}
                {diffStatus === 'ready' && <article className="sk-markdown" dangerouslySetInnerHTML={{ __html: html }} />}
              </div>
            )}
          </section>
        )}

        {repo && changes.length > 0 && (
          <section className={card}>
            <span className={sectionLabel}>{uiText("Publicar PR")}</span>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] text-muted">{uiText("Título")}</span>
              <input className={`${inputClass} h-8`} value={title} onChange={(event) => store.setTitle(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] text-muted">{uiText("Descrição (opcional)")}</span>
              <textarea
                className={`${inputClass} min-h-16 resize-y py-1.5`}
                value={body}
                placeholder={uiText("O que mudou na arquitetura e por quê.")}
                onChange={(event) => store.setBody(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="text-[12px] text-muted">{uiText("Branch (opcional)")}</span>
                <input
                  className={`${inputClass} h-8 font-mono text-[12px]`}
                  value={branch}
                  spellCheck={false}
                  placeholder="strukt/<título>-<data>"
                  onChange={(event) => store.setBranch(event.target.value)}
                />
              </label>
              <label className="flex h-8 items-center gap-2 text-[12px]">
                <input type="checkbox" checked={draft} onChange={(event) => store.setDraft(event.target.checked)} />{uiText("Rascunho")}</label>
              <button
                type="button"
                disabled={!canPublish}
                aria-describedby={publishBlock ? 'publish-reason' : undefined}
                className="h-8 rounded-control bg-accent-strong px-3 font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
                onClick={() => void store.publish()}
              >
                {publishing ? uiText("Publicando…") : uiText("Publicar PR")}
              </button>
            </div>
            {publishBlock && <p id="publish-reason" className="text-caption text-muted">{publishBlock}</p>}
            <p className="text-caption leading-relaxed text-muted">{uiText("Cria a branch, commita")} <code>{".arch/"}</code> {uiText("e as configurações MCP do projeto (nunca com force) e abre o PR com o diff semântico no corpo. O título vira o assunto do commit.")}</p>
            {publishError && <p role="alert" className="text-caption text-danger">{publishError}</p>}
            {publishedUrl && (
              <p className="flex items-center gap-2 text-caption">
                <Pill tone="ok">{uiText("PR aberto")}</Pill>
                <a className="min-w-0 flex-1 truncate text-accent hover:underline" href={publishedUrl} target="_blank" rel="noopener noreferrer">
                  {publishedUrl}
                </a>
              </p>
            )}
          </section>
        )}

        {repo && (
          <section className={card}>
            <div className="flex items-center gap-2">
              <span className={sectionLabel}>Pull request</span>
              <button
                type="button"
                disabled={!authConnected || !repo.ghReady || prStatus === 'loading'}
                className="ml-auto inline-flex items-center gap-1 text-caption font-medium text-accent hover:underline disabled:opacity-45 disabled:hover:no-underline"
                onClick={() => void store.loadPr()}
              >
                <GitPullRequest size={13} />
                {prStatus === 'loading' ? uiText("Consultando…") : uiText("Ver status do PR")}
              </button>
            </div>
        {prText && <pre className="overflow-x-auto whitespace-pre-wrap rounded-control border border-line bg-panel p-3 font-mono text-caption">{prText}</pre>}
          </section>
        )}
      </div>
    </SidePanel>
  );
}
