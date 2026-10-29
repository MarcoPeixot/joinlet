import { AnimatePresence, m } from 'motion/react';
import { Slot } from 'radix-ui';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { Keys } from './Kbd';
import { EASE_OUT } from './motion';
import { placeTooltip } from './tooltipPlacement';
import type { TooltipSide } from './tooltipPlacement';
import { useUi } from './uiStore';

interface TooltipProps {
  content: ReactNode;
  shortcut?: string | null;
  side?: TooltipSide;
  children: ReactElement;
}

/** The first tooltip waits a beat; within WARM_MS of another one it follows at once. */
const DELAY_MS = 500;
const WARM_MS = 300;
/** Leaving a trigger keeps the bubble this long, so moving to the next one travels instead of closing. */
const GRACE_MS = 80;
const TOOLTIP_ID = 'sk-tooltip';

interface Tip {
  key: string;
  anchor: HTMLElement;
  content: ReactNode;
  shortcut?: string | null;
  side: TooltipSide;
  /** Shown without the pop: it followed another tooltip that had just closed. */
  warm: boolean;
}

const tooltips = createStore<{ tip: Tip | null; closedAt: number }>()(() => ({ tip: null, closedAt: -Infinity }));
let opening: { key: string; timer: ReturnType<typeof setTimeout> } | null = null;
let closing: ReturnType<typeof setTimeout> | undefined;

function cancelOpening(key?: string) {
  if (!opening || (key && opening.key !== key)) return;
  clearTimeout(opening.timer);
  opening = null;
}

function show(next: Omit<Tip, 'warm'>) {
  clearTimeout(closing);
  cancelOpening();
  const { tip, closedAt } = tooltips.getState();
  if (tip) return tooltips.setState({ tip: { ...next, warm: true } });
  if (performance.now() - closedAt < WARM_MS) return tooltips.setState({ tip: { ...next, warm: true } });
  opening = { key: next.key, timer: setTimeout(() => { opening = null; tooltips.setState({ tip: { ...next, warm: false } }); }, DELAY_MS) };
}

function hide(key: string, instant = false) {
  cancelOpening(key);
  if (tooltips.getState().tip?.key !== key) return;
  clearTimeout(closing);
  const close = () => { if (tooltips.getState().tip?.key === key) tooltips.setState({ tip: null, closedAt: performance.now() }); };
  if (instant) close();
  else closing = setTimeout(close, GRACE_MS);
}

/**
 * Label plus the shortcut as key caps, in the one bubble the app shares (TooltipLayer): it pops in with a short
 * blur the first time, then glides from trigger to trigger, its text sliding over. A click silences it until the
 * pointer leaves: otherwise a hover timer started before the click would pop it up afterwards.
 */
export function Tooltip({ content, shortcut, side = 'bottom', children }: TooltipProps) {
  const key = useId();
  const anchor = useRef<HTMLElement>(null);
  const silenced = useRef(false);
  const active = useStore(tooltips, (s) => s.tip?.key === key);
  const open = () => { if (anchor.current && !silenced.current) show({ key, anchor: anchor.current, content, shortcut, side }); };
  const silence = () => { silenced.current = true; hide(key, true); };
  // A label that changes while it is shown (a toggle's state) updates in place; an unmounted trigger takes it away.
  useEffect(() => {
    if (!active) return;
    const tip = tooltips.getState().tip;
    if (tip && (tip.content !== content || tip.shortcut !== shortcut)) tooltips.setState({ tip: { ...tip, content, shortcut } });
  }, [active, content, shortcut]);
  useEffect(() => () => hide(key, true), [key]);
  return (
    <Slot.Root
      ref={anchor}
      aria-describedby={active ? TOOLTIP_ID : undefined}
      onPointerEnter={(event) => { if (event.pointerType !== 'touch') open(); }}
      onPointerLeave={() => { silenced.current = false; hide(key); }}
      onPointerDown={silence}
      onClick={silence}
      onFocus={(event) => { if (event.currentTarget.matches(':focus-visible')) open(); }}
      // Only when focus moves on inside the page: a download or a window switch blurs it and comes back.
      onBlur={(event) => { if (event.relatedTarget) silenced.current = false; hide(key, true); }}
    >
      {children}
    </Slot.Root>
  );
}

const ORIGIN: Record<TooltipSide, string> = { top: '50% 100%', bottom: '50% 0%', left: '100% 50%', right: '0% 50%' };
const RISE: Record<TooltipSide, { x: number; y: number }> = { top: { x: 0, y: 4 }, bottom: { x: 0, y: -4 }, left: { x: 4, y: 0 }, right: { x: -4, y: 0 } };
const TRAVEL = { type: 'spring', duration: 0.32, bounce: 0.1 } as const;
const POP = { duration: 0.16, ease: EASE_OUT };
const LABEL = 'flex items-center gap-2 whitespace-nowrap px-2 py-1 text-caption font-medium';

function Label({ tip }: { tip: Tip }) {
  return <>{tip.content}{tip.shortcut && <Keys combo={tip.shortcut} className="sk-tooltip__keys" />}</>;
}

/** The single tooltip bubble, mounted once by App: Escape, scrolling and resizing put it away. */
export function TooltipLayer() {
  const tip = useStore(tooltips, (s) => s.tip);
  const reduceSetting = useUi((s) => s.reduceMotion);
  const reduce = reduceSetting || !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const measure = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{ x: number; y: number; w: number; h: number; side: TooltipSide } | null>(null);
  /** Which way the text slides: the way the pointer travelled between triggers. */
  const [direction, setDirection] = useState(1);
  const lastAnchor = useRef<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    if (!tip || !measure.current) { setPlaced(null); lastAnchor.current = null; return; }
    const box = tip.anchor.getBoundingClientRect();
    const size = { w: Math.ceil(measure.current.offsetWidth), h: Math.ceil(measure.current.offsetHeight) };
    const at = placeTooltip({ x: box.x, y: box.y, w: box.width, h: box.height }, size, tip.side, { w: innerWidth, h: innerHeight });
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const previous = lastAnchor.current;
    if (previous) setDirection((at.side === 'left' || at.side === 'right' ? center.y - previous.y : center.x - previous.x) < 0 ? -1 : 1);
    lastAnchor.current = center;
    setPlaced({ ...at, ...size });
  }, [tip]);

  useEffect(() => {
    if (!tip) return;
    const away = () => hide(tip.key, true);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') away(); };
    addEventListener('keydown', onKey, true);
    addEventListener('scroll', away, true);
    addEventListener('resize', away);
    return () => { removeEventListener('keydown', onKey, true); removeEventListener('scroll', away, true); removeEventListener('resize', away); };
  }, [tip]);

  const shown = tip && placed ? { tip, placed } : null;
  const rise = shown && !reduce ? RISE[shown.placed.side] : { x: 0, y: 0 };
  const axis = shown && (shown.placed.side === 'left' || shown.placed.side === 'right') ? 'y' : 'x';
  const blur = (px: number) => (reduce ? 'blur(0px)' : `blur(${px}px)`);
  return (
    <>
      {tip && <div ref={measure} aria-hidden className={`${LABEL} pointer-events-none invisible fixed left-0 top-0`}><Label tip={tip} /></div>}
      <AnimatePresence>
        {shown && (
          <m.div
            key="bubble"
            className="sk-tooltip pointer-events-none fixed left-0 top-0 z-[70] overflow-hidden rounded-[7px]"
            style={{ transformOrigin: ORIGIN[shown.placed.side] }}
            initial={shown.tip.warm ? false : { x: shown.placed.x + rise.x, y: shown.placed.y + rise.y, width: shown.placed.w, height: shown.placed.h, opacity: 0, scale: reduce ? 1 : 0.94, filter: blur(4) }}
            animate={{ x: shown.placed.x, y: shown.placed.y, width: shown.placed.w, height: shown.placed.h, opacity: 1, scale: 1, filter: blur(0) }}
            exit={{ opacity: 0, scale: reduce ? 1 : 0.97, filter: blur(2), transition: { duration: 0.13, ease: EASE_OUT } }}
            transition={reduce ? { duration: 0 } : { x: TRAVEL, y: TRAVEL, width: TRAVEL, height: TRAVEL, default: POP }}
          >
            <AnimatePresence initial={false} mode="popLayout" custom={direction}>
              <m.div
                key={shown.tip.key}
                id={TOOLTIP_ID}
                role="tooltip"
                className={`${LABEL} absolute left-0 top-0`}
                custom={direction}
                variants={{
                  enter: (d: number) => ({ opacity: 0, [axis]: reduce ? 0 : 10 * d, filter: blur(3) }),
                  center: { opacity: 1, x: 0, y: 0, filter: blur(0) },
                  leave: (d: number) => ({ opacity: 0, [axis]: reduce ? 0 : -10 * d, filter: blur(3) }),
                }}
                initial="enter"
                animate="center"
                exit="leave"
                transition={{ duration: reduce ? 0 : 0.14, ease: EASE_OUT }}
              >
                <Label tip={shown.tip} />
              </m.div>
            </AnimatePresence>
          </m.div>
        )}
      </AnimatePresence>
    </>
  );
}
