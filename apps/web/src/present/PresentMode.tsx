import { uiText } from '../i18n';
import { getViewportForBounds, useReactFlow } from '@xyflow/react';
import type { ReactFlowInstance } from '@xyflow/react';
import { ChevronLeft, ChevronRight, Pause, Play, Route, X } from 'lucide-react';
import { m } from 'motion/react';
import { useEffect, useRef } from 'react';
import { diagramStore } from '../state/appStore';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { slideFrom } from '../ui/motion';
import { uiStore, useUi } from '../ui/uiStore';
import { exitPresentation, handlePresentKey, nextStep, prevStep, presentStore, setPresentationDirection, toggleFlowExploration, toggleFlowPlayback, usePresent } from './presentStore';

const FIT_MS = 600;
/** Margins around the framed nodes (a ratio of the pane, as in fitView) and the highest zoom a single node gets. */
const FIT_PADDING = 0.25;
const MAX_ZOOM = 1.5;
/** Extra room below the framed nodes, as a share of their height, so the caption bar never covers them. */
const CAPTION_ROOM = 0.18;

/** Frames `ids` in the pane, leaving room for the caption bar. */
function frame(flow: ReactFlowInstance, ids: string[], duration: number): void {
  const pane = document.querySelector('.react-flow')?.getBoundingClientRect();
  if (!pane?.width || !pane.height) return;
  const bounds = flow.getNodesBounds(ids);
  const taller = { ...bounds, height: bounds.height * (1 + CAPTION_ROOM) };
  const view = getViewportForBounds(taller, pane.width, pane.height, 0.1, MAX_ZOOM, FIT_PADDING);
  void flow.setViewport(view, { duration });
}

const prefersReducedMotion = () => uiStore.getState().reduceMotion || (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

/** Modo apresentação: hides the chrome (see `uiStore.presenting`), walks the camera through the steps and shows a caption bar. */
export function PresentMode() {
  const active = usePresent((s) => s.active);
  // Unmounting the canvas (view switch) ends the mode and releases its lock; a diagram switch does the same in the store.
  useEffect(() => () => exitPresentation(), []);
  return active ? <PresentSession /> : null;
}

function PresentSession() {
  const flow = useReactFlow();
  const steps = usePresent((s) => s.steps);
  const index = usePresent((s) => s.index);
  const exploring = usePresent(s => s.exploring);
  const flowSteps = usePresent(s => s.flowSteps);
  const flowIndex = usePresent(s => s.flowIndex);
  const playing = usePresent(s => s.playing);
  const direction = usePresent(s => s.direction);
  const step = exploring ? flowSteps[flowIndex] : steps[index];
  const cameraFocus = exploring ? [...new Set(flowSteps.flatMap(item => item.focus))].join('\0') : step?.focus.join('\0');
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      const state = presentStore.getState();
      if (state.flowIndex >= state.flowSteps.length - 1) presentStore.setState({ playing: false });
      else presentStore.setState({ flowIndex: state.flowIndex + 1 });
    }, 1500);
    return () => clearTimeout(timer);
  }, [playing, flowIndex, flowSteps]);
  const region = useRef<HTMLDivElement>(null);

  // Focus goes into the caption bar and comes back to where it was (or the canvas) on exit.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    region.current?.focus({ preventScroll: true });
    return () => {
      const target = before && before.isConnected && before !== document.body ? before : document.getElementById('canvas');
      target?.focus({ preventScroll: true });
    };
  }, []);

  // Keys of the mode, ahead of the canvas's own handlers; a palette or dialog in front keeps its keys.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (uiStore.getState().paletteOpen || target?.closest?.('[role="dialog"], input, textarea, select, [contenteditable="true"]')) return;
      const interactive = !!target && (['BUTTON', 'A', 'SUMMARY'].includes(target.tagName) || !!target.closest?.('button, a[href]'));
      if (handlePresentKey(event, interactive)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // Fullscreen is a bonus: leaving it (Esc in the browser) ends the mode, and so does history navigation (back/forward).
  useEffect(() => {
    let inFullscreen = false;
    const onFullscreen = () => {
      if (inFullscreen && !document.fullscreenElement) exitPresentation();
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    try {
      void document.documentElement.requestFullscreen?.().then(() => { inFullscreen = !!document.fullscreenElement; }, () => undefined);
    } catch {
      // not allowed or not supported: the mode works the same without it
    }
    const onPop = () => exitPresentation();
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen);
      window.removeEventListener('popstate', onPop);
      inFullscreen = false;
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    };
  }, []);

  // Dimming reuses the guided-flow lighting (activeFlowNodes/Edges in DiagramCanvas).
  useEffect(() => {
    // A step that frames everything (the overview) dims nothing.
    const all = !step || !exploring && step.focus.length >= diagramStore.getState().model.order.length;
    uiStore.setState({ activeFlowNodes: all ? [] : step.focus, activeFlowEdges: all ? [] : (step.edges ?? []) });
  }, [step, exploring]);

  // Camera: frame the focused nodes (after the chrome has left and the pane has its final size).
  const first = useRef(true);
  useEffect(() => {
    if (!cameraFocus) return;
    const ids = cameraFocus.split('\0').filter((id) => flow.getInternalNode(id));
    if (!ids.length) return;
    const run = () => frame(flow, ids, prefersReducedMotion() ? 0 : FIT_MS);
    const timer = setTimeout(run, first.current ? 60 : 0);
    first.current = false;
    return () => clearTimeout(timer);
  }, [cameraFocus, flow]);

  // The container resizes when the chrome goes away or the window changes: keep the step framed.
  const reduce = useUi((s) => s.reduceMotion);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const state = presentStore.getState();
        const focus = state.exploring ? [...new Set(state.flowSteps.flatMap(item => item.focus))] : state.steps[state.index]?.focus ?? [];
        const ids = focus.filter((id) => flow.getInternalNode(id));
        if (ids.length) frame(flow, ids, 0);
      }, 120);
    };
    window.addEventListener('resize', onResize);
    return () => { clearTimeout(timer); window.removeEventListener('resize', onResize); };
  }, [flow, reduce]);

  const position = exploring ? `${flowSteps.length ? flowIndex + 1 : 0} / ${flowSteps.length}` : `${index + 1} / ${steps.length}`;
  return (
    <>
    {exploring && <div className="absolute inset-x-4 top-4 z-20 flex justify-center"><div className="sk-float flex max-w-full flex-wrap items-center justify-center gap-2 rounded-panel px-3 py-2 text-caption"><span className="text-muted">{uiText("Clique em um componente para explorar o fluxo")}</span><Button size="sm" variant={direction === 'upstream' ? 'secondary' : 'ghost'} onClick={() => setPresentationDirection('upstream')}>{uiText("Antes")}</Button><Button size="sm" variant={direction === 'downstream' ? 'secondary' : 'ghost'} onClick={() => setPresentationDirection('downstream')}>{uiText("Depois")}</Button></div></div>}
    <div className="pointer-events-none absolute inset-x-4 bottom-4 z-20 flex justify-center">
    <m.div
      ref={region}
      role="region"
      aria-label={uiText("Apresentação")}
      tabIndex={-1}
      className="sk-float pointer-events-auto flex w-[min(720px,100%)] items-center gap-2 rounded-[18px] px-3 py-2.5 outline-none"
      {...slideFrom('bottom')}
    >
      <IconButton label={uiText("Explorar fluxo")} pressed={exploring} onClick={toggleFlowExploration}><Route /></IconButton>
      {exploring && <IconButton label={playing ? uiText("Pausar fluxo") : uiText("Reproduzir fluxo")} disabled={flowSteps.length < 2} onClick={toggleFlowPlayback}>{playing ? <Pause /> : <Play />}</IconButton>}
      <IconButton label={uiText("Passo anterior (←)")} disabled={exploring ? flowIndex === 0 : index === 0} onClick={prevStep}>
        <ChevronLeft />
      </IconButton>
      <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5 text-center">
        <h2 className="max-w-full truncate text-title font-semibold">{step?.title || uiText("Explorar fluxo")}</h2>
        {step?.note && <p className="max-h-20 max-w-full overflow-y-auto whitespace-pre-line text-body text-muted">{step.note}</p>}
      </div>
      <span className="text-caption tabular-nums text-faint">{position}</span>
      <IconButton label={uiText("Próximo passo (→)")} disabled={exploring ? !flowSteps.length || flowIndex === flowSteps.length - 1 : index === steps.length - 1} onClick={nextStep}>
        <ChevronRight />
      </IconButton>
      <IconButton label={uiText("Sair da apresentação (Esc)")} onClick={exitPresentation}>
        <X />
      </IconButton>
      <span className="sr-only" role="status" aria-live="polite">{exploring ? uiText("Etapa {0} de {1}: {2}", [flowSteps.length ? flowIndex + 1 : 0, flowSteps.length, step?.title || uiText("Selecione um componente")]) : uiText("Passo {0} de {1}: {2}", [index + 1, steps.length, step?.title])}</span>
    </m.div>
    </div>
    </>
  );
}
