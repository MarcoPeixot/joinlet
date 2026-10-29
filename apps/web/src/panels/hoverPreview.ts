/**
 * Hovering the Inspector's connections previews each on the canvas. Leaving a row clears the preview only after
 * `grace` ms, and entering another within that time takes over at once: moving down the list goes straight from one
 * preview to the next, never flashing the plain state in between.
 */
export function createHoverPreview<T>(set: (value: T | null) => void, grace = 120) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    enter(value: T) {
      clearTimeout(timer);
      set(value);
    },
    leave() {
      clearTimeout(timer);
      timer = setTimeout(() => set(null), grace);
    },
    /** Clears at once (the panel closing). */
    cancel() {
      clearTimeout(timer);
      set(null);
    },
  };
}
