import { Tooltip as RTooltip } from 'radix-ui';
import { useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Keys } from './Kbd';

interface TooltipProps {
  content: ReactNode;
  shortcut?: string | null;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactElement;
}

/**
 * Label plus the shortcut as key caps; the first one waits a beat, the next ones follow instantly. A click
 * silences it until the pointer leaves: otherwise a hover timer started before the click would pop it up
 * afterwards, and it would then take the next Escape meant for the dialog around it.
 */
export function Tooltip({ content, shortcut, side = 'bottom', children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const silenced = useRef(false);
  const silence = () => {
    silenced.current = true;
    setOpen(false);
  };
  return (
    <RTooltip.Root open={open} onOpenChange={(next) => setOpen(next && !silenced.current)}>
      <RTooltip.Trigger
        asChild
        onPointerDown={silence}
        onClick={silence}
        onPointerLeave={() => (silenced.current = false)}
        // Only when focus moves on inside the page: a download or a window switch blurs it and comes back.
        onBlur={(event) => {
          if (event.relatedTarget) silenced.current = false;
        }}
      >
        {children}
      </RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={7}
          collisionPadding={8}
          className="sk-tooltip z-[70] flex items-center gap-2 rounded-[7px] px-2 py-1 text-caption font-medium"
        >
          {content}
          {shortcut && <Keys combo={shortcut} className="sk-tooltip__keys" />}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}
