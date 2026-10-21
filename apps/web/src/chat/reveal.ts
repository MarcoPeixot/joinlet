import { uiText } from '../i18n';
import { own } from '@strukt/core';
import { requestFit, showToast } from '../ui/uiStore';
import { revealElement } from '../workspace/actions';
import { workspace } from '../workspace/appWorkspace';

/** A click on a citation: opens the diagram and selects the element. The address came from text, so it is checked again here. */
export async function goToCitation({ diagram, id }: { diagram: string; id: string }): Promise<void> {
  const model = own(workspace.store.getState().data?.diagrams ?? {}, diagram)?.model;
  if (!model || (id && !own(model.elements, id))) {
    showToast(uiText("Esse elemento não existe mais no diagrama."));
    return;
  }
  if(!id){await workspace.openDiagram(diagram);requestFit();return;}
  await revealElement(diagram, id);
}
