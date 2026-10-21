import { uiText } from '../i18n';
import { X } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { Dialog } from 'radix-ui';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { EASE_OUT } from './motion';
import { IconButton } from './IconButton';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name (and the header title unless `title` says otherwise). */
  label: string;
  title?: ReactNode;
  icon?: ReactNode;
  /** Header buttons, left of the close button. */
  actions?: ReactNode;
  /** Label of the close button; `null` hides the header's close button. */
  closeLabel?: string | null;
  width?: number;
  /** `top` for quick prompts (command palette, save version); `center` for documents. */
  placement?: 'center' | 'top';
  /** No header: the children draw their own (the command palette's search field). */
  bare?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * The app's dialog: blurred backdrop, focus trapped and returned, Escape and outside click close it. The
 * body stays mounted while it animates out.
 */
export function Modal({ open, onClose, label, title, icon, actions, closeLabel = uiText("Fechar"), width = 760, placement = 'center', bare, className = '', children }: ModalProps) {
  // Escape closes the dialog even while a tooltip inside it is showing (Radix would dismiss only the tooltip);
  // an open popover or menu inside it (a model picker) takes that Escape for itself.
  // Whoever had focus when it opened gets it back (or the canvas when that was nothing): the layout effect runs
  // before Radix's own focus move, and Radix alone loses the place when the opener was the page body.
  const opener = useRef<Element | null>(null);
  useLayoutEffect(() => {
    if (open) opener.current = document.activeElement;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if ((document.activeElement as HTMLElement | null)?.closest('[data-inline-picker]')) return;
      if (document.querySelector('[data-radix-popper-content-wrapper] [role="dialog"], [data-radix-popper-content-wrapper] [role="menu"]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <m.div
                className="fixed inset-0 z-50 bg-(--sk-overlay)"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.18, ease: EASE_OUT } }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
              />
            </Dialog.Overlay>
            {/* Only a click outside or Escape closes it: a dialog closing as this one opens (⌘K → "Gerar
                documentação") hands focus back outside, and that must not dismiss the new one. */}
            {/* Focus lands on the dialog itself (not its first button, whose tooltip would pop up) unless a
                field inside asks for it with autoFocus. */}
            <Dialog.Content
              asChild
              forceMount
              aria-describedby={undefined}
              onFocusOutside={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                // Another dialog opened as this one closed (⌘K → "Gerar documentação"): it keeps the focus.
                if (document.activeElement?.closest('[role="dialog"]')) return;
                const back = opener.current;
                const target = back?.isConnected && back !== document.body ? back : document.getElementById('canvas');
                (target as HTMLElement | null)?.focus();
              }}
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                (event.currentTarget as HTMLElement).focus();
              }}
            >
              <m.div
                className={`sk-pop fixed left-1/2 z-50 flex max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col overflow-hidden rounded-panel outline-none ${
                  placement === 'top' ? 'top-[14vh] max-h-[72vh]' : 'top-1/2 max-h-[calc(100vh-48px)] -translate-y-1/2'
                } ${className}`}
                style={{ width }}
                initial={{ opacity: 0, scale: 0.97, y: placement === 'top' ? -6 : 6 }}
                animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: 0.22, ease: EASE_OUT } }}
                exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12, ease: EASE_OUT } }}
              >
                {bare ? (
                  <Dialog.Title className="sr-only">{label}</Dialog.Title>
                ) : (
                  <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line pl-4 pr-2">
                    {icon && <span className="flex text-accent">{icon}</span>}
                    <Dialog.Title className="truncate text-title font-semibold">{title ?? label}</Dialog.Title>
                    <div className="ml-auto flex items-center gap-0.5">
                      {actions}
                      {closeLabel && (
                        <Dialog.Close asChild>
                          <IconButton label={closeLabel}>
                            <X />
                          </IconButton>
                        </Dialog.Close>
                      )}
                    </div>
                  </div>
                )}
                {children}
              </m.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
