import { uiStore } from '../ui/uiStore';

/**
 * Reading a diagram through a perspective is a visitor's view: `uiStore.activePerspective` is the choice (never saved,
 * never in undo, never the model) and `uiStore.perspectiveRead` the result, kept by `./engine`, which loads here on the
 * first choice so a visitor who never opens a perspective never downloads the code that resolves one. The engine also
 * refits the view when the reading changes.
 */
export function setActivePerspective(diagram: string, perspective: { id: string; name: string } | null): void {
  uiStore.setState({ activePerspective: perspective === null ? null : { diagram, id: perspective.id, name: perspective.name } });
  if (perspective) void import('./engine');
}
