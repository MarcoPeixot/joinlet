import { uiText } from '../i18n';
import { AnimatePresence, m } from 'motion/react';
import { Suspense, useEffect, useState } from 'react';
import { ChunkBoundary } from '../ui/ChunkBoundary';
import { lazyWithRetry } from '../ui/lazyWithRetry';
import { PanelDivider } from '../ui/PanelDivider';
import { CODE_WIDTH } from '../ui/codeWidth';
import { useDockOpen } from '../ui/dock';
import { CANVAS_MIN, codeShouldFloat, dockPanelWidth } from '../ui/room';
import { useIsMobile } from '../ui/useBreakpoint';
import { SPRING } from '../ui/motion';
import { setCodeWidth, useUi } from '../ui/uiStore';

const CodePanel = lazyWithRetry(() => import('../panels/CodePanel').then((m) => ({ default: m.CodePanel })));

/** The docked code panel: slides open from the sidebar's edge and keeps its width while it animates. */
export function CodeDock() {
  const open = useUi((s) => s.codeOpen);
  const savedWidth = useUi((s) => s.codeWidth);
  const dock = useDockOpen();
  const dockWidth = useUi(s => s.dockWidth);
  const sidebar = useUi(s => s.sidebarOpen);
  const sidebarWidth = useUi(s => s.sidebarWidth);
  const mobile = useIsMobile();
  const [viewport, setViewport] = useState(() => window.innerWidth);
  useEffect(() => { const resize = () => setViewport(window.innerWidth); window.addEventListener('resize',resize); return () => window.removeEventListener('resize',resize); }, []);
  const reserved = dock && !mobile ? dockPanelWidth(viewport,dockWidth) : 0;
  const floating = mobile || codeShouldFloat(viewport,savedWidth,reserved);
  const left = !mobile && sidebar ? sidebarWidth + 12 : 12;
  const width = floating ? Math.max(0,Math.min(savedWidth,viewport-left-reserved-12)) : Math.min(savedWidth,viewport-reserved-CANVAS_MIN);

  const [dragging, setDragging] = useState(false);
  return (
    <AnimatePresence initial={false}>
      {open && (
        <m.div
          key="code"
          className={`pointer-events-none flex shrink-0 overflow-hidden ${floating ? "absolute bottom-3 z-40 h-[min(52dvh,480px)] rounded-panel border border-line shadow-pop" : "relative h-full pt-(--sk-header-height)"}`}
          style={floating ? {left} : undefined}
          initial={{ width: 0, opacity: 0.4 }}
          animate={{ width, opacity: 1 }}
          exit={{ width: 0, opacity: 0.4 }}
          transition={dragging ? { duration: 0 } : SPRING}
        >
          <div className="sk-code-dock pointer-events-auto relative flex h-full flex-none flex-col overflow-hidden border-r border-line bg-panel" style={{ width }}>
            <ChunkBoundary fill>
              <Suspense fallback={null}>
                <CodePanel />
              </Suspense>
            </ChunkBoundary>
            {!floating && <PanelDivider label={uiText("Redimensionar código")} side="right" value={width} min={CODE_WIDTH.min} max={Math.max(CODE_WIDTH.min, Math.min(CODE_WIDTH.max, window.innerWidth - CODE_WIDTH.canvasRoom))} initial={CODE_WIDTH.initial} onChange={setCodeWidth} onDragging={setDragging} />}
          </div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
