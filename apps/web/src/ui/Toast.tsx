import { AnimatePresence, m } from 'motion/react';
import { useEffect, useRef } from 'react';
import { SPRING } from './motion';
import type { ToastAction } from './uiStore';
import { pauseToast, resumeToast, runToastAction, uiStore, useUi } from './uiStore';

export function ToastBody({ message, action, actionRef }: { message: string; action: ToastAction | null; actionRef?: React.Ref<HTMLButtonElement> }) {
  return (
    <>
      <span>{message}</span>
      {action && (
        <button ref={actionRef} type="button" className="-my-1 rounded-full px-2 py-1 font-semibold underline underline-offset-2 hover:opacity-80" onClick={runToastAction}>
          {action.label}
        </button>
      )}
    </>
  );
}

/** Bottom centre, above the AI composer; springs up, fades out. */
export function Toast() {
  const message = useUi((s) => s.toast);
  const action = useUi((s) => s.toastAction);
  const focusRequest = useUi((s) => s.toastFocusRequest);
  const ms = useUi((s) => s.toastMs);
  const paused = useUi((s) => s.toastPaused);
  const id = useUi((s) => s.toastId);
  const button = useRef<HTMLButtonElement>(null);
  const focusInside = useRef(false);
  const hovered = useRef(false);

  // A replaced toast is a new element and the old one never reports leaving, so forget pointer/focus state
  // (declared first: it must run before the focus effects of the same commit). A pointer still resting on the new
  // toast is not paused until it moves (`pointerenter`); the 3.5 s plain toast is short and the state cannot go stale.
  useEffect(() => {
    if (!message) return;
    hovered.current = false;
    focusInside.current = false;
  }, [message]);

  // Keyboard-triggered deletes hand focus to "Desfazer".
  useEffect(() => {
    if (focusRequest > 0 && uiStore.getState().toastAction) button.current?.focus();
  }, [focusRequest]);

  // The toast (and the button that had focus) is gone: focus returns to the workspace list instead of <body>.
  useEffect(() => {
    if (message) return;
    hovered.current = false; // no pointerleave fires for a removed element
    if (!focusInside.current) return;
    focusInside.current = false;
    document.querySelector<HTMLElement>('nav[aria-label="Workspace"] button')?.focus();
  }, [message]);

  const sync = () => (hovered.current || focusInside.current ? pauseToast() : resumeToast());
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-16 z-[60] flex justify-center px-4">
      <AnimatePresence>
        {message && (
          <m.div
            key={message}
            role={action ? 'alert' : 'status'}
            onPointerEnter={() => { hovered.current = true; sync(); }}
            onPointerLeave={() => { hovered.current = false; sync(); }}
            onFocus={() => { focusInside.current = true; sync(); }}
            onBlur={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              focusInside.current = false;
              sync();
            }}
            className="pointer-events-auto relative flex max-w-[520px] items-center gap-3 overflow-hidden rounded-full bg-(--sk-tooltip-bg) px-4 py-2 text-body font-medium text-(--sk-tooltip-ink) shadow-pop"
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: SPRING }}
            exit={{ opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.14 } }}
          >
            <ToastBody message={message} action={action} actionRef={button} />
            {/* Time left, frozen while the timer is held (hover/focus); decorative. */}
            <span
              key={id}
              aria-hidden
              data-testid="toast-progress"
              className="sk-toast-bar"
              style={{ animationDuration: `${ms}ms`, animationPlayState: paused ? 'paused' : 'running' }}
            />
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
