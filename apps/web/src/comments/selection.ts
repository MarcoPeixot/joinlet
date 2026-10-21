import { uiText } from '../i18n';
import { textAnchor } from '@strukt/workspace';
import { docCommentBridge } from '../docs/commentBridge';
import { diagramStore } from '../state/appStore';
import { showToast, uiStore } from '../ui/uiStore';
import { comments } from './session';

/** Starts a comment on the editor's selection (the doc's "Comentar"). */
export function commentSelection(): void {
  const view = docCommentBridge.view;
  const { from, to } = view?.state.selection.main ?? { from: 0, to: 0 };
  if (!view || from === to) {
    showToast(uiText("Selecione um trecho do documento para comentá-lo."));
    return;
  }
  comments.startDraft(textAnchor(view.state.doc.toString(), from, to));
  uiStore.setState({ rightPanel: 'comments' });
}

/** Starts a comment on the selected node or connection of the open diagram (the keyboard's way to the comment tool). */
export function commentOnSelection(): void {
  const { selection } = diagramStore.getState();
  const anchor = selection.nodes.length === 1 && !selection.edges.length
    ? { type: 'node' as const, id: selection.nodes[0]! }
    : selection.edges.length === 1 && !selection.nodes.length ? { type: 'edge' as const, id: selection.edges[0]! } : null;
  if (!anchor) {
    showToast(uiText("Selecione um nó ou uma conexão, ou use a ferramenta Comentar e clique no canvas."));
    return;
  }
  comments.startDraft(anchor);
}
