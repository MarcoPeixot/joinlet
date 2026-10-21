import { uiText } from '../i18n';
import { applyOps, computeRects, unionRect, visualBox } from '@strukt/core';
import type { Direction, ID, Size } from '@strukt/core';
import { autoLayout } from '@strukt/layout';
import { diagramStore } from '../state/appStore';
import { requestFit, showToast } from '../ui/uiStore';

export async function composeArchitecture(direction?: Direction): Promise<void> {
  const {model,layout,readOnly,pending}=diagramStore.getState();
  if(!model.order.length||readOnly||pending)return;
  const chosenDirection=direction??model.style.direction;
  try {
    const {compositionOps,suggestComposition}=await import('@strukt/layout/composition');
    const suggestion=suggestComposition(model,true);
    const entry=suggestion.entry??[], infrastructure=suggestion.shared??[];
    const ops=compositionOps(model,{entry,shared:infrastructure});
    // Composition suggestions infer roles, but the user's reading direction takes precedence.
    ops.push({op:'set_style',set:{direction:chosenDirection}});
    const next=applyOps(model,ops);if(!next.ok)return;
    const positions=await autoLayout(next.model);
    const current=diagramStore.getState();
    if(current.model!==model||current.layout!==layout||current.readOnly||current.pending)return;
    if(current.apply(ops,positions))requestFit();
  }catch{showToast(uiText("Não foi possível compor a arquitetura."));}
}

/** Reorganizes the whole scene in one layout-only undo step, keeping its top-left corner. */
export async function reorganize(): Promise<void> {
  const { model, layout } = diagramStore.getState();
  if (!model.order.length) {
    showToast(uiText("O diagrama está vazio."));
    return;
  }
  const rects = computeRects(model, layout);
  const bounds = unionRect(model.order.flatMap((id) => (model.elements[id] && rects[id] ? [visualBox(model.elements[id], rects[id])] : [])));
  const sizes: Record<ID, Size> = {};
  for (const [id, box] of Object.entries(layout.nodes)) if (box.w && box.h) sizes[id] = { w: box.w, h: box.h };
  try {
    const positions = await autoLayout(model, sizes, model.style.direction, bounds ? { x: Math.round(bounds.x), y: Math.round(bounds.y) } : undefined);
    const now = diagramStore.getState();
    // An edit, a move or a drag that started while ELK ran wins over the arrangement computed before it.
    if (now.model !== model || now.layout.nodes !== layout.nodes || now.pending) return;
    now.arrange(positions);
    requestFit();
  } catch {
    showToast(uiText("Não foi possível reorganizar o diagrama."));
  }
}
