import { trackBetaUsage } from '../settings/betaUsage';
import { uiText } from '../i18n';
import { closeShare, useShare } from '../share/session';
import { CommentsMount } from '../comments/lazy';
import { ReactFlowProvider } from '@xyflow/react';
import { closeTemplateGallery, useTemplateGallery } from '../actions/templates';
import { useLibraryEditor } from '../actions/library';
import { AnimatePresence, m } from 'motion/react';
import { Suspense, useEffect, useState } from 'react';
import { PanelSkeleton } from '../ui/PanelSkeleton';
import { ChunkBoundary } from '../ui/ChunkBoundary';
import { lazyWithRetry } from '../ui/lazyWithRetry';
import { DiagramCanvas } from '../canvas/DiagramCanvas';
import { AiComposer } from '../panels/AiPanel';
import { DocModal } from '../panels/DocModal';
import { closeSettings, openSettings, useSettings } from '../settings/store';
import { SketchView } from '../sketch/SketchView';
import { diagramStore } from '../state/appStore';
import { SPRING } from '../ui/motion';
import { startAnnouncements } from '../ui/announcements';
import { LiveRegion } from '../ui/LiveRegion';
import { Toast } from '../ui/Toast';
import { setSidebarWidth, showToast, toggleSidebar, useUi } from '../ui/uiStore';
import { PanelDivider } from '../ui/PanelDivider';
import { useIsMobile } from '../ui/useBreakpoint';
import { useWorkspace } from '../workspace/appWorkspace';
import { collaborationSession, useBootPhase } from '../workspace/boot';
import { catalogStore, useCatalog } from '../workspace/catalog';
import { BootScreen } from './BootScreen';
import { CanvasChrome } from './CanvasChrome';
import { CodeDock } from './CodeDock';
import { useSidebarYield } from './dockLayout';
import { ExternalChangesBanner } from './ExternalChangesBanner';
import { RightDock } from './RightDock';
import { PageHeading } from './PageHeading';
import { Sidebar, SidebarToggle } from './Sidebar';
import { TopBar } from './TopBar';
import { useSaveKeyGuard } from './useSaveKeyGuard';

/** The Markdown editor (CodeMirror's markdown/html/css/js grammars) only loads when a doc is opened. */
const DocumentsWorkspace = lazyWithRetry(() => import('../docs/DocumentsWorkspace'));
const BoardView = lazyWithRetry(() => import('../board/BoardView').then((m) => ({ default: m.BoardView })));
/** Configurações (with the AI and GitHub sections) load the first time the dialog opens, then stay mounted for its exit animation. */
const ChatPanel = lazyWithRetry(() => import('../chat/ChatPanel').then((m) => ({ default: m.ChatPanel })));
const GithubPanel = lazyWithRetry(() => import('../panels/GithubPanel').then(m=>({default:m.GithubPanel})));
const ShareDialog = lazyWithRetry(() => import('../share/ShareDialog').then((m) => ({ default: m.ShareDialog })));
const SettingsModal = lazyWithRetry(() => import('../settings/SettingsModal').then((m) => ({ default: m.SettingsModal })));
const CollaborationBridge = lazyWithRetry(() => import('./CollaborationBridge').then((m) => ({ default: m.CollaborationBridge })));
const ProjectsView = lazyWithRetry(() => import('../workspace/ProjectsView').then((m) => ({ default: m.ProjectsView })));
const CreateWorkspaceDialog = lazyWithRetry(() => import('../workspace/ProjectsView').then((m) => ({ default: m.CreateWorkspaceDialog })));
const TemplateGallery = lazyWithRetry(() => import('./TemplateGallery').then((m) => ({ default: m.TemplateGallery })));
const WorkspaceLibraryEditor = lazyWithRetry(() => import('../panels/WorkspaceLibraryEditor').then((m) => ({ default: m.WorkspaceLibraryEditor })));

/** Docs and sketches start under the floating bar. */
const BELOW_BAR = 'absolute inset-x-0 bottom-0 top-(--sk-header-height) overflow-hidden bg-panel';

/** The main area follows the workspace view; the diagram view keeps the M1–M3 editor as it was. */
function MainView() {
  const view = useWorkspace((s) => s.view);
  const presenting = useUi((s) => s.presenting);
  return (
    <>
      {view.kind === 'diagram' && !presenting && <CodeDock />}
      <main id="canvas" tabIndex={-1} data-tour="canvas" data-view={view.kind} data-presenting={presenting || undefined} className="sk-workbench-canvas relative outline-none min-h-0 min-w-0 flex-1 overflow-hidden bg-(--sk-workspace-surface)">
        {view.kind === 'board' && !presenting && <TopBar embedded />}
        <PageHeading />
        {view.kind === 'diagram' && (
          <>
            <ChunkBoundary fill><DiagramCanvas /></ChunkBoundary>
            <ChunkBoundary><CanvasChrome /></ChunkBoundary>
            {!presenting && <AiComposer />}
          </>
        )}
        {view.kind === 'doc' && (
          <div className={BELOW_BAR}>
            <ChunkBoundary fill>
              <Suspense fallback={<div className="flex h-full items-center justify-center text-muted">{uiText("Carregando o editor…")}</div>}>
                <DocumentsWorkspace slug={view.slug} />
              </Suspense>
            </ChunkBoundary>
          </div>
        )}
        {(view.kind === 'diagram' || view.kind === 'doc') && !presenting && <CommentsMount />}
        {view.kind === 'sketch' && <div className={BELOW_BAR}><SketchView key={view.slug} slug={view.slug} /></div>}
        {view.kind === 'board' && <ChunkBoundary fill><Suspense fallback={<div className="flex h-full items-center justify-center text-muted">{uiText("Carregando o overview…")}</div>}><BoardView /></Suspense></ChunkBoundary>}
        <Toast />
      </main>
    </>
  );
}

/** First stop of the Tab order: jumps over the top bar and sidebar straight to the canvas. */
function SkipLink() {
  return (
    <a
      href="#canvas"
      className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[100] focus:rounded-control focus:bg-panel focus:px-3 focus:py-2 focus:text-body focus:font-medium focus:text-ink focus:shadow-pop"
      onClick={(event) => {
        event.preventDefault();
        document.getElementById('canvas')?.focus();
      }}
    >{uiText("Pular para o canvas")}</a>
  );
}

/** The workspace sidebar folds away (⌘\ or the top bar button) and the canvas takes the room. */
/** The chat also lives beside documents, sketches and the board; over a diagram the canvas chrome hosts it. */
function ChatDock() {
  const open = useUi((s) => s.rightPanel === 'chat');
  const onDiagram = useWorkspace((s) => s.view.kind === 'diagram');
  if (!open || onDiagram) return null;
  return (
    <AnimatePresence>
      <ChunkBoundary key="chat" panel="chat"><Suspense fallback={<PanelSkeleton label={"Chat"} />}><ChatPanel /></Suspense></ChunkBoundary>
    </AnimatePresence>
  );
}

/** Repository setup must be reachable from an empty workspace, documents and Overview. */
function RepositoryDock() {
  const open=useUi(state=>state.rightPanel==='github');
  const onDiagram=useWorkspace(state=>state.view.kind==='diagram');
  if(!open||onDiagram)return null;
  return <ChunkBoundary panel="github"><Suspense fallback={<PanelSkeleton label="GitHub"/>}><GithubPanel/></Suspense></ChunkBoundary>;
}

function SidebarDock() {
  const mobile = useIsMobile();
  const savedWidth = useUi(s => s.sidebarWidth);
  const width = mobile ? 260 : savedWidth;
  const [dragging, setDragging] = useState(false);
  const open = useUi((s) => s.sidebarOpen);
  return (
    <>
      {!open && <div className="sk-sidebar-reopen sk-float absolute left-4 top-5 z-40 rounded-panel p-1"><SidebarToggle open={false} /></div>}
      <AnimatePresence initial={false}>
        {open && <button type="button" aria-label={uiText("Fechar barra lateral")} className="absolute inset-0 z-30 bg-(--sk-scrim) sm:hidden" onClick={toggleSidebar} />}
        {open && (
          <m.div
            key="sidebar"
            className="pointer-events-none absolute inset-y-0 left-0 z-40 h-full shrink-0 overflow-hidden sm:relative sm:z-30"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={dragging ? { duration: 0 } : SPRING}
          >
            <Sidebar divider={!mobile && <PanelDivider label={uiText("Redimensionar sidebar")} side="right" value={width} min={220} max={360} initial={260} onChange={setSidebarWidth} onDragging={setDragging} />} />
          </m.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function AppShell() {
  const templatesOpen = useTemplateGallery();
  const libraryEditorOpen = useLibraryEditor((state) => state.request !== null);
  const projectsOpen = useCatalog((s) => s.open);
  const creating = useCatalog((s) => s.creating);
  const changingProject = useCatalog((s) => s.busy);
  const theme = useUi((s) => s.theme);
  const themePref = useUi((s) => s.themePref);
  const reduceMotion = useUi((s) => s.reduceMotion);
  const presenting = useUi((s) => s.presenting);
  const accent = useUi((s) => s.accent);
  const phase = useBootPhase();
  const betaSession = phase.kind === 'ready' ? collaborationSession() : null;
  useEffect(() => betaSession ? trackBetaUsage(betaSession) : undefined, [betaSession]);
  const documentOpen = useWorkspace((s) => s.view.kind === 'doc');
  const overviewOpen = useWorkspace((s) => s.view.kind === 'board');
  const sidebarOpen = useUi(s => s.sidebarOpen);
  const codeOpen = useUi(s => s.codeOpen);
  const settingsOpen = useSettings((st) => st.open);
  const [settingsSeen, setSettingsSeen] = useState(false);
  if (settingsOpen && !settingsSeen) setSettingsSeen(true);
  const shareOpen = useShare((st) => st.open);
  const [shareSeen, setShareSeen] = useState(false);
  if (shareOpen && !shareSeen) setShareSeen(true);
  useSaveKeyGuard();
  useSidebarYield();
  useEffect(() => {
    document.documentElement.dataset.theme = themePref === 'contrast' ? 'contrast' : theme;
  }, [theme, themePref]);
  useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);
  useEffect(() => {
    if (reduceMotion) document.documentElement.dataset.reduceMotion = '';
    else delete document.documentElement.dataset.reduceMotion;
  }, [reduceMotion]);
  useEffect(
    () =>
      diagramStore.subscribe((state, prev) => {
        if (state.errorSeq !== prev.errorSeq && state.lastError) showToast(state.lastError);
      }),
    [],
  );
  useEffect(() => startAnnouncements(), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const projects = catalogStore.getState();
      if (projects.open || projects.creating || projects.busy) return;
      if ((event.metaKey || event.ctrlKey) && event.key === '\\') {
        event.preventDefault();
        toggleSidebar();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        openSettings();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (phase.kind !== 'ready' && !projectsOpen) return <BootScreen phase={phase} />;
  return (
    <ReactFlowProvider>
      {projectsOpen && <ChunkBoundary fill><Suspense fallback={<BootScreen phase={{ kind: 'loading' }} />}><ProjectsView /></Suspense></ChunkBoundary>}
      <div inert={projectsOpen || changingProject || undefined} className={`${projectsOpen ? 'hidden' : 'flex'} h-full w-full min-w-0 flex-col overflow-hidden`}>
        <SkipLink />
        <LiveRegion />
        {collaborationSession() && <ChunkBoundary><Suspense fallback={null}><CollaborationBridge /></Suspense></ChunkBoundary>}
        <div className="sk-workspace-surface relative flex min-h-0 min-w-0 flex-1" data-surface={documentOpen ? 'document' : 'canvas'} data-sidebar-open={sidebarOpen} data-code-open={codeOpen}>
          {/* The bar (absolute, above everything) comes first in the DOM so Tab meets it before the sidebar and the canvas. */}
          {!presenting && !overviewOpen && <TopBar />}
          {!presenting && <SidebarDock />}
          <MainView />
          {!presenting && <RightDock />}
          {!presenting && <ChatDock />}
          {!presenting && <RepositoryDock />}
          {!presenting && <ExternalChangesBanner />}
        </div>
        <DocModal />
        {templatesOpen && <ChunkBoundary overlay onError={closeTemplateGallery}><Suspense fallback={null}><TemplateGallery /></Suspense></ChunkBoundary>}
        {libraryEditorOpen && <ChunkBoundary overlay><Suspense fallback={null}><WorkspaceLibraryEditor /></Suspense></ChunkBoundary>}
        {shareSeen && <ChunkBoundary overlay onError={closeShare}><Suspense fallback={null}><ShareDialog /></Suspense></ChunkBoundary>}
        {settingsSeen && <ChunkBoundary overlay onError={closeSettings}><Suspense fallback={null}><SettingsModal /></Suspense></ChunkBoundary>}
      </div>
      {creating && !projectsOpen && <ChunkBoundary overlay><Suspense fallback={null}><CreateWorkspaceDialog /></Suspense></ChunkBoundary>}
      {changingProject && <div role="status" aria-live="polite" className="fixed inset-0 z-[70] flex items-center justify-center bg-(--sk-overlay) text-body text-ink">{uiText("Abrindo workspace…")}</div>}
    </ReactFlowProvider>
  );
}
