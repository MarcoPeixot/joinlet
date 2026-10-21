/** Documents from this many characters on get a debounced preview (sanitizing 100 KB costs ~100 ms). */
export const PREVIEW_BIG = 20_000;
/** How long typing must pause before a big document's preview is redone. */
export const PREVIEW_DELAY = 250;

export interface PreviewScheduler {
  /**
   * The HTML to show for `text`. Hidden previews (mode "Escrever") render nothing. A small document renders on every
   * change; a big one keeps the previous HTML while it is being typed and calls `onChange` once it pauses. Opening the
   * preview (or a new `version` of the renderer) always renders the current text at once.
   */
  html(text: string, visible: boolean, version?: unknown): string;
  /** A newer text is waiting for the typing to pause. */
  pending(): boolean;
  dispose(): void;
}

export interface PreviewOptions {
  render(text: string): string;
  /** A deferred render finished: ask for the view to be redone. */
  onChange(): void;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

export function createPreviewScheduler(options: PreviewOptions): PreviewScheduler {
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let shown: { text: string; version: unknown; html: string } | null = null;
  let latest = '';
  let wasVisible = false;
  let timer: unknown = null;
  let waiting = false;

  const stop = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    waiting = false;
  };
  const show = (text: string, version: unknown) => {
    shown = { text, version, html: options.render(text) };
  };

  return {
    html(text, visible, version) {
      latest = text;
      if (!visible) {
        stop();
        wasVisible = false;
        return shown?.html ?? '';
      }
      const reuse = shown && shown.version === version;
      if (reuse && shown!.text === text) {
        stop();
      } else if (!reuse || !wasVisible || text.length < PREVIEW_BIG) {
        stop();
        show(text, version);
      } else {
        stop();
        waiting = true;
        timer = setTimer(() => {
          timer = null;
          waiting = false;
          show(latest, version);
          options.onChange();
        }, PREVIEW_DELAY);
      }
      wasVisible = true;
      return shown!.html;
    },
    pending: () => waiting,
    dispose: stop,
  };
}
