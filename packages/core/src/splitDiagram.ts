import { copyElements } from './clipboard';
import { own } from './ids';
import type { DiagramPart } from './chatEdit';
import type { DiagramModel, LayoutState } from './model';

/** Partition existing components without asking the model to recreate their design or connections. */
export function splitDiagram(model: DiagramModel, layout: LayoutState, parts: DiagramPart[]) {
  const covered = new Set<string>();
  const edges = new Set<string>();
  const snapshots = parts.map(part => {
    for (const id of part.elements) {
      const el = own(model.elements, id);
      if (!el) throw new Error(`O componente “${id}” não existe.`);
      if (el.parentId) throw new Error(`Selecione o grupo raiz de “${id}”. Grupos e seus filhos são preservados juntos.`);
    }
    const clip = copyElements(model, layout, part.elements);
    for (const el of clip.elements) covered.add(el.id);
    for (const edge of clip.edges) edges.add(edge.id);
    return {
      title: part.title,
      model: { ...model, elements: Object.fromEntries(clip.elements.map(el => [el.id, el])), order: clip.elements.map(el => el.id), edges: clip.edges },
      layout: { nodes: clip.boxes, edges: {} },
    };
  });
  const missing = model.order.filter(id => !covered.has(id));
  if (missing.length) throw new Error(`A divisão omitiu componentes: ${missing.join(', ')}. Inclua todos em pelo menos uma parte.`);
  const crossing = model.edges.filter(edge => !edges.has(edge.id));
  if (crossing.length) throw new Error(`A divisão perderia conexões: ${crossing.map(e => `${e.from} → ${e.to}`).join(', ')}. Repita os componentes de interface nas partes necessárias para preservar essas conexões.`);
  return snapshots;
}
