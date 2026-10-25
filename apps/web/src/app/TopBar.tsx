import { uiText } from '../i18n';
import { useLayoutEffect, useRef } from 'react';
import { BadgeAlert, Boxes, Copy, Eye, Download, FileCode2, GitCommitHorizontal, GitPullRequest, History, ImageDown, LayoutTemplate, Link2, ListVideo, MessageCircle, Presentation, PanelRight, Settings, UsersRound } from 'lucide-react';
import { openTemplateGallery } from '../actions/templates';
import { openSaveTemplate } from '../actions/library';
import type { ReactNode } from 'react';
import { copyDiagramAs, copySelectionImage, exportDiagram } from '../actions/export';
import { githubChangeCount, useGithub } from '../github/session';
import { ShareButton } from '../share/ShareButton';
import { enterPresentation } from '../present/presentStore';
import { openSettings } from '../settings/store';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Menu, MenuCheckItem, MenuGroup, MenuItem, MenuSeparator } from '../ui/Menu';
import { useIsMobile } from '../ui/useBreakpoint';
import type { RightPanel } from '../ui/uiStore';
import { showToast, toggleRightPanel, uiStore, useUi } from '../ui/uiStore';
import { PANEL_GROUPS, panelHint, panelsSummary, panelsTriggerLabel } from './panelsMenu';
import type { PanelSignals } from './panelsMenu';
import { toggleVersions } from '../versions/session';
import { useDiagram } from '../state/appStore';
import { useWorkspace } from '../workspace/appWorkspace';
import { useCollaborationView } from '../workspace/collaborationView';
import { collaborationSession, isViewOnly } from '../workspace/boot';
import { PresenceAvatars } from './PresenceAvatars';

const SEP = 'mx-1 h-5 w-px';

/** Floating actions leave the canvas visible behind the toolbar. */
export const TOPBAR_GROUP = 'sk-topbar-group sk-float pointer-events-auto ml-auto flex min-h-10 min-w-0 max-w-full shrink-0 items-center gap-1 overflow-x-auto px-2.5 py-1.5';

function ExportMenu() {
  const selected = useDiagram(s => s.selection.nodes.length > 0);
  return (
    <Menu
      label={uiText("Exportar")}
      trigger={
        <IconButton label={uiText("Exportar")} title={uiText("Exportar: SVG, PNG, Mermaid ou PlantUML")}>
          <Download />
        </IconButton>
      }
    >
      <MenuItem icon={<FileCode2 size={15} />} hint={uiText("Vetorial")} onSelect={() => void exportDiagram('svg')}>{uiText("Exportar SVG")}</MenuItem>
      <MenuItem icon={<ImageDown size={15} />} hint="Imagem 2×" onSelect={() => void exportDiagram('png')}>{uiText("Exportar PNG")}</MenuItem>
      <MenuSeparator />
      <MenuItem disabled={!selected} icon={<Copy size={15} />} hint="⌘⇧C" onSelect={() => void copySelectionImage()}>{uiText("Copiar seleção como imagem")}</MenuItem>
      <MenuItem disabled={!selected} icon={<ImageDown size={15} />} hint={uiText("Transparente")} onSelect={() => void copySelectionImage(true)}>{uiText("Baixar seleção PNG")}</MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Copy size={15} />} hint={uiText("Texto")} onSelect={() => void copyDiagramAs('mermaid')}>{uiText("Copiar como Mermaid")}</MenuItem>
      <MenuItem icon={<Copy size={15} />} hint={uiText("Texto")} onSelect={() => void copyDiagramAs('plantuml')}>{uiText("Copiar como PlantUML")}</MenuItem>
    </Menu>
  );
}

const PANEL_ICONS: Record<RightPanel, ReactNode> = {
  flows: <ListVideo size={15} />,
  model: <Boxes size={15} />,
  accuracy: <BadgeAlert size={15} />,
  versions: <History size={15} />,
  timeline: <GitCommitHorizontal size={15} />,
  github: <GitPullRequest size={15} />,
  chat: <MessageCircle size={15} />,
  perspectives: <Eye size={15} />,
  comments: <MessageCircle size={15} />,
};

const openPanel = (panel: RightPanel) => (panel === 'versions' ? toggleVersions() : toggleRightPanel(panel));

/**
 * The right-hand panels behind one trigger (desktop and phone alike): the bar stays calm and the trigger names the
 * open panel. On a phone the menu also carries Apresentar; Código lives in the canvas palette.
 */
export function PanelsMenu({ compact, signals }: { compact: boolean; signals: PanelSignals }) {
  // The chat has its own button beside Configurações: it never counts as "a panel of the menu".
  const rightPanel = useUi((s) => (s.rightPanel === 'chat' ? null : s.rightPanel));
  const active = rightPanel !== null;
  const label = panelsTriggerLabel(rightPanel);
  const summary = panelsSummary(signals).join(', ');
  const name = `${rightPanel ? uiText("Painéis: {0}", [label]) : uiText("Painéis")}${summary ? ` (${summary})` : ''}`;
  return (
    <Menu
      label={uiText("Painéis")}
      trigger={
        <IconButton label={name} title={summary ? uiText("Painéis: {0}", [summary]) : uiText("Painéis")} active={active} className="relative">
          <PanelRight />
          {summary && <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />}
          <span data-slot="comments-badge" />
        </IconButton>
      }
    >
      {PANEL_GROUPS.map((group) => (
        <MenuGroup key={group.label} label={group.label}>
          {group.panels.map((panel) => (
            <MenuCheckItem
              key={panel.id}
              icon={PANEL_ICONS[panel.id]}
              checked={rightPanel === panel.id}
              description={compact ? undefined : panel.description}
              hint={panelHint(panel.id, signals)}
              onSelect={() => openPanel(panel.id)}
            >
              {panel.label}
            </MenuCheckItem>
          ))}
        </MenuGroup>
      ))}
      {compact && (
        <>
          <MenuSeparator />
          <MenuItem icon={<Presentation size={15} />} hint="P" onSelect={() => void enterPresentation()}>{uiText("Apresentar")}</MenuItem>
        </>
      )}
    </Menu>
  );
}

export function TopBar({ embedded = false }: { embedded?: boolean }) {
  const barRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const bar = barRef.current;
    const canvas = document.getElementById('canvas');
    if (!bar || !canvas) return;
    // Observe the real canvas: the toolbar follows every dock/sidebar/code resize, including its animation.
    const measure = () => {
      const bounds = canvas.getBoundingClientRect();
      bar.style.left = `${embedded ? 56 : Math.max(56, bounds.left + 16)}px`;
      bar.style.right = `${embedded ? 16 : Math.max(12, window.innerWidth - bounds.right + 16)}px`;
      document.documentElement.style.setProperty('--sk-chrome-bottom', `${bar.getBoundingClientRect().bottom}px`);
    };
    measure();
    let frame = 0;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(canvas);
    observer.observe(bar);
    window.addEventListener('resize', schedule);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', schedule); document.documentElement.style.removeProperty('--sk-chrome-bottom'); };
  }, [embedded]);
  const mobile = useIsMobile();
  const collaboration = useCollaborationView();
  const lanSession = collaborationSession()?.mode === 'lan' && !collaborationSession()?.owner && !isViewOnly();
  const copyInvite = async () => {
    try {
      const result = await fetch('/api/collaboration/invite');
      if (!result.ok) throw new Error(uiText("Convite indisponível."));
      const { url } = await result.json() as { url: string };
      await navigator.clipboard.writeText(url);
      showToast(uiText("Convite de colaboração copiado."));
    } catch { showToast(uiText("Não foi possível copiar o convite.")); }
  };
  const chatOpen = useUi((s) => s.rightPanel === 'chat');
  const changes = useGithub(githubChangeCount);
  const concerns = useWorkspace((s) => s.data?.concerns?.filter((item) => item.status === 'open').length ?? 0);
  const lens = useUi((s) => s.activeTag);
  // Diagram tools only make sense while the canvas is shown.
  const onDiagram = useWorkspace((s) => s.view.kind === 'diagram');
  return (
    <header ref={barRef} data-embedded={embedded || undefined} className="sk-workbench-header pointer-events-none absolute right-4 top-6 z-[35] flex min-w-0 items-start justify-end">
      <div className={TOPBAR_GROUP}>
        {collaboration.status && (
          <span
            role="status"
            title={collaboration.error ?? undefined}
            className={`flex max-w-40 items-center gap-1.5 truncate px-1 text-caption ${collaboration.status === 'error' ? 'text-danger' : 'text-muted'}`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${collaboration.status === 'connected' ? 'bg-accent' : collaboration.status === 'error' ? 'bg-danger' : 'bg-line-strong'}`} />
            <PresenceAvatars people={collaboration.others} />
            <UsersRound size={13} className="shrink-0" />
            <span className="hidden truncate sm:inline">{collaboration.status === 'connected' ? `${collaboration.peers.length} ${collaboration.peers.length === 1 ? uiText("pessoa") : uiText("pessoas")}` : collaboration.status === 'error' ? uiText("Erro na colaboração") : uiText("Reconectando…")}</span>
          </span>
        )}
        {isViewOnly() && (
          <span role="note" title={uiText("Você abriu um link somente leitura: dá para ver e navegar, mas não editar.")} className="flex items-center gap-1 rounded-chip bg-panel-2 px-2 py-0.5 text-caption font-medium text-muted">
            <Eye size={13} /> {uiText("Somente leitura")}</span>
        )}
        {collaboration.fatal && <Button onClick={() => window.location.reload()}>{uiText("Recarregar")}</Button>}
        {lanSession && <IconButton label={uiText("Copiar convite de colaboração")} onClick={() => void copyInvite()}><Link2 /></IconButton>}
        {/* Sharing starts from the person's own app; a guest already came through someone's link. */}
        {(!collaborationSession() || collaborationSession()?.owner) && <ShareButton />}
        <Menu label={uiText("Modelos")} trigger={<IconButton label={uiText("Modelos de diagramas")}><LayoutTemplate /></IconButton>}>
          <MenuItem icon={<LayoutTemplate size={15} />} onSelect={openTemplateGallery}>{uiText("Explorar modelos")}</MenuItem>
          {onDiagram && <MenuItem icon={<Copy size={15} />} onSelect={openSaveTemplate}>{uiText("Salvar diagrama como template")}</MenuItem>}
        </Menu>
        {onDiagram && (
          <>
            <PanelsMenu compact={mobile} signals={{ concerns, changes, lens }} />
            {!mobile && (
              <>
                <span className={SEP} />
                <IconButton label={uiText("Apresentar (P)")} title={uiText("Modo apresentação: percorre o diagrama passo a passo (P)")} onClick={() => void enterPresentation()}>
                  <Presentation />
                </IconButton>
              </>
            )}
            <span className="hidden md:inline-flex"><ExportMenu /></span>
            <span className={`${SEP} hidden md:block`} />
          </>
        )}
        <IconButton data-tour="ai" label={uiText("Chat com a IA")} title={uiText("Conversar com a IA sobre os diagramas e documentos")} pressed={chatOpen} onClick={() => toggleRightPanel('chat')}>
          <MessageCircle />
        </IconButton>
        <IconButton label={uiText("Configurações (⌘,)")} onClick={() => openSettings()}>
          <Settings />
        </IconButton>
      </div>
    </header>
  );
}
