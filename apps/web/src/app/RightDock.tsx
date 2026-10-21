import { uiText } from '../i18n';
import { m } from 'motion/react';
import { useEffect, useState } from 'react';
import { setDockTarget, useDockOpen } from '../ui/dock';
import { useIsMobile } from '../ui/useBreakpoint';
import { dockMaxWidth, dockPanelWidth } from '../ui/room';
import { SPRING } from '../ui/motion';
import { PanelDivider } from '../ui/PanelDivider';
import { setDockWidth, useUi } from '../ui/uiStore';

/** A reserved, resizable column: the canvas and the chat never cover one another. */
export function RightDock() {
  const mobile = useIsMobile();
  const open = useDockOpen() && !mobile;
  const savedWidth = useUi(s => s.dockWidth);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => { const resize = () => setViewportWidth(window.innerWidth); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  const max = dockMaxWidth(viewportWidth);
  const width = dockPanelWidth(viewportWidth,savedWidth);
  const [dragging, setDragging] = useState(false);
  return <m.div role={open ? 'region' : undefined} aria-label={open ? uiText("Área de painéis") : undefined} initial={false} animate={{ width: open ? width : 0 }} transition={dragging || mobile ? { duration: 0 } : SPRING} className="sk-right-dock relative h-full shrink-0 overflow-hidden">
    <div ref={setDockTarget} className="relative h-full" style={{ width }} />
    {open && <PanelDivider label={uiText("Redimensionar painel lateral")} side="left" value={width} min={320} max={max} initial={384} onChange={setDockWidth} onDragging={setDragging} />}
  </m.div>;
}
