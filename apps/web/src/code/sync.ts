import { uiText } from '../i18n';
import { applyOps, diffModels, syncLayout } from '@strukt/core';
import type { DiagramModel, DiagramOp, ID, LayoutState, NodeBox } from '@strukt/core';
import { parseDiagramJson, printDiagramJson } from '@strukt/json';
import type { JsonDiagnostic } from '@strukt/json';
import { autoLayout, placeBatch } from '@strukt/layout';
import type { DiagramStore } from '../state/diagramStore';

export type TextEditPlan =
  | { kind: 'invalid' | 'unchanged'; diagnostics: JsonDiagnostic[] }
  | {
      kind: 'apply';
      diagnostics: JsonDiagnostic[];
      ops: DiagramOp[];
      next: DiagramModel;
      /** `placeBatch` positions for new and regrouped elements (also the fallback if ELK fails). */
      positions: Record<ID, NodeBox>;
      /** No element of the result has a position: lay the whole diagram out with ELK instead. */
      autoLayout: boolean;
    };

const hasErrors = (diagnostics: readonly JsonDiagnostic[]) => diagnostics.some((d) => d.severity === 'error');

/** `diffModels` prefixes its own invariant failures with the function name; that is an implementation detail, not something to show the user. */
const withoutDiffPrefix = (message: string) => message.replace(/^diffModels: /, '');

function internalError(message: string): JsonDiagnostic {
  return { severity: 'error', message: uiText("Não foi possível aplicar o código: {0}", [message]), span: { from: 0, to: 0 }, line: 1, column: 1 };
}

/** Text → ops against the current model (spec M5.5: parse → diffModels → applyOps as one step). */
export function planTextEdit(model: DiagramModel, layout: LayoutState, text: string): TextEditPlan {
  const { model: parsed, diagnostics } = parseDiagramJson(text);
  if (hasErrors(diagnostics)) return { kind: 'invalid', diagnostics };
  try {
    const ops = diffModels(model, parsed);
    if (!ops.length) return { kind: 'unchanged', diagnostics };
    const result = applyOps(model, ops);
    if (!result.ok) return { kind: 'invalid', diagnostics: [...diagnostics, internalError(result.error.message)] };
    const next = result.model;
    // autoLayout: no kept element has a position (empty canvas, or the whole text was replaced).
    const { positions, autoLayout } = placeBatch(next, syncLayout(layout, next, ops), ops);
    return { kind: 'apply', diagnostics, ops, next, positions, autoLayout };
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'invalid', diagnostics: [...diagnostics, internalError(withoutDiffPrefix(message))] };
  }
}

/** True when the text parses to exactly what the model means (formatting and key order don't count). */
export function textMatchesModel(text: string, model: DiagramModel): boolean {
  const { model: parsed, diagnostics } = parseDiagramJson(text);
  if (hasErrors(diagnostics)) return false;
  return printDiagramJson(parsed) === printDiagramJson(model);
}

/** What the sync needs from the editor widget (CodeMirror in the app, a fake in tests). */
export interface CodeEditorPort {
  getText(): string;
  /** Replace the whole text without it counting as a user edit. */
  setText(text: string): void;
  showDiagnostics(diagnostics: readonly JsonDiagnostic[]): void;
}

export interface CodeSync {
  /** The user changed the text: commit after `delay` ms without further edits. */
  edited(): void;
  /** Commit pending edits now (editor blur, panel buttons). */
  flush(): Promise<void>;
  hasPending?(): boolean;
  hasUnapplied?(): boolean;
  dispose(): void;
}

/**
 * Two-way sync between the JSON editor and the diagram store. The user's text is never rewritten
 * while it has uncommitted edits; any other model change reprints the canonical text.
 */
export function createCodeSync(
  store: DiagramStore,
  editor: CodeEditorPort,
  options: { delay?: number; onAutoLayout?: () => void } = {},
): CodeSync {
  const delay = options.delay ?? 300;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let busy = false;
  let disposed = false;
  let queue = Promise.resolve();

  const commit = async (text: string) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { model, layout } = store.getState();
      const plan = planTextEdit(model, layout, text);
      if (!disposed) editor.showDiagnostics(plan.diagnostics);
      if (plan.kind !== 'apply') return;
      let positions = plan.positions;
      if (plan.autoLayout) {
        try {
          positions = await autoLayout(plan.next);
        } catch {
          // keep the placeBatch positions
        }
        if (store.getState().model !== model) continue; // changed while ELK ran: plan again
      }
      if (store.getState().apply(plan.ops, positions) && plan.autoLayout) options.onAutoLayout?.();
      return;
    }
    if (!disposed) editor.showDiagnostics([internalError(uiText("o diagrama mudou durante o layout automático. Edite o código para tentar de novo."))]);
  };

  /**
   * A throw here (a listener inside `store.apply`, `onAutoLayout`, or the editor port) must not
   * leave `queue` permanently rejected — every later `.then` on a rejected promise would then skip
   * its handler forever, silently dropping every subsequent edit.
   */
  const onCommitFailure = (err: unknown) => {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    if (!disposed) editor.showDiagnostics([internalError(withoutDiffPrefix(message))]);
  };

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!dirty) return queue;
    dirty = false;
    // Captured now, synchronously: an external model change right after `flush()` returns can
    // reprint the editor (see the subscribe callback below) before the queued commit below runs.
    const text = editor.getText();
    queue = queue
      .then(async () => {
        busy = true;
        try {
          await commit(text);
        } finally {
          busy = false;
        }
      })
      .catch(onCommitFailure);
    return queue;
  };

  const printed = printDiagramJson(store.getState().model);
  if (editor.getText() !== printed) editor.setText(printed);
  const unsubscribe = store.subscribe((state, prev) => {
    if (state.model === prev.model || dirty || busy) return;
    if (textMatchesModel(editor.getText(), state.model)) return;
    editor.setText(printDiagramJson(state.model));
    editor.showDiagnostics([]);
  });

  return {
    edited() {
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), delay);
    },
    flush,
    hasPending: () => dirty || busy,
    hasUnapplied: () => !textMatchesModel(editor.getText(), store.getState().model),
    dispose() {
      disposed = true;
      clearTimeout(timer);
      unsubscribe();
    },
  };
}
