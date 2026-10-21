import { uiText } from '../i18n';
import { own } from '@strukt/core';
import type { DiagramModel, ID } from '@strukt/core';
import { LEVELS, levelOf, sharedTagsOf, suggestLevels } from '@strukt/workspace';
import type { Level, LevelProposal, SharedModel } from '@strukt/workspace';
import { createStore } from 'zustand/vanilla';
import { diagramStore } from '../state/appStore';
import { showToast, uiStore } from '../ui/uiStore';
import { workspace } from '../workspace/appWorkspace';

/** A suggested level the person can accept, change or leave out. */
export interface ProposedLevel extends LevelProposal {
  label: string;
  accepted: boolean;
}

export function proposeLevels(model: DiagramModel, shared: SharedModel | undefined, slug: string): ProposedLevel[] {
  const tagsOf = sharedTagsOf(shared, slug);
  return suggestLevels(model, (id) => levelOf(tagsOf(id))).map((proposal) => ({ ...proposal, label: own(model.elements, proposal.id)?.label ?? proposal.id, accepted: true }));
}

export function levelCounts(model: DiagramModel, shared: SharedModel | undefined, slug: string): Record<Level | 'none', number> {
  const tagsOf = sharedTagsOf(shared, slug);
  const counts: Record<Level | 'none', number> = { contexto: 0, container: 0, componente: 0, none: 0 };
  for (const id of model.order) counts[levelOf(tagsOf(id)) ?? 'none'] += 1;
  return counts;
}

/** Proposals waiting for the person's answer, for one diagram. They are never applied by themselves. */
export const suggestionStore = createStore<{ diagram: string | null; items: ProposedLevel[] }>(() => ({ diagram: null, items: [] }));

/** "Sugerir níveis C4": works out the proposals for the open diagram and shows them in the Perspectivas panel. */
export function requestLevelSuggestions(): void {
  const { diagram, data } = workspace.store.getState();
  if (!diagram || !data) return;
  const items = proposeLevels(diagramStore.getState().model, data.shared, diagram);
  suggestionStore.setState({ diagram, items });
  if (!items.length) showToast(uiText("Todos os componentes já têm nível."));
  else uiStore.setState({ rightPanel: 'perspectives' });
}

export function dismissSuggestions(): void {
  suggestionStore.setState({ diagram: null, items: [] });
}

/** Gives the accepted proposals their level (one save of the shared model; the diagram itself is untouched). */
export async function acceptSuggestions(): Promise<void> {
  const { diagram, items } = suggestionStore.getState();
  if (!diagram) return;
  const accepted = items.filter((item) => item.accepted);
  if (accepted.length) {
    const levels: Record<ID, Level> = {};
    for (const item of accepted) if (LEVELS.includes(item.level)) levels[item.id] = item.level;
    await workspace.setLevels(diagram, levels);
    showToast(accepted.length === 1 ? uiText("1 nível atribuído.") : uiText("{0} níveis atribuídos.", [accepted.length]));
  }
  dismissSuggestions();
}
