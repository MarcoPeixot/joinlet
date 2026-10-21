import { uiText } from '../i18n';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { EditorState, StateField, Facet } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { renderMarkdown } from './markdown';
import { citationRanges, linkCitations, referenceHref } from '../chat/citations';
import type { CitationResolver, CitationTarget } from '../chat/citations';
import { parseReferenceHref } from '../chat/citationAddress';
import { goToCitation } from '../chat/reveal';
const citationResolver = Facet.define<CitationResolver,CitationResolver>({combine:values=>values[values.length-1] ?? (()=>null)});
import { presentDocument } from './presentation';
import { showToast } from '../ui/uiStore';
import type { Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { tags } from '@lezer/highlight';

/**
 * Obsidian-style "live preview" on the doc's CodeMirror: the Markdown text stays the source of truth (copy, save and
 * collaboration are byte-for-byte the same), but titles, emphasis, code, links, quotes and bullets are drawn as
 * rendered text, and the markers (`#`, `**`, backticks, `[](…)`) are hidden everywhere except where the cursor is.
 */

class Bullet extends WidgetType {
  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-bullet';
    el.textContent = '•';
    return el;
  }
  eq(): boolean {
    return true;
  }
}

const hide = Decoration.replace({});
const bullet = Decoration.replace({ widget: new Bullet() });
const lineClass = (name: string) => Decoration.line({ class: name });
const markClass = (name: string) => Decoration.mark({ class: name });

const touches = (view: EditorView, from: number, to: number) => view.state.selection.ranges.some((range) => range.from <= to && range.to >= from);

class Reference extends WidgetType {
  constructor(readonly target:CitationTarget){super();}
  eq(other:Reference){return referenceHref(this.target)===referenceHref(other.target) && this.target.label===other.target.label && this.target.diagramTitle===other.target.diagramTitle;}
  toDOM(){const el=document.createElement('a');el.className='cm-workspace-reference';el.textContent=this.target.label;el.href=referenceHref(this.target);el.title=this.target.diagramTitle;el.addEventListener('click',event=>{event.preventDefault();void goToCitation(this.target);});return el;}
  ignoreEvent(){return true;}
}

function build(view: EditorView): DecorationSet {
  const { doc } = view.state;
  const out: Range<Decoration>[] = [];
  const lines = (from: number, to: number, name: string) => {
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) out.push(lineClass(name).range(doc.line(n).from));
  };
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        const { name } = node;
        if (name === 'Table') return false;
        const heading = /^ATXHeading([1-6])$/.exec(name);
        if (heading) {
          const line = doc.lineAt(node.from);
          out.push(lineClass(`cm-h cm-h${heading[1]}`).range(line.from));
          const markNode = node.node.getChild('HeaderMark');
          if (markNode && !touches(view, line.from, line.to)) out.push(hide.range(markNode.from, Math.min(markNode.to + 1, line.to)));
        } else if (name === 'StrongEmphasis' || name === 'Emphasis' || name === 'InlineCode') {
          out.push(markClass(name === 'StrongEmphasis' ? 'cm-strong' : name === 'Emphasis' ? 'cm-em' : 'cm-code').range(node.from, node.to));
          if (!touches(view, node.from, node.to)) {
            for (let child = node.node.firstChild; child; child = child.nextSibling) {
              if (child.name === 'EmphasisMark' || child.name === 'CodeMark') out.push(hide.range(child.from, child.to));
            }
          }
        } else if (name === 'Link') {
          out.push(markClass('cm-link').range(node.from, node.to));
          if (!touches(view, node.from, node.to)) {
            for (let child = node.node.firstChild; child; child = child.nextSibling) {
              if (child.name === 'LinkMark' || child.name === 'URL' || child.name === 'LinkTitle') out.push(hide.range(child.from, child.to));
            }
          }
        } else if (name === 'Blockquote') {
          lines(node.from, node.to, 'cm-quote');
        } else if (name === 'QuoteMark') {
          const line = doc.lineAt(node.from);
          if (!touches(view, line.from, line.to)) out.push(hide.range(node.from, Math.min(node.to + 1, line.to)));
        } else if (name === 'ListMark' && node.node.parent?.parent?.name === 'BulletList') {
          const line = doc.lineAt(node.from);
          if (!touches(view, line.from, line.to)) out.push(bullet.range(node.from, node.to));
        } else if (name === 'FencedCode') {
          lines(node.from, node.to, 'cm-codeblock');
        } else if (name === 'HorizontalRule') {
          out.push(lineClass('cm-hr').range(doc.lineAt(node.from).from));
        }
      },
    });
  }
  const resolve=view.state.facet(citationResolver);
  for(const item of citationRanges(doc.toString())){
    if(!view.visibleRanges.some(range=>item.to>=range.from && item.from<=range.to)||touches(view,item.from,item.to))continue;
    let node=syntaxTree(view.state).resolveInner(item.from,1);let excluded=false;
    for(let parent:typeof node|null=node;parent;parent=parent.parent)if(['Table','FencedCode','CodeBlock','InlineCode','Link','Image','HTMLBlock','HTMLTag'].includes(parent.name)){excluded=true;break;}
    if(excluded)continue;
    const target=resolve(item.ref);if(target)out.push(Decoration.replace({widget:new Reference(target)}).range(item.from,item.to));
  }
  return Decoration.set(out, true);
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.startState.facet(citationResolver)!==update.state.facet(citationResolver) || syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = build(update.view);
    }
  },
  { decorations: (instance) => instance.decorations },
);

/** Prose, not code: Sora at reading size in a centered column; code stays mono. */
const prose = EditorView.theme({
  '.cm-scroller': { fontFamily: 'var(--font-ui)', fontSize: '15.5px', lineHeight: '1.75' },
  '.cm-content': { maxWidth: '760px', margin: '0 auto', padding: '32px 40px 160px' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-line': { padding: '0' },
  '.cm-h': { fontWeight: '600', letterSpacing: '-0.03em' },
  '.cm-h1': { fontSize: '32px', lineHeight: '1.25', padding: '0 0 12px' },
  '.cm-h2': { fontSize: '23px', lineHeight: '1.4', padding: '16px 0 6px' },
  '.cm-h3': { fontSize: '18px', lineHeight: '1.4', padding: '10px 0 2px' },
  '.cm-h4, .cm-h5, .cm-h6': { fontSize: '16px', lineHeight: '1.5', padding: '8px 0 0' },
  '.cm-strong': { fontWeight: '650' },
  '.cm-em': { fontStyle: 'italic' },
  '.cm-code': { fontFamily: 'var(--font-mono)', fontSize: '0.88em', backgroundColor: 'var(--sk-panel-2)', borderRadius: '5px', padding: '1px 5px' },
  '.cm-link': { color: 'var(--sk-accent)' },
  '.cm-quote': { borderLeft: '3px solid var(--sk-line-strong)', paddingLeft: '14px', color: 'var(--sk-muted)' },
  '.cm-codeblock': { fontFamily: 'var(--font-mono)', fontSize: '13px', backgroundColor: 'var(--sk-panel-2)', padding: '0 14px' },
  '.cm-hr': { borderBottom: '1px solid var(--sk-line-strong)', color: 'transparent' },
  '.cm-bullet': { color: 'var(--sk-faint)', display: 'inline-block', width: '1.1em' },
});

/** Titles, bold, links and marks in the app's tokens, without CodeMirror's default underlined headings. */
const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '650' },
  { tag: tags.strong, fontWeight: '650' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, color: 'var(--sk-accent)' },
  { tag: tags.url, color: 'var(--sk-faint)' },
  { tag: tags.quote, color: 'var(--sk-muted)' },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], color: 'var(--sk-faint)' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)' },
]);

class RenderedBlock extends WidgetType {
  constructor(readonly markdown: string, readonly from: number, readonly code: boolean, readonly resolve:CitationResolver) { super(); }
  eq(other: RenderedBlock) { return this.markdown === other.markdown && this.from === other.from && this.resolve===other.resolve; }
  toDOM(view: EditorView) {
    const root = document.createElement('div');
    root.className = 'sk-doc-block sk-doc-prose';
    root.innerHTML = presentDocument(renderMarkdown(this.code ? this.markdown : linkCitations(this.markdown,this.resolve),{citations:href=>parseReferenceHref(href)!==null})).html;
    root.addEventListener('click', (event) => {
      const target=parseReferenceHref((event.target as Element).closest('a')?.getAttribute('href'));
      if(target){event.preventDefault();void goToCitation(target);return;}
      if (!(event.target as Element).closest('[data-copy-code]')) return;
      const code = root.querySelector('pre')?.textContent;
      if (code) void navigator.clipboard.writeText(code).then(() => showToast(uiText("Código copiado.")), () => showToast(uiText("Não foi possível copiar o código.")));
    });
    if (!view.state.readOnly) {
      const actions = document.createElement('div'); actions.className = 'sk-doc-block-action';
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = this.code ? uiText("Editar código") : uiText("Editar tabela");
      edit.addEventListener('click', () => { view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true }); view.focus(); });
      actions.append(edit); root.append(actions);
    }
    return root;
  }
  ignoreEvent() { return true; }
}

function renderBlocks(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  syntaxTree(state).iterate({ enter(node) {
    if (node.name !== 'Table' && node.name !== 'FencedCode') return;
    const active = state.selection.ranges.some((range) => range.from <= node.to && range.to >= node.from);
    if (!active && state.doc.lineAt(node.from).from === node.from && state.doc.lineAt(node.to).to === node.to) {
      ranges.push(Decoration.replace({ widget: new RenderedBlock(state.sliceDoc(node.from, node.to), node.from, node.name === 'FencedCode',state.facet(citationResolver)), block: true }).range(node.from, node.to));
    }
    return false;
  } });
  return Decoration.set(ranges, true);
}
const blocks = StateField.define<DecorationSet>({
  create: renderBlocks,
  update: (value, transaction) => transaction.docChanged || transaction.selection || transaction.startState.facet(citationResolver)!==transaction.state.facet(citationResolver) || syntaxTree(transaction.startState) !== syntaxTree(transaction.state) ? renderBlocks(transaction.state) : value,
  provide: (field) => EditorView.decorations.from(field),
});

/** The marks and Markdown highlighting are always available. */
export const markdownHighlight: Extension = syntaxHighlighting(highlight);

/** Render blocks and inline prose without changing the Markdown or undo stack. */
export const livePreview: Extension = [plugin, prose, blocks, EditorView.atomicRanges.of((view) => view.state.field(blocks))];


export const livePreviewWithReferences = (resolve:CitationResolver):Extension => [citationResolver.of(resolve),livePreview];
