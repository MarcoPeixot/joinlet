import { uiText } from '../i18n';
import { applyOps, emptyModel } from '@strukt/core';
import { autoLayout } from '@strukt/layout';
import type { DiagramSnapshot, DiagramTemplate } from '@strukt/workspace';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { diagramStore } from '../state/appStore';
import { requestFit, showToast } from '../ui/uiStore';
import { workspace } from '../workspace/appWorkspace';

const galleryStore = createStore(() => ({ open: false }));
export const openTemplateGallery = () => galleryStore.setState({ open: true });
export const closeTemplateGallery = () => galleryStore.setState({ open: false });
export const useTemplateGallery = () => useStore(galleryStore, (state) => state.open);

export async function templateSnapshot(template: DiagramTemplate): Promise<DiagramSnapshot> {
  const result = applyOps(emptyModel(), template.ops);
  if (!result.ok) throw new Error(result.error.message);
  const hasPositions = result.model.order.every((id) => result.model.elements[id]?.kind === 'group' || Object.hasOwn(template.positions ?? {}, id));
  const positions = hasPositions ? template.positions ?? {} : { ...await autoLayout(result.model), ...template.positions };
  return { model: result.model, layout: { nodes: positions, edges: {} } };
}

/** Empty diagrams receive one undo step; existing content stays in its own diagram. */
export async function applyTemplate(template: DiagramTemplate): Promise<boolean> {
  const { model, readOnly } = diagramStore.getState();
  if (readOnly) { showToast(readOnly); return false; }
  const session = workspace.store.getState();
  try {
    const snapshot = await templateSnapshot(template);
    const current = workspace.store.getState();
    if (current.source !== session.source || current.diagram !== session.diagram || current.view !== session.view || diagramStore.getState().model !== model) return false;
    if (diagramStore.getState().readOnly) { showToast(diagramStore.getState().readOnly!); return false; }
    if (current.view.kind === 'diagram' && !model.order.length) {
      if (!diagramStore.getState().apply(template.ops, snapshot.layout.nodes)) return false;
    } else {
      if (!current.data) throw new Error(uiText("Abra um workspace para criar um diagrama."));
      await workspace.create('diagram', template.title, snapshot);
    }
    requestFit();
    return true;
  } catch (error) {
    showToast(error instanceof Error ? error.message : uiText("Não foi possível criar o diagrama."));
    return false;
  }
}
