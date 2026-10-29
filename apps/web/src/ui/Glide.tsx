import { useEffect, useRef } from 'react';

/**
 * The glide (from Nora's web app): ONE highlight per list that slides to the row under the pointer (or the
 * keyboard focus), instead of every row lighting up on its own. Drop it inside a positioned container and name
 * its rows; the highlight follows them. It measures relative to its host, plus the host's scroll, so it works
 * inside scrolling lists. The first placement only fades in (sliding in from where it last was reads as a
 * glitch); every move after that glides. A destructive row (`data-danger`) tints it.
 */
export function Glide({ items }: { items: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const cursor = ref.current;
    const host = cursor?.parentElement;
    if (!cursor || !host) return;
    let shown = false;

    const place = (row: HTMLElement) => {
      const hostRect = host.getBoundingClientRect();
      const rect = row.getBoundingClientRect();
      const x = rect.left - hostRect.left + host.scrollLeft - host.clientLeft;
      const y = rect.top - hostRect.top + host.scrollTop - host.clientTop;
      // Arrive in place: fade only, no slide from the last position.
      if (!shown) cursor.style.transition = 'opacity 180ms ease';
      cursor.style.transform = `translate(${x}px, ${y}px)`;
      cursor.style.width = `${rect.width}px`;
      cursor.style.height = `${rect.height}px`;
      cursor.dataset.tone = row.hasAttribute('data-danger') ? 'danger' : '';
      if (!shown) {
        void cursor.offsetWidth;
        cursor.style.transition = '';
        shown = true;
      }
      cursor.dataset.visible = '';
    };
    const hide = () => {
      shown = false;
      delete cursor.dataset.visible;
    };
    const follow = (event: Event) => {
      const row = (event.target as Element | null)?.closest?.(items) as HTMLElement | null;
      if (!row || !host.contains(row) || row.matches(':disabled, [aria-disabled="true"], [data-disabled]')) return;
      place(row);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!host.contains(event.relatedTarget as Node | null) && !host.matches(':hover')) hide();
    };

    host.addEventListener('pointerover', follow);
    host.addEventListener('focusin', follow);
    host.addEventListener('pointerleave', hide);
    host.addEventListener('focusout', onFocusOut);
    return () => {
      host.removeEventListener('pointerover', follow);
      host.removeEventListener('focusin', follow);
      host.removeEventListener('pointerleave', hide);
      host.removeEventListener('focusout', onFocusOut);
    };
  }, [items]);

  return <span ref={ref} className="sk-glide" aria-hidden="true" role="presentation" />;
}
