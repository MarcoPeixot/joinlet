import { GuestCloudPrompt } from '../auth/GuestCloudPrompt';
import { useAccessPlan } from '../settings/accessPlan';
import { isBrowserGuest, isBrowserPreview } from '../settings/publicAccess';
import { getLocale, systemMessage, uiText } from '../i18n';
import { ArrowLeft, ArrowUpRight, Check, Cloud, FolderOpen, GitPullRequest, HardDrive, LoaderCircle, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { trackAnalytics } from '../analytics/client';
import { Button } from '../ui/Button';
import { inputClass } from '../ui/controls';
import { Logo } from '../ui/Logo';
import { Modal } from '../ui/Modal';
import { Toast } from '../ui/Toast';
import { showToast } from '../ui/uiStore';
import { openGithub } from '../github/session';
import { workspace } from './appWorkspace';
import { createBrowserWorkspace, openFolderPicker, openRegisteredWorkspace, connectRepository } from './boot';
import { catalogStore, locationLabel, showCreateWorkspace, useCatalog } from './catalog';

export function CreateWorkspaceDialog() {
  const cloud = useCatalog(state=>state.cloud);
  const { accountPlan: plan } = useAccessPlan();
  const open = useCatalog((state) => state.creating);
  const count = useCatalog(state => state.catalog?.entries.length ?? 0);
  const full = plan.limits.workspaces !== null && count >= plan.limits.workspaces;
  const previewFull = isBrowserPreview() && full;
  const guestFull = isBrowserGuest() && full;
  useEffect(() => { if (open && previewFull) trackAnalytics('workspace_limit_viewed'); }, [open, previewFull]);
  const busy = useCatalog((state) => state.busy);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const close = () => { if (!busy) { catalogStore.setState({ creating: false }); setName(''); setError(null); } };
  return (
    <Modal open={open} onClose={close} label={previewFull ? uiText("Um workspace por enquanto") : uiText("Novo workspace")} width={440} icon={<Plus size={17} />} closeLabel={busy ? null : uiText("Fechar")}>
      {guestFull ? <div className="p-5"><GuestCloudPrompt /><Button variant="ghost" onClick={close}>{uiText('Continuar no meu workspace')}</Button></div> : previewFull ? <div className="flex flex-col gap-5 p-5">
        <p className="text-body leading-relaxed text-muted">{uiText("Seu primeiro workspace está liberado sem conta e fica salvo neste navegador.")}</p>
        <p className="text-body leading-relaxed text-muted">{uiText("Login, cadastro e novos workspaces estão pausados. Continue editando e exportando seu workspace.")}</p>
        <Button variant="primary" onClick={close}>{uiText("Continuar no meu workspace")}</Button>
      </div> : <form className="flex flex-col gap-5 p-5" onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        void createBrowserWorkspace(name).then(() => { setName(''); setError(null); }, (cause) => setError(systemMessage(cause instanceof Error ? cause.message : String(cause))));
      }}>
        <p className="text-body leading-relaxed text-muted">{uiText("Um workspace reúne a arquitetura de um projeto. Diagramas, documentos e versões ficam juntos.")}</p>
        <div className="flex flex-col gap-2">
          {full && <p role="status" className="rounded-xl bg-accent-soft p-3 text-body">{uiText("O Joinlet Beta permite {0} workspace próprio. Abra seu workspace existente.", [plan.limits.workspaces ?? '∞'])}</p>}
          <label htmlFor="workspace-name" className="text-body font-medium">{uiText("Nome do workspace")}</label>
          <input id="workspace-name" autoFocus className={`${inputClass} h-10`} placeholder={uiText("Ex.: NORA")} value={name} disabled={busy}
            onChange={(event) => setName(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? 'workspace-create-error' : undefined} />
          {error && <p id="workspace-create-error" role="alert" className="text-caption text-danger">{error}</p>}
        </div>
        <div className="flex items-start gap-2 rounded-control border border-line bg-panel-2/40 p-3 text-caption text-muted">
          {cloud?<Cloud size={15} className="mt-0.5 shrink-0"/>:<HardDrive size={15} className="mt-0.5 shrink-0" />}
          <p>{cloud?uiText('Salvo no Joinlet Cloud. Você pode conectar uma pasta ou repositório depois.'):uiText("Salvo neste navegador. Você pode conectar uma pasta ou repositório depois.")}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={close} disabled={busy}>{uiText("Cancelar")}</Button>
          <Button type="submit" variant="primary" disabled={busy || full || !name.trim()} icon={busy ? <LoaderCircle size={15} className="animate-spin" /> : <Plus size={15} />}>{uiText("Criar workspace")}</Button>
        </div>
      </form>}
    </Modal>
  );
}

export function ProjectsView() {
  const cloud = useCatalog(state=>state.cloud);
  const { accountPlan: plan } = useAccessPlan();
  const catalog = useCatalog((state) => state.catalog);
  const activeId = useCatalog((state) => state.activeId);
  const busy = useCatalog((state) => state.busy);
  const error = useCatalog((state) => state.error);
  const available = useCatalog((state) => state.available);
  const [query, setQuery] = useState('');
  const repoOpen = useCatalog((state) => state.repositoryOpen);
  const setRepoOpen = (repositoryOpen: boolean) => catalogStore.setState({ repositoryOpen });
  const [repoPath, setRepoPath] = useState('');
  const entries = [...(catalog?.entries ?? [])].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  const filtered = entries.filter((entry) => entry.name.toLocaleLowerCase(getLocale()).includes(query.toLocaleLowerCase(getLocale())));
  const current = workspace.store.getState().data?.manifest.name;
  const report = (cause: unknown) => catalogStore.setState({ error: systemMessage(cause instanceof Error ? cause.message : String(cause)) });
  return (
    <div className="flex h-full min-w-0 flex-col bg-bg">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-5 sm:px-8">
        <Logo size={26} />
        <span className="text-title font-semibold">{"Joinlet"}</span>{current && <Button className="ml-auto max-w-[65%]" disabled={busy} icon={<ArrowLeft size={15} />} onClick={() => catalogStore.setState({ open: false })}>{uiText("Voltar ao workspace")}</Button>}</header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-7 overflow-y-auto px-5 py-8 sm:px-8 sm:py-12" aria-busy={busy}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{uiText("Meus projetos")}</h1>
            <p className="mt-2 text-body text-muted">{uiText("Uma arquitetura por workspace. Abra um projeto ou comece outro.")}</p>
          </div>
          <Button variant="primary" disabled={busy || !available || (!isBrowserPreview() && !isBrowserGuest() && plan.limits.workspaces !== null && entries.length >= plan.limits.workspaces)} icon={<Plus size={16} />} onClick={showCreateWorkspace}>{uiText("Novo workspace")}</Button>
        </div>
        <p className="text-caption text-muted">{plan.name} · {plan.limits.workspaces === null ? uiText('Sem limite') : uiText('{0} de {1} workspace próprio', [entries.length, plan.limits.workspaces])}. {uiText('Participar de workspaces compartilhados não consome essa cota.')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-auto sm:min-w-0 sm:flex-1 sm:max-w-sm">
            <Search size={16} className="pointer-events-none absolute left-3 top-3 text-faint" />
            <input aria-label={uiText("Buscar projetos")} className={`${inputClass} h-10 w-full pl-10`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiText("Buscar projetos…")} />
          </div>
          <Button disabled={busy} icon={<FolderOpen size={15} />} onClick={() => void openFolderPicker()}>{uiText("Abrir pasta")}</Button>
          <Button disabled={busy} icon={<GitPullRequest size={15} />} onClick={() => {if(cloud){catalogStore.setState({open:false});openGithub();}else setRepoOpen(true);}}>{uiText("Conectar repositório")}</Button>
        </div>
        {error && <p role="alert" className="rounded-control border border-line bg-panel-2 p-4 text-body text-danger">{error}</p>}
        <section aria-label={uiText("Projetos")} className="min-w-0">
          <div className="mb-2 flex justify-between px-3 text-caption text-faint">
            <span>{entries.length} {entries.length === 1 ? 'workspace' : 'workspaces'}</span>
            <span>{uiText("Últimos abertos")}</span>
          </div>
          <div className="divide-y divide-line border-y border-line">
            {filtered.map((entry) => {
              const active = entry.id === activeId;
              const Icon = entry.location.kind === 'cloud' ? Cloud : entry.location.kind === 'browser' ? HardDrive : entry.location.kind === 'folder' ? FolderOpen : GitPullRequest;
              return <button key={entry.id} type="button" disabled={busy} aria-label={uiText("Abrir workspace {0}", [entry.name])} onClick={() => void openRegisteredWorkspace(entry.id).catch(report)} className="group flex w-full items-center gap-4 px-3 py-5 text-left transition-colors hover:bg-panel-2 disabled:opacity-50">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-line bg-panel text-lg font-semibold text-accent">{entry.logo ? <img src={entry.logo} alt="" className="h-full w-full rounded-control object-contain" /> : entry.name.slice(0, 1).toLocaleUpperCase(getLocale())}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-body font-medium">{entry.name}</span>{active && <span className="flex shrink-0 items-center gap-1 text-caption text-accent">
                      <Check size={12} />{uiText("Atual")}</span>}</span>
                  <span className="mt-1 flex min-w-0 items-center gap-1.5 text-caption text-muted">
                    <Icon size={13} className="shrink-0" />
                    <span className="truncate">{locationLabel(entry.location)}</span>
                  </span>
                </span>
                <time className="hidden shrink-0 text-caption text-faint sm:block" dateTime={entry.lastOpenedAt ? new Date(entry.lastOpenedAt).toISOString() : undefined}>{entry.lastOpenedAt ? new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short' }).format(entry.lastOpenedAt) : uiText("Ainda não aberto")}</time>
                <ArrowUpRight size={17} className="shrink-0 text-faint group-hover:text-accent" />
              </button>;
            })}
            {!filtered.length && <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
              <FolderOpen size={28} className="text-faint" />
              <h2 className="text-title font-medium">{query ? uiText("Nenhum projeto encontrado") : uiText("Seu próximo projeto começa aqui")}</h2>
              <p className="text-body text-muted">{query ? uiText("Tente buscar por outro nome.") : uiText("Crie um workspace ou abra uma pasta com sua arquitetura.")}</p>
            </div>}
          </div>
        </section>
      </main>
      <CreateWorkspaceDialog />
      <Modal open={repoOpen} onClose={() => { if (!busy) setRepoOpen(false); }} label={uiText("Conectar repositório")} width={500} closeLabel={busy ? null : uiText("Fechar")}>
        <form className="flex flex-col gap-4 p-5" onSubmit={(event) => { event.preventDefault(); void connectRepository(repoPath.trim()).then(() => { setRepoOpen(false); catalogStore.setState({ open: false }); showToast(uiText("Workspace conectado ao repositório.")); }, report); }}>
          <label htmlFor="project-repo" className="text-body font-medium">{uiText("Pasta do repositório")}</label>
          <input id="project-repo" className={`${inputClass} h-10`} value={repoPath} onChange={(event) => setRepoPath(event.target.value)} placeholder={uiText('/caminho/do/repositório')} disabled={busy} />
          <p className="text-caption text-muted">{uiText("Informe a pasta no computador onde o servidor local do Joinlet está rodando.")}</p>{error && <p role="alert" className="text-body text-danger">{error}</p>}<Button type="submit" variant="primary" disabled={busy || !repoPath.trim()}>{uiText("Conectar")}</Button>
        </form>
      </Modal>
      <Toast />
    </div>
  );
}
