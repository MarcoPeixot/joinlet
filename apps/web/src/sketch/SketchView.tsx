import { uiText } from '../i18n';
import { Suspense } from 'react';
import { ChunkBoundary } from '../ui/ChunkBoundary';
import { lazyWithRetry } from '../ui/lazyWithRetry';
import { useUi } from '../ui/uiStore';

/** Excalidraw is large: its chunk (and CSS) only loads when a sketch is opened. */
const SketchEditor = lazyWithRetry(() => import('./SketchEditor'));

export function SketchView({ slug }: { slug: string }) {
  const theme = useUi((s) => s.theme);
  return (
    <ChunkBoundary fill>
      <Suspense fallback={<div className="flex h-full items-center justify-center text-muted">{uiText("Carregando o editor de sketch…")}</div>}>
        <SketchEditor slug={slug} theme={theme} />
      </Suspense>
    </ChunkBoundary>
  );
}
