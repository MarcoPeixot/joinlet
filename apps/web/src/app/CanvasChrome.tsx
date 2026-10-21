import { uiText } from '../i18n';
import { useReactFlow } from '@xyflow/react';
import { AnimatePresence, m } from 'motion/react';
import { ChunkBoundary } from '../ui/ChunkBoundary';
import { lazyWithRetry } from '../ui/lazyWithRetry';
import { PanelSkeleton } from '../ui/PanelSkeleton';
import { Suspense, useCallback, useMemo } from 'react';
import { buildCommands } from '../actions/commands';
import { CommandPalette } from '../panels/CommandPalette';
import { useInspectorOpen } from '../panels/useInspectorOpen';
import { BranchComparePanel } from '../panels/BranchComparePanel';
import { SaveVersionDialog } from '../panels/SaveVersionDialog';
import { Toolbar } from '../panels/Toolbar';
import { useDiagram } from '../state/appStore';
import type { RightPanel } from '../ui/uiStore';
import { uiStore, useUi } from '../ui/uiStore';
import { useBranchCompare } from '../github/compare';
import { useWorkspace } from '../workspace/appWorkspace';
import { FirstRunChip } from '../onboarding/FirstRunChip';
import { startCardShown } from '../onboarding/useFirstRun';
import { TourPopover } from '../onboarding/TourPopover';
import { PresentMode } from '../present/PresentMode';
import { RemotePresence } from './RemotePresence';
import { useDockViewport } from './dockLayout';
import { useShortcuts } from './useShortcuts';

/** Side panels that only matter after a click stay out of the first load. */
const GithubPanel = lazyWithRetry(() => import('../panels/GithubPanel').then((m) => ({ default: m.GithubPanel })));
const Inspector = lazyWithRetry(() => import('../panels/Inspector').then((m) => ({ default: m.Inspector })));
const ModelPanel = lazyWithRetry(() => import('../panels/ModelPanel').then((m) => ({ default: m.ModelPanel })));
const VersionsPanel = lazyWithRetry(() => import('../panels/VersionsPanel').then((m) => ({ default: m.VersionsPanel })));
const FlowsPanel = lazyWithRetry(() => import('../panels/FlowsPanel').then((m) => ({ default: m.FlowsPanel })));
const TimelinePanel = lazyWithRetry(() => import('../panels/TimelinePanel').then((m) => ({ default: m.TimelinePanel })));
const PerspectivesPanel = lazyWithRetry(() => import('../perspectives/PerspectivesPanel').then((m) => ({ default: m.PerspectivesPanel })));
const AccuracyPanel = lazyWithRetry(() => import('../panels/AccuracyPanel').then((m) => ({ default: m.AccuracyPanel })));
const ChatPanel = lazyWithRetry(() => import('../chat/ChatPanel').then((m) => ({ default: m.ChatPanel })));
const PerspectiveBanner = lazyWithRetry(() => import('../perspectives/PerspectiveBanner').then((module) => ({ default: module.PerspectiveBanner })));
/** Templates and the start card only matter for an empty diagram. */
const EmptyCanvas = lazyWithRetry(() => import('./EmptyCanvas').then((m) => ({ default: m.EmptyCanvas })));

/** The panel for the slot. */
function rightPanelView(panel: RightPanel | null) {
  switch (panel) {
    case 'accuracy': return <ChunkBoundary key="accuracy" panel="accuracy"><Suspense fallback={<PanelSkeleton label={uiText("Precisão")} />}><AccuracyPanel /></Suspense></ChunkBoundary>;
    case 'model': return <ChunkBoundary key="model" panel="model"><Suspense fallback={<PanelSkeleton label={uiText("Modelo")} />}><ModelPanel /></Suspense></ChunkBoundary>;
    case 'perspectives': return <ChunkBoundary key="perspectives" panel="perspectives"><Suspense fallback={<PanelSkeleton label={uiText("Perspectivas")} />}><PerspectivesPanel /></Suspense></ChunkBoundary>;
    case 'flows': return <ChunkBoundary key="flows" panel="flows"><Suspense fallback={<PanelSkeleton label={uiText("Fluxos")} />}><FlowsPanel /></Suspense></ChunkBoundary>;
    case 'versions': return <ChunkBoundary key="versions" panel="versions"><Suspense fallback={<PanelSkeleton label={uiText("Versões")} />}><VersionsPanel /></Suspense></ChunkBoundary>;
    case 'timeline': return <ChunkBoundary key="timeline" panel="timeline"><Suspense fallback={<PanelSkeleton label={uiText("Linha do tempo")} />}><TimelinePanel /></Suspense></ChunkBoundary>;
    case 'github': return <ChunkBoundary key="github" panel="github"><Suspense fallback={<PanelSkeleton label={"GitHub"} />}><GithubPanel /></Suspense></ChunkBoundary>;
    // The panel is drawn by the comments chunk (comments/CommentsHost); this only keeps the Inspector out of its slot.
    case 'comments': return false;
    case 'chat': return <ChunkBoundary key="chat" panel="chat"><Suspense fallback={<PanelSkeleton label={"Chat"} />}><ChatPanel /></Suspense></ChunkBoundary>;
    default: return null;
  }
}

/** Floating UI over the canvas; lives inside ReactFlowProvider to map screen → flow coordinates. */
export function CanvasChrome() {
  const flow = useReactFlow();
  const center = useCallback(() => {
    const pane = document.querySelector('.react-flow')?.getBoundingClientRect();
    const x = pane ? pane.left + pane.width / 2 : window.innerWidth / 2;
    const y = pane ? pane.top + pane.height / 2 : window.innerHeight / 2;
    return flow.screenToFlowPosition({ x, y });
  }, [flow]);
  useShortcuts(center);
  useDockViewport();
  const flowAnimation = useUi((s) => s.flowAnimation);
  const manifest = useWorkspace((s) => s.data?.manifest);
  const commands = useMemo(
    () => buildCommands({ center, flowAnimation, items: manifest && { diagram: manifest.diagrams, doc: manifest.docs, sketch: manifest.sketches }}),
    [center, flowAnimation, manifest],
  );
  const rightPanel = useUi((s) => s.rightPanel);
  const perspectiveApplied = useUi((s) => s.activePerspective !== null);
  const branchPreview = useBranchCompare((s) => s.preview);
  const inspectorOpen = useInspectorOpen();
  const presenting = useUi((s) => s.presenting);
  const empty = useDiagram(startCardShown);
  return (
    <>
      {!presenting && (
        <>
          <Toolbar center={center} />
          {perspectiveApplied && <ChunkBoundary><Suspense fallback={null}><PerspectiveBanner /></Suspense></ChunkBoundary>}
          {empty && <ChunkBoundary><Suspense fallback={null}><EmptyCanvas center={center} /></Suspense></ChunkBoundary>}
          <FirstRunChip />
          <TourPopover />
          <AnimatePresence>{branchPreview ? <BranchComparePanel key="branch" /> : rightPanelView(rightPanel) ?? (inspectorOpen ? <ChunkBoundary key="inspector"><Suspense fallback={null}><Inspector /></Suspense></ChunkBoundary> : null)}</AnimatePresence>
        </>
      )}
      <RemotePresence />
      <PresentMode />
      <CommandPalette commands={commands} />
      <SaveVersionDialog />
    </>
  );
}
