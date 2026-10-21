import { Popover as RPopover } from 'radix-ui';
import type { ComponentProps, ReactElement, ReactNode } from 'react';

interface PopoverProps {
  /** The trigger element (an `IconButton`, a `Button`…); it receives the ref and the open/close props. */
  trigger: ReactElement;
  /** Accessible name of the popover dialog. */
  label: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  className?: string;
  children: ReactNode;
  onCloseAutoFocus?: ComponentProps<typeof RPopover.Content>['onCloseAutoFocus'];
}

/** A card that grows out of its trigger; Escape, an outside click or the trigger closes it. */
export function Popover({ trigger, label, open, onOpenChange, side = 'bottom', align = 'center', className = '', children, onCloseAutoFocus }: PopoverProps) {
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange}>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          aria-label={label}
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={12}
          onCloseAutoFocus={onCloseAutoFocus}
          className={`sk-pop sk-elev-2 sk-anim-pop z-[60] rounded-panel outline-none ${className}`}
          style={{ transformOrigin: 'var(--radix-popover-content-transform-origin)' }}
        >
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}
