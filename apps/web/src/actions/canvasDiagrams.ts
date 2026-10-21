import { uiText } from '../i18n';
import { addCanvasDiagram, canvasFrameModel, canvasFrames, computeRects, emptyLayout, emptyModel, unionRect } from '@strukt/core';
import type { Direction } from '@strukt/core';
import { autoLayout } from '@strukt/layout';
import { diagramStore } from '../state/appStore';
import { requestFit, showToast } from '../ui/uiStore';
import { workspace } from '../workspace/appWorkspace';

export async function insertCanvasDiagram(title: string, slug?: string): Promise<string | null> {
  const before = diagramStore.getState(), owner = workspace.store.getState().source;
  if (before.readOnly || before.pending) return null;
  try {
    const snapshot = slug ? workspace.store.getState().data?.diagrams[slug] : { model: emptyModel(), layout: emptyLayout() };
    if (!snapshot) throw new Error(uiText("O diagrama não está disponível."));
    const missing = snapshot.model.order.some(id => snapshot.model.elements[id]?.kind === 'node' && !snapshot.layout.nodes[id]);
    const layout = missing ? { nodes: await autoLayout(snapshot.model), edges: {} } : snapshot.layout;
    const now = diagramStore.getState();
    if (workspace.store.getState().source !== owner || now.model !== before.model || now.layout.nodes !== before.layout.nodes || now.readOnly || now.pending) throw new Error(uiText("O canvas mudou. Adicione o diagrama novamente."));
    const made = addCanvasDiagram(before.model, before.layout, snapshot.model, layout, title);
    if (!now.apply(made.ops, made.positions)) throw new Error(diagramStore.getState().lastError ?? uiText("Não foi possível adicionar o diagrama."));
    diagramStore.getState().select({ nodes: [made.frame], edges: [] }); requestFit([made.frame]);
    return made.frame;
  } catch (error) { showToast(error instanceof Error ? error.message : String(error)); return null; }
}

/** Arrange only this area; the remaining diagrams retain their manual positions. */
export async function arrangeCanvasDiagram(frame: string, direction?: Direction): Promise<void> {
  const before = diagramStore.getState();
  if (before.readOnly || before.pending || !canvasFrames(before.model).includes(frame)) return;
  const local = canvasFrameModel(before.model, before.layout, frame);
  const old = computeRects(before.model, before.layout)[frame]!;
  const sizes = Object.fromEntries(Object.entries(before.layout.nodes).flatMap(([id, b]) => b.w && b.h ? [[id, { w: b.w, h: b.h }]] : []));
  try {
    const nodes = await autoLayout(local, sizes, direction ?? before.model.style.direction);
    const bounds = unionRect(Object.values(computeRects(local, { nodes, edges: {} })))!;
    const now = diagramStore.getState();
    if (now.model !== before.model || now.layout.nodes !== before.layout.nodes || now.readOnly || now.pending) return;
    now.arrange(Object.fromEntries(Object.entries(nodes).map(([id, b]) => [id, { ...b, x: b.x + old.x - bounds.x, y: b.y + old.y - bounds.y }])));
    diagramStore.getState().select({ nodes: [frame], edges: [] }); requestFit([frame]);
  } catch { showToast(uiText("Não foi possível organizar este diagrama.")); }
}
