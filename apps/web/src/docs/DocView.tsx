import { useCitationResolver } from '../workspace/useCitationResolver';
import { DiagramReferences } from '../workspace/DiagramReferences';
import { editorLanguage } from '../i18n/codemirror';
import { getLocale, uiText } from '../i18n';
import { createPortal } from 'react-dom';
import { documentCommands } from './commands';
import { selectionToolbar } from './selection';
import type { SelectionAnchor } from './selection';
import './documents.css';
import { defaultKeymap, history, historyKeymap, isolateHistory } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { own } from '@strukt/core';
import { docLink, referencesTo } from '@strukt/workspace';
import { AlignLeft, Bold, ChevronDown, Code, FileText, Heading1, Heading2, Heading3, Italic, Link, Link2, List, Quote, SlidersHorizontal } from 'lucide-react';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { diagramStore, useDiagram } from '../state/appStore';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Menu, MenuItem, MenuLabel } from '../ui/Menu';
import { editorTheme } from '../ui/editorTheme';
import { showToast } from '../ui/uiStore';
import { applyFormat } from './format';
import { livePreviewWithReferences, markdownHighlight } from './livePreview';
import { commentMarks } from './commentMarks';
import { docCommentBridge } from './commentBridge';
import { remoteCursors, resolveCursors, selectionPresence, setRemoteCursors } from './remoteCursors';
import type { FormatKind } from './format';
import { revealElement } from '../workspace/actions';
import { useWorkspace, workspace } from '../workspace/appWorkspace';
import { collaborationSession, isViewOnly } from '../workspace/boot';
import { matchesRemoteSource } from '../workspace/remote';
import type { CollaborationClient, CollaborationStatus } from '../workspace/collaboration';
import { closeCollaborationClient, collaborationClient } from '../workspace/collaboration';
import { showCollaborationClient, useCollaborationEpoch } from '../workspace/collaborationView';
import { useMarkdownReady } from './markdown';
import { ChunkBoundary } from '../ui/ChunkBoundary';
import { lazyWithRetry } from '../ui/lazyWithRetry';

/** The comment buttons of the doc's toolbar live with the comments (their chunk loads beside the editor). */
const DocCommentButtons = lazyWithRetry(() => import('../comments/DocCommentButtons'));

/** Empty "Referenciado por": an action that sets `link: "doc:<slug>"` on a node of the open diagram. */
function LinkToNode({ slug }: { slug: string }) {
  const model = useDiagram((s) => s.model);
  const nodes = model.order.filter((id) => model.elements[id]?.kind === 'node').slice(0, 40);
  if (isViewOnly()) return <span className="text-faint">{uiText("Sem vínculos")}</span>;
  if (!nodes.length) return <span className="text-faint">{uiText("Nenhum nó no diagrama aberto para vincular.")}</span>;
  return (
    <Menu
      label={uiText("Vincular a um nó")}
      align="start"
      trigger={<Button size="sm" variant="secondary" icon={<Link2 size={12} />}>{uiText("Vincular a um nó")}</Button>}
    >
      <MenuLabel>{uiText("Nó do diagrama aberto")}</MenuLabel>
      {nodes.map((id) => (
        <MenuItem
          key={id}
          onSelect={() => {
            if (diagramStore.getState().apply([{ op: 'update', id, set: { link: docLink(slug) } }])) showToast(uiText("“{0}” agora aponta para este documento.", [model.elements[id]?.label ?? id]));
          }}
        >
          {model.elements[id]?.label ?? id}
        </MenuItem>
      ))}
    </Menu>
  );
}

/** At most this many references show as chips; the rest live in a "+N" menu so the band stays one line. */
const CHIPS = 3;

function ReferencedBy({ slug }: { slug: string }) {
  const diagrams = useWorkspace((s) => s.data?.diagrams);
  const order = useWorkspace((s) => s.data?.manifest.diagrams);
  const refs = useMemo(() => (diagrams && order ? referencesTo(slug, diagrams, order) : []), [slug, diagrams, order]);
  const more = refs.slice(CHIPS);
  return (
    <section aria-label={uiText("Referenciado por")} className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-caption">
      {refs.length > 0 && <span className="mr-1 shrink-0 text-caption font-medium text-muted">{uiText("Referenciado por")}</span>}
      {refs.length === 0 && <LinkToNode slug={slug} />}
      {refs.slice(0, CHIPS).map((ref) => (
        <button
          key={`${ref.diagram}/${ref.id}`}
          type="button"
          className="inline-flex min-w-0 max-w-[220px] items-center gap-1.5 rounded-full border border-line bg-panel-2 px-2.5 py-0.5 transition-colors duration-(--sk-motion-fast) hover:border-accent/40 hover:bg-accent-soft hover:text-accent"
          onClick={() => void revealElement(ref.diagram, ref.id)}
        >
          <Link2 size={12} className="shrink-0" />
          <span className="truncate">{ref.label} <span className="text-muted">{"·"} {ref.diagramTitle}</span></span>
        </button>
      ))}
      {more.length > 0 && (
        <Menu
          label={uiText("Outras referências")}
          align="start"
          trigger={<button type="button" className="shrink-0 rounded-full border border-line px-2.5 py-0.5 text-muted hover:bg-panel-2 hover:text-ink" aria-label={uiText("Mais {0} referências", [more.length])}>{"+"}{more.length}</button>}
        >
          {more.map((ref) => (
            <MenuItem key={`${ref.diagram}/${ref.id}`} onSelect={() => void revealElement(ref.diagram, ref.id)}>
              {ref.label} {"·"} {ref.diagramTitle}
            </MenuItem>
          ))}
        </Menu>
      )}
    </section>
  );
}

const FORMATS: { kind: FormatKind; label: string; icon: ReactNode }[] = [
  { kind: 'bold', label: uiText("Negrito"), icon: <Bold size={14} /> },
  { kind: 'italic', label: uiText("Itálico"), icon: <Italic size={14} /> },
  { kind: 'list', label: uiText("Lista"), icon: <List size={14} /> },
  { kind: 'link', label: "Link", icon: <Link size={14} /> },
  { kind: 'code', label: uiText("Código"), icon: <Code size={14} /> },
  { kind: 'quote', label: uiText("Citação"), icon: <Quote size={14} /> },
];

function FormatBar({ disabled, onFormat, label = uiText("Formatação") }: { disabled: boolean; onFormat: (kind: FormatKind) => void; label?: string }) {
  return (
    <div role="toolbar" aria-label={label} className="min-w-0">
      <Menu label={uiText("Estilo do texto")} align="start" trigger={<button type="button" disabled={disabled} className="flex h-7 shrink-0 items-center gap-2 rounded-control px-2 text-caption text-muted hover:bg-panel-2" onMouseDown={(event) => event.preventDefault()}>{uiText("Texto")} <ChevronDown size={12} /></button>}>
        {([{ kind: 'paragraph', label: uiText("Texto"), icon: <AlignLeft size={15} /> }, { kind: 'heading1', label: uiText("Título 1"), icon: <Heading1 size={15} /> }, { kind: 'heading2', label: uiText("Título 2"), icon: <Heading2 size={15} /> }, { kind: 'heading3', label: uiText("Título 3"), icon: <Heading3 size={15} /> }] as const).map(({ kind, label, icon }) => <MenuItem key={kind} icon={icon} onSelect={() => onFormat(kind)}>{label}</MenuItem>)}
      </Menu>
      <span className="sk-doc-tool-divider" />
      {FORMATS.map(({ kind, label, icon }) => (
        <IconButton key={kind} label={label} disabled={disabled} className="h-7 min-w-7 px-1.5" onMouseDown={(event) => event.preventDefault()} onClick={() => onFormat(kind)}>
          {icon}
        </IconButton>
      ))}
    </div>
  );
}

/** One live document editor with its own history, selection, scroll and collaboration room. */
export function DocView({ slug, active = true, heading, actions, activate }: { slug: string; active?: boolean; heading?: ReactNode; actions?: ReactNode; activate?: () => Promise<void> }) {
  const host = useRef<HTMLDivElement>(null);
  const [formatOpen, setFormatOpen] = useState(false);
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [selectionAnchor, setSelectionAnchor] = useState<SelectionAnchor | null>(null);
  const selectionRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const source = useWorkspace((s) => s.source?.label);
  const sharedRef = useRef<CollaborationClient | null>(null);
  const [status, setStatus] = useState<CollaborationStatus | null>(null);
  const epoch = useCollaborationEpoch();
  const sharedSession = collaborationSession();
  const isShared = !!sharedSession && matchesRemoteSource(sharedSession, source);
  const [ready, setReady] = useState(false);
  const live = useRef(new Compartment()).current;
  // `own()`, not `docs[slug]`: a doc named "constructor" (a valid slug, only `__proto__` is refused)
  // would otherwise resolve to Object.prototype.constructor instead of reading as missing.
  const text = useWorkspace((s) => (s.data ? own(s.data.docs, slug) : undefined) ?? '');
  const mdReady = useMarkdownReady();
  const resolveCitations = useCitationResolver();
  const title = useWorkspace((s) => s.data?.manifest.docs.find((item) => item.slug === slug)?.title ?? slug);
  const wordCount = useMemo(() => text.match(/[\p{L}\p{N}_]+(?:['’−-][\p{L}\p{N}_]+)*/gu)?.length ?? 0, [text]);
  const readingMinutes = Math.max(1, Math.ceil(wordCount / 220));
  const readOnly = isViewOnly();
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!host.current?.contains(target) && !selectionRef.current?.contains(target) && !target.closest('[role="menu"]')) setSelectionAnchor(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectionAnchor(null); };
    window.addEventListener('pointerdown', dismiss, true); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', dismiss, true); window.removeEventListener('keydown', escape); };
  }, []);

  useEffect(() => {
    const session = collaborationSession();
    const shared = session && matchesRemoteSource(session, source) ? collaborationClient(session, `doc:${slug}`) : null;
    sharedRef.current = shared;
    setReady(false);
    setStatus(shared?.status ?? null);
    let unregister = () => {};
    const data = workspace.store.getState().data;
    const ytext = shared?.doc.getText('content');
    const editable = new Compartment();
    let view: EditorView | null = null;
    let applying = false;
    const updateYText = (next: string, origin?: unknown) => {
      if (!shared || !ytext) return;
      const old = ytext.toString();
      if (old === next) return;
      let prefix = 0;
      while (prefix < old.length && prefix < next.length && old[prefix] === next[prefix]) prefix++;
      let suffix = 0;
      while (suffix < old.length - prefix && suffix < next.length - prefix && old[old.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
      shared.doc.transact(() => {
        ytext.delete(prefix, old.length - prefix - suffix);
        ytext.insert(prefix, next.slice(prefix, next.length - suffix));
      }, origin);
    };
    const start = () => {
      if (view || (shared && !shared.ready)) return;
      if (shared) {
        unregister = workspace.registerCollaborativeDoc(slug);
        workspace.applyCollaborativeDoc(slug, ytext!.toString());
      }
      const initialText = shared ? ytext!.toString() : (data ? own(data.docs, slug) : undefined) ?? '';
      view = new EditorView({
        parent: host.current!,
        state: EditorState.create({
          doc: initialText,
          selection: { anchor: initialText.length },
          extensions: [
          editorLanguage,
            history(),
            keymap.of([{ key: 'Mod-b', run: () => { format('bold'); return true; } }, { key: 'Mod-i', run: () => { format('italic'); return true; } }, ...defaultKeymap, ...historyKeymap]),
            markdown({ base: markdownLanguage }),
            documentCommands,
            selectionToolbar(setSelectionAnchor),
            markdownHighlight,
            live.of([]),
            EditorView.lineWrapping,
            EditorView.contentAttributes.of({ 'aria-label': uiText("Conteúdo do documento") }),
            placeholder(uiText("Escreva algo ou digite / para inserir…")),
            editorTheme,
            // A read-only link keeps the editor focusable (the state is read-only): a passage can still be selected to comment on it.
            editable.of(EditorView.editable.of(!shared || shared.status === 'connected')),
            EditorState.readOnly.of(isViewOnly()),
            ...(shared ? remoteCursors : []),
            ...commentMarks,
            EditorView.updateListener.of((update) => {
              if (update.docChanged && !applying) {
                if (!shared) return workspace.setDoc(slug, update.state.doc.toString());
                const changes: { from: number; to: number; insert: string }[] = [];
                update.changes.iterChanges((from, to, _fromB, _toB, insert) => changes.push({ from, to, insert: insert.toString() }));
                shared.doc.transact(() => {
                  for (const change of changes.reverse()) {
                    ytext!.delete(change.from, change.to - change.from);
                    if (change.insert) ytext!.insert(change.from, change.insert);
                  }
                }, view);
                workspace.applyCollaborativeDoc(slug, ytext!.toString());
              }
              // Where this person's cursor is, for the others (only after the text itself reached the shared doc).
              if (shared && !applying && (update.docChanged || update.selectionSet) && update.view.hasFocus) {
                const { anchor, head } = update.state.selection.main;
                shared.setPresence({ doc: selectionPresence(ytext!, anchor, head) });
              }
            }),
          ],
        }),
      });
      viewRef.current = view;
      setReady(true);
    };
    const onYText = (_event: unknown, transaction: { origin: unknown }) => {
      if (!view || transaction.origin === view) return;
      const old = view.state.doc.toString();
      const next = ytext!.toString();
      let prefix = 0;
      while (prefix < old.length && prefix < next.length && old[prefix] === next[prefix]) prefix++;
      let suffix = 0;
      while (suffix < old.length - prefix && suffix < next.length - prefix && old[old.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
      applying = true;
      try { view.dispatch({ changes: { from: prefix, to: old.length - suffix, insert: next.slice(prefix, next.length - suffix) }, annotations: Transaction.addToHistory.of(false) }); }
      finally { applying = false; }
      workspace.applyCollaborativeDoc(slug, next);
    };
    ytext?.observe(onYText);
    // The others' cursors: redrawn on every presence or text change (relative positions are resolved against the live text).
    let refreshQueued = false;
    const refreshCursors = () => {
      if (refreshQueued) return;
      refreshQueued = true;
      queueMicrotask(() => {
        refreshQueued = false;
        if (view && shared && ytext) view.dispatch({ effects: setRemoteCursors.of(resolveCursors(shared.others, ytext)) });
      });
    };
    ytext?.observe(refreshCursors);
    const stopCursors = shared ? shared.subscribe(refreshCursors) : () => {};
    const stopReady = shared ? shared.subscribe(() => {
      setStatus(shared.status);
      start();
      view?.dispatch({ effects: editable.reconfigure(EditorView.editable.of(shared.status === 'connected')) });
    }) : () => {};
    const stopWorkspace = workspace.store.subscribe((state, previous) => {
      const next = state.data ? own(state.data.docs, slug) : undefined;
      const old = previous.data ? own(previous.data.docs, slug) : undefined;
      if (next === undefined || next === old) return;
      if (shared) { if (next !== ytext?.toString()) updateYText(next); }
      else if (view && next !== view.state.doc.toString()) {
        applying = true;
        try { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } }); }
        finally { applying = false; }
      }
    });
    start();
    return () => {
      stopCursors();
      ytext?.unobserve(refreshCursors);
      shared?.setPresence(null);
      stopWorkspace();
      stopReady();
      unregister();
      ytext?.unobserve(onYText);
      if (docCommentBridge.view === view) docCommentBridge.setView(null);
      view?.destroy();
      viewRef.current = null;
      sharedRef.current = null;
      // Deleted here: leave its room (the host sees the file gone and tells the other peers).
      if (shared && session && own(workspace.store.getState().data?.docs ?? {}, slug) === undefined) closeCollaborationClient(session, `doc:${slug}`);
    };
  }, [slug, source, epoch]);

  // Both editors remain mounted. Only the focused pane owns comments, presence and the chat target.
  useEffect(() => {
    if (!active || !ready || !viewRef.current) { setSelectionAnchor(null); return; }
    const view = viewRef.current;
    docCommentBridge.setView(view, slug);
    const stop = sharedRef.current ? showCollaborationClient(sharedRef.current) : () => {};
    return () => { stop(); if (docCommentBridge.view === view) docCommentBridge.setView(null); };
  }, [active, ready, slug, epoch]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: live.reconfigure(mdReady ? livePreviewWithReferences(resolveCitations) : []) });
  }, [ready, live, mdReady, resolveCitations]);

  const insertOutline = (template: 'outline' | 'adr' = 'outline') => {
    const view = viewRef.current;
    if (!view || view.state.readOnly || !view.state.facet(EditorView.editable)) return;
    const outline = template === 'adr' ? uiText("# {0}\n\n## Contexto\n\nDescreva o problema e suas restrições.\n\n## Decisão\n\nRegistre a decisão e sua motivação.\n\n## Consequências\n\nListe os benefícios e os compromissos assumidos.\n", [title]) : uiText("# {0}\n\n## Visão geral\n\nDescreva o objetivo desta arquitetura.\n\n## Componentes\n\n- Componente e sua responsabilidade\n\n## Fluxo de dados\n\nDescreva como os dados percorrem o sistema.\n", [title]);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: outline }, selection: { anchor: outline.indexOf(uiText("Descreva")), head: outline.indexOf(uiText("Descreva")) } , annotations: isolateHistory.of('full') });
    view.focus();
  };

  const format = (kind: FormatKind) => {
    const view = viewRef.current;
    if (!view || view.state.readOnly || !view.state.facet(EditorView.editable)) return;
    const { from, to } = view.state.selection.main;
    const result = applyFormat(view.state.doc.toString(), from, to, kind);
    view.dispatch({ changes: result.change, selection: { anchor: result.selStart, head: result.selEnd }, annotations: isolateHistory.of('full') });
    view.focus();
    requestAnimationFrame(() => { if (viewRef.current === view) view.focus(); });
  };

  const blank = text.trim() === '';
  const starter = blank || text.trim() === `# ${title}`;
  const starters = <div className="sk-doc-starters">
    <p>{uiText("Começar com um modelo")}</p>
    <div>
      <button type="button" onClick={() => insertOutline()}><FileText size={15} /><span>{uiText("Visão da arquitetura")}</span></button>
      <button type="button" onClick={() => insertOutline('adr')}><AlignLeft size={15} /><span>{uiText("Registro de decisão")}</span></button>
    </div>
  </div>;
  return (
    <div className="sk-document" data-active={active} data-empty={blank}>
      <div className="sk-doc-header">
        <div className="sk-doc-heading">
          {heading ?? <div className="sk-doc-breadcrumb"><FileText size={15} className="shrink-0" /><span>{uiText("Documentos")}</span><span aria-hidden>/</span><strong>{title}</strong></div>}
          <div className="sk-doc-header-actions">
            {actions}
            <span className="sk-doc-tool-divider" />
            {!readOnly && <IconButton label={uiText("Mostrar formatação")} pressed={formatOpen} onClick={() => setFormatOpen((value) => !value)}><SlidersHorizontal /></IconButton>}
            <IconButton label={uiText("Vínculos do documento")} pressed={referencesOpen} onClick={() => setReferencesOpen((value) => !value)}><Link2 /></IconButton>
            <ChunkBoundary quiet><Suspense fallback={null}><DocCommentButtons slug={slug} disabled={!ready} activate={activate} /></Suspense></ChunkBoundary>
          </div>
        </div>
        {referencesOpen && <div className="sk-doc-links"><ReferencedBy slug={slug} /></div>}
      </div>
      {formatOpen && <div className="sk-doc-tools"><FormatBar disabled={!ready || readOnly} onFormat={format} /></div>}
      {active && selectionAnchor && !formatOpen && createPortal(<div ref={selectionRef} className="sk-doc-selection-toolbar sk-pop" style={{ left: selectionAnchor.left, top: selectionAnchor.top, width: selectionAnchor.width }} onMouseDown={(event) => event.preventDefault()}><FormatBar label={uiText("Formatação da seleção")} disabled={!ready || readOnly} onFormat={format} /></div>, document.body)}
      <DiagramReferences markdown={text} resolve={resolveCitations} />
      <div className="sk-doc-body">
        <div className="sk-doc-editor">
          <div ref={host} role="group" aria-label={uiText("Editor do documento")} className="sk-doc-editor-host" />
          {isShared && (!ready || status !== 'connected') && <div className="absolute inset-0 flex items-center justify-center bg-panel/90 text-muted">{status === 'error' ? uiText("Falha na colaboração. Verifique a conexão.") : ready ? uiText("Reconectando…") : uiText("Sincronizando documento…")}</div>}
          {starter && <>{blank && <div className="sk-doc-blank-title">{title}</div>}{!readOnly && starters}</>}
        </div>

      </div>
      <div className="sk-doc-footer"><span>{readOnly ? uiText("Somente leitura") : uiText("Edição ao vivo")}</span><span>{wordCount.toLocaleString(getLocale())} {wordCount === 1 ? uiText("palavra") : uiText("palavras")}{wordCount > 0 && uiText(" · {0} min de leitura", [readingMinutes])}</span></div>
    </div>
  );
}
