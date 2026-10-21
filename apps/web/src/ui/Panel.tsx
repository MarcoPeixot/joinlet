import { uiText } from '../i18n';
import { X } from 'lucide-react';
import { m } from 'motion/react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';
import { IconButton } from './IconButton';
import { BottomSheet } from './BottomSheet';
import { dockStore, enterDock } from './dock';
import { EASE_OUT, slideFrom } from './motion';
import { PANEL_WIDTH } from './room';
import { useIsMobile } from './useBreakpoint';

/** Swapping one panel for another keeps the frame still and cross-fades the content (no slide, no layout jump). */
const SWAP = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.16, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: EASE_OUT } },
};

/** How many side panels are mounted (an exiting one still counts): a newcomer while one is up is a swap. */
let mounted = 0;

function useIsSwap(): boolean {
  const [swap] = useState(() => mounted > 0);
  useEffect(() => {
    mounted += 1;
    return () => {
      mounted -= 1;
    };
  }, []);
  return swap;
}

/**
 * The canvas's right slot (Versões, Chat, Modelo…): a column of one width (`PANEL_WIDTH`) that slides in from the right
 * edge; a bottom sheet on mobile. It renders into the right dock beside the canvas, so the canvas gives up the room;
 * `overlay` (Propriedades, which follows the selection) floats over the canvas instead, so it never makes it jump.
 */
export function SidePanel({ label, className = '', overlay = false, children }: { label: string; className?: string; overlay?: boolean; children: ReactNode }) {
  const mobile = useIsMobile();
  const swap = useIsSwap();
  const target = useStore(dockStore, (s) => s.target);
  const dock = !overlay && !mobile ? target : null;
  useEffect(() => (dock ? enterDock() : undefined), [dock]);
  if (mobile) return <BottomSheet label={label} className={className}>{children}</BottomSheet>;
  const card = (
    <m.aside
      aria-label={label}
      className={`absolute top-[calc(var(--sk-chrome-bottom,var(--sk-header-height))+12px)] z-20 flex flex-col overflow-hidden sk-float bottom-3 right-3 rounded-panel ${dock ? 'sk-docked-panel' : ''} ${className}`}
      style={{ width: dock ? 'calc(100% - 8px)' : PANEL_WIDTH }}
      {...(swap ? SWAP : { ...slideFrom('right'), exit: SWAP.exit })}
    >
      {children}
    </m.aside>
  );
  return dock ? createPortal(card, dock) : card;
}

interface PanelHeaderProps {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
}

export function PanelHeader({ icon, title, subtitle, actions, onClose, closeLabel = uiText("Fechar") }: PanelHeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 pl-3.5 pr-1.5">
      {icon && <span className="flex h-6 w-6 flex-none items-center justify-center rounded-chip bg-accent-soft text-accent">{icon}</span>}
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="truncate text-title font-semibold leading-tight">{title}</h2>
        {subtitle && <p className="truncate text-meta text-muted">{subtitle}</p>}
      </div>
      {actions}
      {onClose && (
        <IconButton label={closeLabel} onClick={onClose}>
          <X />
        </IconButton>
      )}
    </header>
  );
}

/** A titled group inside a panel (Identidade, Conteúdo, Aparência…). */
export function PanelSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 px-3.5 py-3.5">
      {title && <h3 className="sk-label">{title}</h3>}
      {children}
    </section>
  );
}
