import { Suspense, useEffect, useState } from 'react';
import { ChunkBoundary } from '../ui/ChunkBoundary';
import { lazyWithRetry } from '../ui/lazyWithRetry';
import { closeAgentContext, useAgentContext } from './session';

/** The dialog (and the generator's AGENTS.md snippet) loads the first time "Gerar contexto para agentes" opens it. */
const ContextModal = lazyWithRetry(() => import('../panels/ContextModal').then((m) => ({ default: m.ContextModal })));

export function ContextModalMount() {
  const open = useAgentContext((s) => s.open);
  const [seen, setSeen] = useState(open);
  useEffect(() => {
    if (open) setSeen(true);
  }, [open]);
  if (!seen) return null;
  return (
    <ChunkBoundary overlay onError={closeAgentContext}>
      <Suspense fallback={null}>
        <ContextModal />
      </Suspense>
    </ChunkBoundary>
  );
}
