import { useEffect } from 'react';
import { workspace } from '../workspace/appWorkspace';
import type { View } from '../workspace/workspace';

/** ⌘S/Ctrl+S outside the diagram view: docs, sketches and the Overview save on their own, and no "Salvar versão" exists there. */
export function isStraySaveKey(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>, view: View['kind']): boolean {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && view !== 'diagram';
}

/** Keeps ⌘S from opening the browser's "Salvar página" in the views that have no shortcut listener of their own. */
export function useSaveKeyGuard(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isStraySaveKey(event, workspace.store.getState().view.kind)) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}
