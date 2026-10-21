import { m } from 'motion/react';
import type { ReactNode } from 'react';
import { slideFrom } from './motion';

/**
 * The mobile form of the canvas's right slot: a non-modal sheet docked to the bottom (at most 45 vh) with a
 * grab handle. No scrim: the canvas above it stays visible and takes touches.
 */
export function BottomSheet({ label, className = '', children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <m.aside
      aria-label={label}
      data-bottom-sheet=""
      className={`sk-float absolute inset-x-2 bottom-2 z-40 flex max-h-[45dvh] flex-col overflow-hidden rounded-panel ${className}`}
      {...slideFrom('bottom', 24)}
    >
      <div aria-hidden className="flex h-4 shrink-0 touch-none items-center justify-center">
        <span className="h-1 w-9 rounded-full bg-line-strong" />
      </div>
      {children}
    </m.aside>
  );
}
