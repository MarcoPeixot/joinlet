import { uiText } from '../i18n';
import { FileText, GitCommitHorizontal, PanelsTopLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { hoverCardInfo } from '../diagram/hoverCard';
import type { HoverCardInfo } from '../diagram/hoverCard';
import { diagramStore } from '../state/appStore';
import { pluralize } from '../ui/plural';
import { uiStore, useUi } from '../ui/uiStore';

const DELAY_MS = 400;
const FINE_POINTER = '(hover: hover) and (pointer: fine)';
const WIDTH = 248;

/** The card never shows while the canvas is frozen or presenting (it would sit above the presentation bar). */
export const hoverBlocked = (ui: { frozen: unknown; presenting: boolean }): boolean => Boolean(ui.frozen) || ui.presenting;

interface Shown {
  info: HoverCardInfo;
  left: number;
  top: number;
}

/**
 * A small context card after the pointer rests on a node (tech, description, link, connections). A sibling overlay
 * fed by delegated listeners on the canvas wrapper: no node re-renders, no transform on the node, and it lives in
 * component state so the canvas never re-renders. Fine pointers only; it hides on press, drag, wheel and leave.
 * `aria-hidden`: the Inspector and the node's accessible name carry the same information.
 */
export function NodeHoverCard() {
  const host = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const presenting = useUi((s) => s.presenting);

  useEffect(() => {
    const root = host.current?.parentElement;
    if (!root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: Element | null = null;
    let pressed = false;
    const hide = () => {
      clearTimeout(timer);
      current = null;
      setShown(null);
    };
    const nodeOf = (target: EventTarget | null) => (target instanceof Element ? target.closest('.react-flow__node') : null);
    const onOver = (event: PointerEvent) => {
      const node = nodeOf(event.target);
      if (node === current) return;
      hide();
      if (!node || pressed || event.pointerType !== 'mouse' || !globalThis.matchMedia?.(FINE_POINTER).matches) return;
      current = node;
      timer = setTimeout(() => {
        const id = (node as HTMLElement).dataset.id;
        if (!id || hoverBlocked(uiStore.getState()) || !node.isConnected) return;
        const info = hoverCardInfo(diagramStore.getState().model, id);
        if (!info) return;
        const box = node.getBoundingClientRect();
        const bounds = root.getBoundingClientRect();
        // Beside the node (an icon node's label hangs under its box): on the right, or the left when it does not fit.
        const fitsRight = box.right + 12 + WIDTH <= bounds.right - 8;
        setShown({
          info,
          left: fitsRight ? box.right - bounds.left + 12 : Math.max(8, box.left - bounds.left - 12 - WIDTH),
          top: Math.max(8, Math.min(box.top - bounds.top, bounds.height - 160)),
        });
      }, DELAY_MS);
    };
    const onDown = () => {
      pressed = true;
      hide();
    };
    const onUp = () => {
      pressed = false;
    };
    root.addEventListener('pointerover', onOver);
    root.addEventListener('pointerleave', hide);
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('wheel', hide, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      clearTimeout(timer);
      root.removeEventListener('pointerover', onOver);
      root.removeEventListener('pointerleave', hide);
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('wheel', hide);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  return (
    <div ref={host} aria-hidden data-testid="node-hover-card-host">
      {shown && !presenting && (
        <div
          data-testid="node-hover-card"
          className="sk-pop sk-elev-2 pointer-events-none absolute z-40 flex flex-col gap-1.5 rounded-panel p-3 text-caption"
          style={{ left: shown.left, top: shown.top, width: WIDTH, animation: 'sk-fade-in var(--sk-motion) var(--sk-ease)' }}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-body font-semibold">{shown.info.title}</span>
            {shown.info.tech && <span className="flex-none font-mono text-meta text-muted">{shown.info.tech}</span>}
          </div>
          {shown.info.excerpt && <p className="text-muted">{shown.info.excerpt}</p>}
          <div className="flex items-center gap-3 text-meta text-muted">
            <span className="inline-flex items-center gap-1">
              <GitCommitHorizontal size={12} strokeWidth={1.5} />
              {pluralize(shown.info.connections, uiText("conexão"), uiText("conexões"), 'f')}
            </span>
            {shown.info.link && (
              <span className="inline-flex items-center gap-1 text-accent">
                {shown.info.link === 'diagram' ? <PanelsTopLeft size={12} strokeWidth={1.5} /> : <FileText size={12} strokeWidth={1.5} />}
                {shown.info.link === 'diagram' ? uiText("Diagrama") : uiText("Documento")}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
