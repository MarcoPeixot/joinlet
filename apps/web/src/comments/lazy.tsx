import { Suspense } from 'react';
import { ChunkBoundary } from '../ui/ChunkBoundary';
import { lazyWithRetry } from '../ui/lazyWithRetry';

/**
 * The comments load on demand, after the first paint: the app's first load carries this one door. Everything else of
 * the comments (the count on the "Painéis" trigger, the tool of the canvas palette, the pins, the panel) is drawn by
 * the host into empty `data-slot` elements the bar and the palette leave for it. Quiet when its chunk cannot load (a
 * toast says so): the comments are an addition, and a missing one must not leave an alert on the screen.
 */
const Host = lazyWithRetry(() => import('./CommentsHost'));

export function CommentsMount() {
  return <ChunkBoundary quiet><Suspense fallback={null}><Host /></Suspense></ChunkBoundary>;
}
