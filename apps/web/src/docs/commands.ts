import { uiText } from '../i18n';
import { autocompletion, closeCompletion, pickedCompletion } from '@codemirror/autocomplete';
import type { Completion, CompletionContext } from '@codemirror/autocomplete';
import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension } from '@codemirror/state';
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';

interface BlockCommand { label: string; detail: string; icon: string; keywords: string; insert: string; cursor: number }
export const BLOCK_COMMANDS: readonly BlockCommand[] = [
  { label: uiText("Texto"), detail: uiText("Parágrafo simples"), icon: 'T', keywords: 'paragraph paragrafo texto', insert: '', cursor: 0 },
  { label: uiText("Título 1"), detail: uiText("Título principal"), icon: 'H1', keywords: 'titulo heading h1', insert: '# ', cursor: 2 },
  { label: uiText("Título 2"), detail: uiText("Nova seção"), icon: 'H2', keywords: 'titulo heading h2 secao', insert: '## ', cursor: 3 },
  { label: uiText("Título 3"), detail: uiText("Subseção"), icon: 'H3', keywords: 'titulo heading h3', insert: '### ', cursor: 4 },
  { label: uiText("Lista"), detail: uiText("Lista com marcadores"), icon: '•', keywords: 'lista bullet marcadores', insert: '- ', cursor: 2 },
  { label: uiText("Lista numerada"), detail: uiText("Passos em sequência"), icon: '1.', keywords: 'lista numerada ordered passos', insert: '1. ', cursor: 3 },
  { label: uiText("Citação"), detail: uiText("Destaque um trecho"), icon: '“', keywords: 'citacao quote destaque', insert: '> ', cursor: 2 },
  { label: uiText("Código"), detail: uiText("Bloco de código"), icon: '</>', keywords: 'codigo code bloco', insert: '```\n\n```', cursor: 4 },
  { label: uiText("Tabela"), detail: uiText("Organize informações"), icon: '▦', keywords: 'tabela table colunas', insert: uiText("| Coluna 1 | Coluna 2 |\n| --- | --- |\n| Conteúdo | Conteúdo |"), cursor: 2 },
  { label: uiText("Divisor"), detail: uiText("Separe duas seções"), icon: '—', keywords: 'divisor linha separador', insert: '---\n\n', cursor: 5 },
];
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function matchingBlocks(query: string) { return BLOCK_COMMANDS.filter((command) => normalize(`${command.label} ${command.keywords}`).includes(normalize(query))); }

const inCode = (state: EditorState, pos: number) => {
  for (let node = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent!) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return true;
  }
  return false;
};
export function slashCommands(context: CompletionContext) {
  if (context.state.readOnly || !context.state.selection.main.empty) return null;
  const line = context.state.doc.lineAt(context.pos);
  const match = /^\/(.{0,40})$/u.exec(line.text.slice(0, context.pos - line.from));
  if (!match || context.pos !== line.to) return null;
  if (inCode(context.state, context.pos)) return null;
  const options: Completion[] = matchingBlocks(match[1]!).map((command) => ({
    label: command.label, detail: command.detail, type: command.icon,
    apply(view, completion, from, to) {
      view.dispatch({ changes: { from, to, insert: command.insert }, selection: { anchor: from + command.cursor }, annotations: [isolateHistory.of('full'), pickedCompletion.of(completion)] });
      closeCompletion(view); view.focus();
    },
  }));
  return { from: line.from, options, filter: false };
}
class LinePrompt extends WidgetType {
  toDOM() { const span = document.createElement('span'); span.className = 'cm-placeholder sk-doc-line-prompt'; span.setAttribute('aria-hidden', 'true'); span.textContent = uiText("Digite / para inserir um bloco"); return span; }
  ignoreEvent() { return false; }
}
const promptWidget = new LinePrompt();
const linePrompt = ViewPlugin.define((view) => {
  const build = () => {
    const state = view.state, selection = state.selection.main;
    const line = state.doc.lineAt(selection.head);
    return !state.readOnly && !inCode(state, selection.head) && state.doc.length > 0 && selection.empty && line.length === 0 ? Decoration.set([Decoration.widget({ widget: promptWidget, side: 1 }).range(line.from)]) : Decoration.none;
  };
  return { decorations: build(), update() { this.decorations = build(); } };
}, { decorations: (plugin) => plugin.decorations });
export const documentCommands: Extension = [linePrompt, autocompletion({
  override: [slashCommands], activateOnTypingDelay: 60, selectOnOpen: true, interactionDelay: 0,
  tooltipClass: () => 'sk-doc-slash-menu', icons: false,
  addToOptions: [{ position: 10, render(completion) { const icon = document.createElement('span'); icon.className = 'sk-doc-command-icon'; icon.textContent = completion.type ?? 'T'; return icon; } }],
})];
