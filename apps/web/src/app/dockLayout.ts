import { useReactFlow } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import { fitOptionsFor } from '../canvas/fit';
import { boundsFitViewport } from '../canvas/fitView';
import { useDockOpen } from '../ui/dock';
import { sidebarShouldYield, codeShouldFloat, dockPanelWidth } from '../ui/room';
import { uiStore, useUi } from '../ui/uiStore';
import { useIsMobile } from '../ui/useBreakpoint';

/** The dock's spring has settled by now; the canvas is re-framed once, not on every frame of the resize. */
const SETTLE_MS = 360;

/**
 * While a right-slot panel is open on a window too narrow for it, the sidebar steps aside (not saved: the visitor's
 * preference is untouched) and comes back when the panel closes, unless the visitor moved it in between.
 */
export function useSidebarYield(): void {
  const mobile = useIsMobile();
  const dock = useDockOpen() && !mobile;
  const sidebarWidth = useUi(s => s.sidebarWidth);
  const dockWidth = useUi(s => s.dockWidth);
  const codeOpen = useUi((s) => s.codeOpen);
  const codeWidth = useUi(s => s.codeWidth);
  const yielded = useRef(false);
  useEffect(() => {
    const check = () => {
      const ui = uiStore.getState();
      const docked = { sidebar: ui.sidebarOpen, code: ui.codeOpen ? ui.codeWidth : null, dock, sidebarWidth, dockWidth };
      const reserved = dock ? dockPanelWidth(window.innerWidth,dockWidth) : 0;
      const floatingCode = mobile || codeShouldFloat(window.innerWidth,ui.codeWidth,reserved);
      const needsRoom = !mobile && sidebarShouldYield(window.innerWidth,{...docked,sidebar:true,code:floatingCode?null:docked.code,dockWidth:reserved});
      if (needsRoom && ui.sidebarOpen) {
        yielded.current = true;
        uiStore.setState({ sidebarOpen: false });
      } else if (!needsRoom && yielded.current) {
        yielded.current = false;
        if (!ui.sidebarOpen) uiStore.setState({ sidebarOpen: true });
      }
    };
    check(); window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [dock, codeOpen, codeWidth, sidebarWidth, dockWidth, mobile]);
}

const pane = () => document.querySelector('.react-flow')?.getBoundingClientRect();

/**
 * Opening or closing the dock resizes the canvas. A diagram that was entirely in view stays entirely in view (re-fitted
 * once the dock settles); one the person had zoomed into or panned keeps its place, shifted by half of the change so
 * what was at the centre stays at the centre. Never a refit under someone who is navigating.
 */
export function useDockViewport(): void {
  const flow = useReactFlow();
  const mobile = useIsMobile();
  const open = useDockOpen();
  const last = useRef(open);
  useEffect(() => {
    if (last.current === open) return;
    last.current = open;
    const before = pane();
    if (mobile || !before) return;
    const nodes = flow.getNodes();
    const box = nodes.length ? flow.getNodesBounds(nodes) : null;
    const bounds = box && { x: box.x, y: box.y, w: box.width, h: box.height };
    const view = flow.getViewport();
    const fitted = boundsFitViewport(bounds, [view.x, view.y, view.zoom], before.width, before.height);
    const timer = setTimeout(() => {
      const after = pane();
      if (!after || after.width === before.width) return;
      if (fitted) void flow.fitView({ ...fitOptionsFor(false, uiStore.getState().fitInsetBottom, after.width), duration: 220 });
      else {
        const now = flow.getViewport();
        void flow.setViewport({ ...now, x: now.x + (after.width - before.width) / 2 }, { duration: 220 });
      }
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [open, mobile, flow]);
}
