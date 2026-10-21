export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
}

const CONTROLS = 'button, a[href], [role="button"], [role="option"], [role="listbox"], [role="menu"], [role="dialog"]';

/**
 * What a key does for the comment tool of the canvas: `C` turns it on and off (unless you are typing or on a control),
 * Escape turns it off while it is on. `null` when the key is none of its business.
 */
export function commentKey(event: KeyEventLike, tool: boolean): 'toggle' | 'off' | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const el = event.target as HTMLElement | null;
  const typing = !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
  if (event.key === 'Escape') return tool ? 'off' : null;
  if (event.key.toLowerCase() !== 'c' || event.shiftKey || typing) return null;
  const control = !!el && (['BUTTON', 'A', 'SUMMARY'].includes(el.tagName) || !!el.closest?.(CONTROLS));
  return control ? null : 'toggle';
}
