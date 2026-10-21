import { editorLanguage } from '../i18n/codemirror';
import { uiText } from '../i18n';
import { autocompletion } from '@codemirror/autocomplete';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import { highlightSelectionMatches, selectNextOccurrence } from '@codemirror/search';
import { Annotation, Compartment, EditorState, Transaction } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { detectImportFormat, parseDsl, printDsl } from '@strukt/dsl/lite';
import type { ImportFormat } from '@strukt/dsl/lite';
import { IMPORT_ACCEPT, IMPORT_FORMATS_SENTENCE, IMPORT_FORMAT_LABELS } from '../code/importFormats';
import { printDiagramJson } from '@strukt/json';
import { autoLayout, placeNew } from '@strukt/layout';
import { Braces, Copy, FileJson, LayoutGrid, Network, Upload, Workflow, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { reorganize } from '../actions/layout';
import { jsonCompletions } from '../code/completion';
import { toCmDiagnostics } from '../code/diagnostics';
import { registerCodeSync } from '../code/registry';
import { copyDiagramAs } from '../actions/export';
import { createCodeSync } from '../code/sync';
import type { CodeSync } from '../code/sync';
import { downloadBlob } from '../export/png';
import { diagramStore, useDiagram } from '../state/appStore';
import { IconButton } from '../ui/IconButton';
import { editorTheme } from '../ui/editorTheme';
import { requestFit, showToast, toggleCode } from '../ui/uiStore';
import { COMPARE_LOCK } from '../versions/versionStore';
import { useWorkspace } from '../workspace/appWorkspace';
import { workspace } from '../workspace/appWorkspace';
import { pluralize } from '../ui/plural';

/** Marks programmatic text replacements so they are not mistaken for typing. */
const External = Annotation.define<boolean>();

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** JSON editor (spec M5.5): shows `printDiagramJson(model)`, applies debounced edits through diffModels. */
export function CodePanel() {
  const host = useRef<HTMLDivElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const syncRef = useRef<CodeSync | null>(null);
  const [problems, setProblems] = useState({ errors: 0, warnings: 0 });
  const [convertible, setConvertible] = useState<ImportFormat | 'eraser' | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const lock = useDiagram((s) => s.readOnly);
  const locked = lock !== null;
  const slug = useWorkspace((s) => s.diagram);

  useEffect(() => {
    // One history for the whole app (spec §4): commit pending typing, then undo/redo the diagram. The
    // editor keeps no history of its own, so its programmatic reprints can never be "undone" as typing.
    const step = (action: 'undo' | 'redo') => () => {
      void syncRef.current?.flush().then(() => diagramStore.getState()[action]());
      return true;
    };
    // Read-only while an AI draft is pending: a text edit committed later would silently undo an accepted draft.
    const lock = new Compartment();
    const readOnly = (on: boolean) => [EditorState.readOnly.of(on), EditorView.editable.of(!on)];
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: printDiagramJson(diagramStore.getState().model),
        extensions: [
          editorLanguage,
          lineNumbers(),
          highlightActiveLine(),
          drawSelection(),
          EditorState.allowMultipleSelections.of(true),
          keymap.of([
            indentWithTab,
            // ⌘D adds the next occurrence: renaming every mention at once keeps each commit a pure rename.
            { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
            { key: 'Mod-z', run: step('undo'), preventDefault: true },
            { key: 'Mod-Shift-z', run: step('redo'), preventDefault: true },
            { key: 'Mod-y', run: step('redo'), preventDefault: true },
            ...defaultKeymap,
          ]),
          // Undo/Redo from the Edit or context menu arrive as beforeinput, not as keys: same app history.
          EditorView.domEventHandlers({
            beforeinput(event) {
              if (event.inputType !== 'historyUndo' && event.inputType !== 'historyRedo') return false;
              event.preventDefault();
              return step(event.inputType === 'historyUndo' ? 'undo' : 'redo')();
            },
          }),
          highlightSelectionMatches(),
          json(),
          autocompletion({
            override: [
              (context) => ({
                from: context.pos,
                options: jsonCompletions(context.state.sliceDoc(0, context.pos)).map((item) => ({
                  label: item.label,
                  type: item.type === 'value' ? 'text' : 'property',
                })),
              }),
            ],
          }),
          lintGutter(),
          EditorView.lineWrapping,
          placeholder(uiText("Escreva ou cole o JSON do diagrama…")),
          lock.of(readOnly(diagramStore.getState().readOnly !== null)),
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.some((tr) => tr.annotation(External))) {
              syncRef.current?.edited();
              setConvertible(offersConversion(update.state.doc.toString()));
            }
            if (update.focusChanged && !update.view.hasFocus) void syncRef.current?.flush();
          }),
        ],
      }),
    });
    viewRef.current = view;
    const sync = createCodeSync(
      diagramStore,
      {
        getText: () => view.state.doc.toString(),
        setText: (text) =>
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: text },
            annotations: [External.of(true), Transaction.addToHistory.of(false)],
          }),
        showDiagnostics: (diagnostics) => {
          view.dispatch(setDiagnostics(view.state, toCmDiagnostics(diagnostics, view.state.doc.length)));
          setProblems({
            errors: diagnostics.filter((d) => d.severity === 'error').length,
            warnings: diagnostics.filter((d) => d.severity === 'warning').length,
          });
        },
      },
      { onAutoLayout: requestFit },
    );
    syncRef.current = sync;
    const unregister = registerCodeSync(sync);
    const unsubscribe = diagramStore.subscribe((state, prev) => {
      if ((state.readOnly === null) !== (prev.readOnly === null)) view.dispatch({ effects: lock.reconfigure(readOnly(state.readOnly !== null)) });
    });
    return () => {
      unsubscribe();
      unregister();
      sync.dispose();
      view.destroy();
      syncRef.current = null;
      viewRef.current = null;
    };
  }, []);

  const copy = () => {
    const text = viewRef.current?.state.doc.toString() ?? '';
    navigator.clipboard.writeText(text).then(
      () => showToast(uiText("Código copiado.")),
      () => showToast(uiText("Não foi possível copiar o código.")),
    );
  };

  const arrange = async () => {
    await syncRef.current?.flush();
    await reorganize();
  };

  /** DSL pasted by mistake: rewrite the editor with the canonical JSON and let the sync commit it. */
  const convert = async () => {
    const view = viewRef.current;
    if (!view) return;
    const text = view.state.doc.toString();
    let result;
    try {
      result = convertible && convertible !== 'eraser' ? (await loadImporters()).importArchitecture(text, convertible) : parseDsl(text);
    } catch {
      showToast(uiText("Não foi possível carregar o conversor."));
      return;
    }
    if (view.state.doc.toString() !== text) return; // edited while the importers were loading
    const { model, diagnostics } = result;
    setImportWarnings(diagnostics.map((item) => uiText("Linha {0}: {1}", [item.line, item.message])));
    if (!model.order.length || diagnostics.some((d) => 'severity' in d && d.severity === 'error')) {
      showToast(uiText("Não foi possível converter: corrija o texto ou escolha outro formato."));
      return;
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: printDiagramJson(model) },
      annotations: [Transaction.addToHistory.of(false)],
    });
    setConvertible(null);
    showToast(convertible === 'eraser' ? uiText("Convertido da DSL da Eraser.") : uiText("Diagrama {0} convertido{1}.", [IMPORT_FORMAT_LABELS[convertible as ImportFormat], diagnostics.length ? uiText(" com {0}", [pluralize(diagnostics.length, uiText("aviso"), uiText("avisos"))]) : '']));
  };

  const importFile = async (file: File) => {
    const text = await file.text();
    const format = detectImportFormat(text, file.name);
    if (!format) { showToast(uiText("Formato não reconhecido. Use {0}.", [IMPORT_FORMATS_SENTENCE])); return; }
    let importers;
    try {
      importers = await loadImporters();
    } catch {
      showToast(uiText("Não foi possível carregar o conversor."));
      return;
    }
    const { model, diagnostics } = importers.importArchitecture(text, format);
    setImportWarnings(diagnostics.map((item) => uiText("Linha {0}: {1}", [item.line, item.message])));
    if (!model.order.length) { showToast(uiText("Nenhum componente reconhecido no arquivo.")); return; }
    try {
      const nodes = await autoLayout(model).catch(() => placeNew(model, { nodes: {}, edges: {} }, model.order, model.style.direction));
      await workspace.create('diagram', file.name.replace(/\.[^.]+$/, ''), { model, layout: { nodes, edges: {} } });
      requestFit();
      showToast(uiText("Diagrama importado{0}.", [diagnostics.length ? uiText(" com {0}", [pluralize(diagnostics.length, uiText("aviso"), uiText("avisos"))]) : '']));
    } catch (err) { showToast(err instanceof Error ? err.message : String(err)); }
  };

  const exportJson = async () => {
    await syncRef.current?.flush();
    downloadBlob(new Blob([printDiagramJson(diagramStore.getState().model)], { type: 'application/json' }), `${slug ?? uiText("diagrama")}.strukt.json`);
  };

  const copyAs = async (format: 'mermaid' | 'plantuml') => {
    await syncRef.current?.flush();
    await copyDiagramAs(format);
  };

  const exportDsl = async () => {
    await syncRef.current?.flush();
    downloadBlob(new Blob([printDsl(diagramStore.getState().model)], { type: 'text/plain' }), `${slug ?? uiText("diagrama")}.strukt`);
  };

  return (
    <aside aria-label={uiText("Código")} className="flex h-full w-full flex-col bg-bg">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line pl-3.5 pr-1.5">
        <span className="text-title font-semibold" title={uiText("JSON do diagrama. Editar o texto não perde posições; o arquivo é regravado quando o significado muda.")}>{uiText("Código")}</span>
        {locked && <span className="ml-2 text-[12px] text-muted">{lock === COMPARE_LOCK ? uiText("bloqueado: comparação") : uiText("bloqueado: proposta da IA")}</span>}
        {problems.errors > 0 ? (
          <span className="ml-2 text-[12px] text-danger">{plural(problems.errors, uiText("erro"))}</span>
        ) : problems.warnings > 0 ? (
          <span className="ml-2 text-[12px] text-muted">{plural(problems.warnings, uiText("aviso"))}</span>
        ) : null}
        <div className="ml-auto flex items-center">
          <input ref={importInput} type="file" className="hidden" accept={IMPORT_ACCEPT} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ''; }} />
          <IconButton label={uiText("Importar {0}", [IMPORT_FORMATS_SENTENCE])} onClick={() => importInput.current?.click()}>
            <Upload />
          </IconButton>
          <IconButton label={uiText("Reorganizar diagrama")} onClick={() => void arrange()}>
            <LayoutGrid />
            <span className="text-[12px]">{uiText("Reorganizar")}</span>
          </IconButton>
          <IconButton label={uiText("Exportar JSON")} onClick={() => void exportJson()}>
            <FileJson />
          </IconButton>
          <IconButton label={uiText("Exportar DSL (Eraser)")} onClick={() => void exportDsl()}>
            <Braces />
          </IconButton>
          <IconButton label={uiText("Copiar como Mermaid")} onClick={() => void copyAs('mermaid')}>
            <Workflow />
          </IconButton>
          <IconButton label={uiText("Copiar como PlantUML")} onClick={() => void copyAs('plantuml')}>
            <Network />
          </IconButton>
          <IconButton label={uiText("Copiar código")} onClick={copy}>
            <Copy />
          </IconButton>
          <IconButton label={uiText("Fechar código")} onClick={toggleCode}>
            <X />
          </IconButton>
        </div>
      </div>
      {convertible && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-1.5 text-[12px]">
          <span className="text-muted">{uiText("Isto parece")} {convertible === 'eraser' ? uiText("a DSL da Eraser") : IMPORT_FORMAT_LABELS[convertible]}.</span>
          <button type="button" className="font-medium text-accent hover:underline" onClick={convert}>{uiText("Converter para JSON")}</button>
        </div>
      )}
      {importWarnings.length > 0 && <div role="status" className="max-h-28 overflow-y-auto border-b border-line bg-panel px-3 py-2 text-caption text-muted">
        <strong>{pluralize(importWarnings.length, uiText("aviso"), uiText("avisos"))} {uiText("da importação")}</strong>
        <ul className="mt-1 list-inside list-disc">{importWarnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}</ul>
      </div>}
      <div ref={host} className="min-h-0 flex-1 overflow-hidden" />
    </aside>
  );
}

/** The importers (and `yaml`) load on the first conversion, not with the app. */
const loadImporters = () => import('@strukt/dsl/import');

/**
 * True when the text is not JSON but parses as the legacy DSL without errors. Text starting with `{`/`[` is never offered:
 * pasted OpenAPI/Kubernetes JSON is not suggested by the paste banner (importing the same file from disk still works).
 */
function offersConversion(text: string): ImportFormat | 'eraser' | null {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || !trimmed) return null;
  return detectImportFormat(text) ?? (!parseDsl(text).diagnostics.some((d) => d.severity === 'error') ? 'eraser' : null);
}
