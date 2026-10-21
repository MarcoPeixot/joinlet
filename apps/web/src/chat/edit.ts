import { uiText } from '../i18n';
import { addCanvasDiagram, applyOps, emptyModel, own, splitCanvasDiagram } from '@strukt/core';
import type { ChatEdit, ChatTarget, DiagramOp, NodeBox } from '@strukt/core';
import { printManifest } from '@strukt/workspace';
import { printDiagramJson } from '@strukt/json';
import { flushCodeEdits, hasUnappliedCodeEdits } from '../code/registry';
import { createDraft } from '../ai/draft';
import { diagramStore } from '../state/appStore';
import { flushSketchEdits, fitSketch } from '../sketch/registry';
import { requestFit } from '../ui/uiStore';
import { workspace } from '../workspace/appWorkspace';
import { isViewOnly } from '../workspace/boot';

export async function flushChatEdits() { await flushCodeEdits(); flushSketchEdits(); }
export function currentChatTarget(): ChatTarget | undefined {
  const { data, view, diagram } = workspace.store.getState();
  if (!data || isViewOnly()) return;
  const manifest = printManifest(data.manifest);
  if (view.kind === 'board') return { kind: 'workspace', slug: 'workspace', content: manifest, workspace: manifest };
  if (view.kind === 'diagram') {
    if (!diagram || diagramStore.getState().readOnly || hasUnappliedCodeEdits()) return;
    return { kind: 'diagram', slug: diagram, content: printDiagramJson(diagramStore.getState().model), workspace: manifest };
  }
  return { kind: view.kind, slug: view.slug, content: (view.kind === 'doc' ? own(data.docs, view.slug) : own(data.sketches, view.slug)) ?? '', workspace: manifest };
}

/** Capture before the request; check again after every await and immediately before writing. */
export function captureChatEdit() {
  const source = workspace.store.getState().source;
  const target = currentChatTarget();
  const manifest = workspace.store.getState().data?.manifest;
  const base = diagramStore.getState();
  const fresh = (content = target?.content) => {
    flushSketchEdits();
    const now = currentChatTarget();
    return !!target && !isViewOnly() && workspace.store.getState().source === source && now?.kind === target.kind && now.slug === target.slug && now.content === content && !hasUnappliedCodeEdits();
  };
  return { target, async apply(edit: ChatEdit, signal: AbortSignal) {
    const stale = () => { if (signal.aborted || !fresh()) throw new Error(uiText("O item mudou durante a resposta. Peça a alteração novamente para usar a versão atual.")); };
    stale();
    if (edit.kind === 'create_workspace_items') {
      if (!manifest) throw new Error(uiText("Nenhum workspace aberto."));
      const { prepareChatItems } = await import('./createItems');
      const items = await prepareChatItems(edit.items, signal);
      await flushCodeEdits(); stale();
      const result = await workspace.createItems(items, manifest, signal, fresh);
      return { summary: edit.summary, undo: () => {
        flushSketchEdits();
        if (workspace.store.getState().source !== source || isViewOnly() || hasUnappliedCodeEdits()) throw new Error(uiText("O workspace mudou ou há edição pendente."));
        result.undo();
      } };
    }
    if (edit.kind === 'workspace') {
      if (!manifest) throw new Error(uiText("Nenhum workspace aberto."));
      const undo = workspace.organize(edit.ops, manifest);
      return { summary: edit.summary, undo: () => { if (workspace.store.getState().source !== source || isViewOnly()) throw new Error(uiText("O workspace mudou.")); undo(); } };
    }
    const commitCanvas = (ops: DiagramOp[], positions: Record<string, NodeBox>) => {
      stale();
      const current = diagramStore.getState();
      if (current.layout.nodes !== base.layout.nodes || current.pending) throw new Error(uiText("A posição dos componentes mudou. Peça a alteração novamente."));
      if (!current.apply(ops, positions)) throw new Error(diagramStore.getState().lastError ?? uiText("Não foi possível alterar o canvas."));
      const applied = diagramStore.getState(), after = printDiagramJson(applied.model);
      requestFit();
      return { summary: edit.summary, undo: () => {
        if (!fresh(after) || diagramStore.getState().layout.nodes !== applied.layout.nodes || diagramStore.getState().past.at(-1)?.model !== base.model) throw new Error(uiText("Há alterações posteriores. Os diagramas foram preservados."));
        diagramStore.getState().undo(); requestFit();
      } };
    };
    if (edit.kind === 'add_canvas_diagram') {
      if (target?.kind !== 'diagram') throw new Error(uiText("Abra um canvas de diagramas."));
      const checked = applyOps(emptyModel(), edit.ops);
      if (!checked.ok) throw new Error(checked.error.message);
      const { autoLayout } = await import('@strukt/layout/elk');
      const nodes = await autoLayout(checked.model);
      await flushCodeEdits(); stale();
      const added = addCanvasDiagram(base.model, base.layout, checked.model, { nodes, edges: {} }, edit.title);
      return commitCanvas(added.ops, added.positions);
    }
    if (edit.kind === 'split_diagram') {
      if (edit.destination === 'canvas') {
        if (target?.kind !== 'diagram') throw new Error(uiText("Abra um canvas de diagramas."));
        const split = splitCanvasDiagram(base.model, base.layout, edit.parts);
        return commitCanvas(split.ops, split.positions);
      }
      if (target?.kind !== 'diagram') throw new Error(uiText("Abra o diagrama que deseja dividir."));
      if (diagramStore.getState().layout.nodes !== base.layout.nodes) throw new Error(uiText("A posição dos componentes mudou. Peça a divisão novamente."));
      const result = await workspace.splitDiagram(edit.parts, signal, fresh);
      const after = printDiagramJson(diagramStore.getState().model);
      requestFit();
      return { summary: edit.summary, undo: () => {
        if (!fresh(after)) throw new Error(uiText("O item mudou. Os diagramas foram preservados."));
        result.undo();
      } };
    }
    if (!target || edit.kind !== target.kind) throw new Error(uiText("A alteração não corresponde ao item aberto."));
    let undo: () => void;
    let after: string;
    if (edit.kind === 'diagram') {
      const checked = applyOps(base.model, edit.ops);
      if (!checked.ok) throw new Error(checked.error.message);
      const made = await createDraft(base.model, base.layout, { ops: edit.ops, summary: edit.summary, source: 'ai' });
      await flushCodeEdits();
      stale();
      if (diagramStore.getState().layout.nodes !== base.layout.nodes || diagramStore.getState().pending) throw new Error(uiText("A posição dos componentes mudou. Peça a alteração novamente."));
      if (!made.ok) throw new Error(made.error);
      if (!diagramStore.getState().apply(made.draft.ops, made.draft.positions)) throw new Error(diagramStore.getState().lastError ?? uiText("Não foi possível alterar o diagrama."));
      const applied = diagramStore.getState();
      after = printDiagramJson(applied.model);
      if (made.draft.autoLayout) requestFit();
      undo = () => {
        if (!fresh(after) || diagramStore.getState().layout.nodes !== applied.layout.nodes || diagramStore.getState().past.at(-1)?.model !== base.model) throw new Error(uiText("Há alterações posteriores. Use o histórico do diagrama para desfazer."));
        diagramStore.getState().undo();
      };
    } else {
      if (edit.kind === 'doc') after = edit.markdown;
      else {
        const { applySketchEdit } = await import('../sketch/applyEdit');
        stale();
        after = await applySketchEdit(target.content, edit);
      }
      stale();
      const write = target.kind === 'doc' ? workspace.setDoc : workspace.setSketch;
      write(target.slug, after);
      if (edit.kind === 'sketch' && edit.upsert.length) {
        const originalIds = new Set((JSON.parse(target.content || '{"elements":[]}').elements ?? []).map((el: { id: string }) => el.id));
        if (edit.layout || edit.clear || edit.upsert.some((shape) => !originalIds.has(shape.id))) fitSketch(target.slug);
      }
      undo = () => { if (!fresh(after)) throw new Error(uiText("Há alterações posteriores no item. A versão atual foi preservada.")); write(target.slug, target.content); };
    }
    return { summary: edit.summary, undo };
  } };
}
