import { uiText } from '../i18n';
import { aiStore } from '../ai/session';
import { diagramStore } from '../state/appStore';
import type { Selection } from '../state/diagramStore';
import { announce } from './LiveRegion';

/** "N selecionados"; empty (nothing to say) when the selection is empty. */
export function selectionMessage(selection: Selection): string {
  const count = selection.nodes.length + selection.edges.length;
  if (count === 0) return '';
  return `${count} ${count === 1 ? uiText("selecionado") : uiText("selecionados")}`;
}

/** Announces when a draft shows up or goes away; nothing while it merely stays. */
export function draftMessage(has: boolean, had: boolean): string {
  if (has === had) return '';
  return has ? uiText("Rascunho pendente") : uiText("Rascunho resolvido");
}

/** Feeds the live region from the stores; returns the unsubscribe. */
export function startAnnouncements(): () => void {
  const offSelection = diagramStore.subscribe((state, prev) => {
    if (state.selection === prev.selection) return;
    const message = selectionMessage(state.selection);
    if (message) announce(message);
  });
  const offDraft = aiStore.subscribe((state, prev) => {
    const message = draftMessage(!!state.draft, !!prev.draft);
    if (message) announce(message);
  });
  return () => {
    offSelection();
    offDraft();
  };
}
