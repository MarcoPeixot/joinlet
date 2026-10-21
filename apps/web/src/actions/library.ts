import { uiText } from '../i18n';
import type { ComponentPreset } from '@strukt/core';
import { emptyLibrary } from '@strukt/workspace';
import type { DiagramSnapshot, StorageAdapter, WorkspaceLibrary } from '@strukt/workspace';
import { create } from 'zustand';
import { diagramStore } from '../state/appStore';
import { showToast } from '../ui/uiStore';
import { workspace } from '../workspace/appWorkspace';

type LibraryRequest = { kind: 'component'; preset?: ComponentPreset; editing?: boolean } | { kind: 'template'; snapshot: DiagramSnapshot; title: string };

export const useLibraryEditor = create<{ request: LibraryRequest | null; owner: StorageAdapter | null }>(() => ({ request: null, owner: null }));

export function openComponentEditor(preset?: ComponentPreset, editing = false): void {
  if (diagramStore.getState().readOnly) return showToast(diagramStore.getState().readOnly!);
  useLibraryEditor.setState({ request: { kind: 'component', preset, editing }, owner: workspace.storage() });
}

export function openSelectedComponentEditor(): void {
  const { model, selection, layout } = diagramStore.getState();
  const el = model.elements[selection.nodes[0] ?? ''];
  if (!el || selection.nodes.length !== 1) return showToast(uiText("Selecione um componente para salvar seus padrões."));
  const box = layout.nodes[el.id];
  openComponentEditor({ id: `custom-${crypto.randomUUID()}`, label: el.label ?? el.id, category: 'Meu workspace', description: el.description ?? '', color: el.color ?? 'gray', icon: el.icon, tech: el.tech, kind: el.kind, shape: el.kind === 'node' ? el.shape : undefined, presentation: el.presentation, layoutRole: el.layoutRole, fields: el.fields, width: box?.w, height: box?.h });
}

export function openSaveTemplate(): void {
  const state = diagramStore.getState();
  const current = workspace.store.getState();
  if (current.view.kind !== 'diagram' || !state.model.order.length) return showToast(uiText("Abra um diagrama com conteúdo para salvar como template."));
  if (state.readOnly) return showToast(state.readOnly);
  const title = current.data?.manifest.diagrams.find((entry) => entry.slug === current.diagram)?.title ?? uiText("Meu template");
  useLibraryEditor.setState({ request: { kind: 'template', title, snapshot: structuredClone({ model: state.model, layout: state.layout }) }, owner: workspace.storage() });
}

export function updateWorkspaceLibrary(update: (library: WorkspaceLibrary) => WorkspaceLibrary): void {
  const data = workspace.store.getState().data;
  if (!data) throw new Error(uiText("Abra um workspace para salvar a biblioteca."));
  workspace.setLibrary(update(data.library ?? emptyLibrary()));
}

export function removeCustomComponent(id: string): void {
  try {
    const owner = workspace.storage();
    const existing = workspace.store.getState().data?.library?.components.find((entry) => entry.id === id);
    updateWorkspaceLibrary((library) => ({ ...library, components: library.components.filter((entry) => entry.id !== id) }));
    if (existing) showToast(uiText("Componente removido da biblioteca."), { label: uiText("Desfazer"), run: () => {
      if (workspace.storage() !== owner) return showToast(uiText("Abra o workspace anterior para editar sua biblioteca."));
      updateWorkspaceLibrary((library) => ({ ...library, components: [...library.components.filter((entry) => entry.id !== id), existing] }));
    } });
  } catch (error) { showToast(error instanceof Error ? error.message : uiText("Não foi possível editar a biblioteca.")); }
}
