import { diagramStore } from '../state/appStore';
import { requestFit, uiStore } from '../ui/uiStore';
import { workspace } from '../workspace/appWorkspace';
import { perspectivesFor } from '../workspace/lookup';
import { readThrough } from './project';

/**
 * Keeps `uiStore.perspectiveRead` equal to the open diagram read through the applied perspective (or null). The canvas,
 * the banner and the exports only read that field, so the code that resolves and projects loads only once a perspective
 * is applied. Everything is recomputed when the diagram, the workspace data (tags, saved perspectives) or the choice
 * changes; `readThrough` remembers its last answer, so a click or a hover costs a comparison.
 */
export function recompute(): void {
  const active = uiStore.getState().activePerspective;
  const { diagram, data } = workspace.store.getState();
  const { model, layout } = diagramStore.getState();
  const next = active && diagram === active.diagram ? readThrough({ model, layout, slug: diagram, id: active.id, saved: perspectivesFor(data, diagram), shared: data?.shared }) : null;
  const previous = uiStore.getState().perspectiveRead;
  if (next === previous) return;
  uiStore.setState({ perspectiveRead: next });
  // Entering, leaving or changing the perspective moves what is drawn: bring it all into view.
  if (next?.perspective.id !== previous?.perspective.id) requestFit();
}

// Subscribed once, when the first perspective is applied; a module never loads twice.
diagramStore.subscribe(recompute);
workspace.store.subscribe(recompute);
uiStore.subscribe(recompute);
recompute();
