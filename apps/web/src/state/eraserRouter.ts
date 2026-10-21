import type { EdgeRouter } from '@strukt/layout';

let loading: Promise<EdgeRouter> | undefined;

/**
 * The eraser router (@eraserlabs/layout, ~250 KB) is a separate chunk: the canvas routes in a worker and
 * only the callers that run it on the main thread (fallback, previews, exports) load it, once.
 */
export function loadEraserRouter(): Promise<EdgeRouter> {
  loading ??= import('@strukt/layout/router').then((m) => m.eraserRouter);
  loading.catch(() => {
    loading = undefined;
  });
  return loading;
}
