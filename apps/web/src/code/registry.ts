import type { CodeSync } from './sync';

let active: CodeSync | null = null;

/** The open Código panel registers its sync, so the AI can commit pending text edits before it reads or writes the model. */
export function registerCodeSync(sync: CodeSync): () => void {
  active = sync;
  return () => {
    if (active === sync) active = null;
  };
}

export function flushCodeEdits(): Promise<void> {
  return active ? active.flush() : Promise.resolve();
}

export function hasPendingCodeEdits(): boolean {
  return active?.hasPending?.() ?? false;
}

export function hasUnappliedCodeEdits(): boolean {
  return active?.hasUnapplied?.() ?? false;
}
