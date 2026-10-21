/**
 * Detects "a version just landed" (the top of the list changed after a load) and holds the flag for `ms`.
 * The clearing timer belongs to the tracker, not to a React effect: a re-render inside the window must never cancel it.
 */
export function createJustSaved(onChange: (saved: boolean) => void, ms: number) {
  let seen: { slug: string | null; loaded: boolean; topId: string | undefined } = { slug: null, loaded: false, topId: undefined };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saved = false;
  const set = (next: boolean) => {
    if (saved === next) return;
    saved = next;
    onChange(next);
  };
  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    observe(slug: string | null, status: string, topId: string | undefined) {
      if (seen.slug !== slug) {
        seen = { slug, loaded: false, topId: undefined };
        stop();
        set(false);
      }
      if (status !== 'idle') return;
      const grew = seen.loaded && topId !== seen.topId;
      seen = { slug, loaded: true, topId };
      if (!grew) return;
      stop();
      // A second save inside the window restarts it.
      set(true);
      timer = setTimeout(() => set(false), ms);
    },
    /** Unmount: no timer left behind, and the flag drops. */
    dispose() {
      stop();
      set(false);
    },
  };
}
