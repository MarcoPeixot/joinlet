import { siteUrl } from '../ui/urls';
import { openSettings } from '../settings/store';
import { LanguagePicker } from '../i18n/LanguagePicker';
import { uiText } from '../i18n';
import { ITEM_LIST } from '@strukt/workspace';
import type { ItemEntry, ItemKind } from '@strukt/workspace';
import { Settings2, Bot, ChevronDown, ChevronsUpDown, Ellipsis, Download, FolderOpen, GitPullRequest, HardDrive, History, LayoutDashboard, MessageCircle, PanelLeft, Pencil, Plus, Trash2, TriangleAlert, Upload } from 'lucide-react';
import { m } from 'motion/react';
import { useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { generateAgentContext } from '../context/session';
import { openGithub } from '../github/session';
import { IconButton } from '../ui/IconButton';
import { Logo } from '../ui/Logo';
import { InlineInput } from '../ui/InlineInput';
import { Menu, MenuCheckItem, MenuItem, MenuLabel, MenuSeparator } from '../ui/Menu';
import { GLIDE } from '../ui/motion';
import { closeSidebarOnMobile, showToast, toggleRightPanel, toggleSection, toggleSidebar, uiStore, useUi } from '../ui/uiStore';
import { SaveIndicator } from './SaveIndicator';
import { toggleVersions } from '../versions/session';
import { createItem, deleteItem, openItem, renameItem } from '../workspace/actions';
import { useWorkspace, workspace } from '../workspace/appWorkspace';
import { collaborationSession, exportZip, isViewOnly, importZip, openFolderPicker, openRegisteredWorkspace } from '../workspace/boot';
import { locationLabel, showCreateWorkspace, showProjects, useCatalog } from '../workspace/catalog';
import { ITEM_ICONS, ITEM_LABELS } from '../workspace/labels';
import { Checklist } from '../onboarding/Checklist';
import { Row, Section } from './SidebarSection';
import type { Editing, FolderEditing } from './SidebarSection';

export { sectionLabel } from './SidebarSection';

/** Sections listed in the sidebar, in order. */
const SECTIONS: ItemKind[] = ['diagram', 'doc', 'sketch'];

function BoardLink() {
  const active = useWorkspace((s) => s.view.kind === 'board');
  return (
    <Row active={active}>
      <button type="button" data-row aria-current={active ? 'page' : undefined} className="relative flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => {
          void workspace.show({ kind: 'board' });
          closeSidebarOnMobile();
        }}>
        <LayoutDashboard size={15} className={active ? 'text-accent' : ''} /> Overview
      </button>
    </Row>
  );
}

/** The workspace's name opens its menu: rename, agent context, storage and .zip. */
function WorkspaceHeader() {
  const name = useWorkspace((s) => s.data?.manifest.name ?? '');
  const logo = useWorkspace((s) => s.data?.manifest.logo);
  const [editing, setEditing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const catalog = useCatalog((s) => s.catalog);
  const activeId = useCatalog((s) => s.activeId);
  const busy = useCatalog((s) => s.busy);
  const available = useCatalog((s) => s.available);
  if (editing) {
    return (
      <div className="px-1">
        <InlineInput
          initial={name}
          label={uiText("Nome do workspace")}
          onCommit={(value) => {
            workspace.setName(value);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }
  return (
    <>
      <Menu
        label={"Workspace"}
        align="start"
        trigger={
          <button
            type="button"
            aria-label={uiText("Menu do workspace")}
            className="flex h-9 w-full min-w-0 items-center gap-2.5 rounded-control px-1.5 text-left transition-colors duration-(--sk-motion-fast) hover:bg-panel-2 data-[state=open]:bg-panel-2"
          >
            <span className="flex h-6 w-6 flex-none items-center justify-center rounded-[7px] bg-panel-3 text-[12px] font-semibold text-ink">
              {logo ? <img src={logo} alt={uiText('Logo do workspace')} className="h-full w-full rounded-[7px] object-contain" /> : name.trim().charAt(0).toUpperCase() || 'W'}
            </span>
            <span className="min-w-0 flex-1 truncate text-body font-semibold">{name}</span>
            <ChevronsUpDown size={14} className="flex-none text-faint" />
          </button>
        }
      >
        {!collaborationSession() && <>
          <MenuItem icon={<LayoutDashboard size={15} />} disabled={busy} onSelect={showProjects}>{uiText("Meus projetos")}</MenuItem>
          <MenuItem icon={<Plus size={15} />} disabled={busy || !available} onSelect={showCreateWorkspace}>{uiText("Novo workspace")}</MenuItem>
          <MenuLabel>{uiText("Workspaces recentes")}</MenuLabel>
          {[...(catalog?.entries ?? [])].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, 5).map((entry) => <MenuCheckItem key={entry.id} checked={entry.id === activeId} description={locationLabel(entry.location)} onSelect={() => {
            if (!busy) void openRegisteredWorkspace(entry.id).catch((cause) => showToast(cause instanceof Error ? cause.message : String(cause)));
          }}>{entry.name}</MenuCheckItem>)}
          <MenuSeparator />
        </>}
        <MenuLabel>{"Workspace"}</MenuLabel>
        <MenuItem icon={<Settings2 size={15} />} onSelect={() => openSettings('workspace')}>{uiText("Configurações do workspace")}</MenuItem>
        {!isViewOnly() && <>
          <MenuItem icon={<Pencil size={14} />} onSelect={() => setEditing(true)}>{uiText("Renomear workspace")}</MenuItem>
          <MenuItem icon={<Bot size={15} />} hint=".arch/context" onSelect={() => void generateAgentContext()}>{uiText("Gerar contexto para agentes")}</MenuItem>
        </>}
        <MenuSeparator />
        <MenuItem icon={<FolderOpen size={15} />} hint="<pasta>/.arch" onSelect={() => void openFolderPicker()}>{uiText("Abrir pasta…")}</MenuItem>
        <MenuItem icon={<GitPullRequest size={15} />} onSelect={openGithub}>{uiText("Conectar repositório…")}</MenuItem>
        <MenuItem icon={<Download size={15} />} onSelect={() => void exportZip()}>{uiText("Exportar .zip")}</MenuItem>
        {!isViewOnly() && (
          <MenuItem icon={<Upload size={15} />} onSelect={() => fileInput.current?.click()}>{uiText("Importar .zip")}</MenuItem>
        )}
      </Menu>
      <input
        ref={fileInput}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void importZip(file);
        }}
      />
    </>
  );
}

function StorageFooter() {
  const source = useWorkspace((s) => s.source);
  const Icon = source?.kind === 'folder' ? FolderOpen : source?.kind === 'memory' ? TriangleAlert : HardDrive;
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 px-3.5 text-caption text-faint" title={uiText("Salvo em: {0}", [source?.label ?? ''])}>
      <Icon size={13} className={source?.kind === 'memory' ? 'text-danger' : ''} />
      <span className="min-w-0 flex-1 truncate">{source?.label}</span>
      <SaveIndicator />
    </div>
  );
}

/** Frequent review actions stay discoverable beside the workspace contents. */
function ReviewLinks() {
  const onDiagram = useWorkspace((s) => s.view.kind === 'diagram');
  const panel = useUi((s) => s.rightPanel);
  if (!onDiagram) return null;
  const linkClass = (active: boolean) => `flex h-8 min-w-0 items-center gap-2 rounded-control px-2 text-left transition-colors pointer-coarse:h-10 ${active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-panel-2 hover:text-ink'}`;
  return (
    <section aria-label={uiText("Revisão do diagrama")} className="flex shrink-0 flex-col gap-0.5 px-3 py-3">
      <p className="mb-1 px-2 text-caption font-medium text-faint">{uiText("Revisão")}</p>
      <button type="button" data-row aria-pressed={panel === 'versions'} className={linkClass(panel === 'versions')} onClick={() => { toggleVersions(); closeSidebarOnMobile(); }}><History size={15} />{uiText("Versões")}</button>
      <button type="button" data-row aria-pressed={panel === 'comments'} className={linkClass(panel === 'comments')} onClick={() => { toggleRightPanel('comments'); closeSidebarOnMobile(); }}><MessageCircle size={15} />{uiText("Comentários")}</button>
    </section>
  );
}

/** Up/Down move focus between the sidebar's rows (Overview and the items), skipping folded sections. */
function walkRows(event: KeyboardEvent<HTMLElement>) {
  const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
  if (!step || !(event.target instanceof HTMLElement) || !event.target.hasAttribute('data-row')) return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-row]')];
  rows[rows.indexOf(event.target) + step]?.focus();
  event.preventDefault();
}

/** Focus follows the counterpart after a deliberate toggle, including during the fold animation. */
export function SidebarToggle({ open }: { open: boolean }) {
  return <IconButton data-sidebar-toggle label={uiText("Mostrar/ocultar barra lateral (⌘\\)")} tooltipSide={open ? 'bottom' : 'right'} pressed={open} onClick={() => {
    toggleSidebar();
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-sidebar-toggle][aria-pressed="${uiStore.getState().sidebarOpen}"]`)?.focus({ preventScroll: true }));
  }}><PanelLeft /></IconButton>;
}

export function Sidebar({ divider }: { divider?: ReactNode }) {
  const open = useUi(s => s.sidebarOpen);
  const [editing, setEditing] = useState<Editing>(null);
  const [folderEditing, setFolderEditing] = useState<FolderEditing>(null);
  return (
    <nav aria-label={"Workspace"} inert={!open || undefined} aria-hidden={!open || undefined} onKeyDown={walkRows} className="pointer-events-auto group/sidebar flex h-full w-full flex-col overflow-hidden bg-bg">
      <a href={siteUrl()} aria-label={uiText("Joinlet, início")} className="flex h-12 shrink-0 items-center gap-2.5 px-5 text-[20px] font-semibold tracking-[-0.06em] text-ink"><Logo size={22} />{"Joinlet"}</a>
      <div className="flex h-(--sk-header-height) shrink-0 items-center gap-1 px-3">
        <div className="min-w-0 flex-1"><WorkspaceHeader /></div>
        <SidebarToggle open />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2.5 pb-3 pt-3">
        <BoardLink />
        {SECTIONS.map((kind) => (
          <Section key={kind} kind={kind} editing={editing} setEditing={setEditing} folderEditing={folderEditing} setFolderEditing={setFolderEditing} />
        ))}
      </div>
      <ReviewLinks />
      <Checklist />
      <div className="px-4 py-2"><LanguagePicker /></div>
      <StorageFooter />
      {divider}
    </nav>
  );
}
