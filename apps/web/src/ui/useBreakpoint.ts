import { useSyncExternalStore } from 'react';

export const MOBILE_QUERY = '(max-width: 639px)';

/** True below Tailwind's `sm`; false where there is no `matchMedia` (SSR, tests). */
export function isMobileViewport(): boolean {
  try {
    return globalThis.matchMedia?.(MOBILE_QUERY).matches ?? false;
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  let query: MediaQueryList | undefined;
  try {
    query = globalThis.matchMedia?.(MOBILE_QUERY);
  } catch {
    query = undefined;
  }
  query?.addEventListener?.('change', onChange);
  return () => query?.removeEventListener?.('change', onChange);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobileViewport, () => false);
}
