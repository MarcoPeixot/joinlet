import { uiText } from '../i18n';
import { own } from '@strukt/core';
import { liveThreads } from '@strukt/workspace';
import type { CommentThread } from '@strukt/workspace';
import { useReactFlow } from '@xyflow/react';
import { MessageSquarePlus, MessagesSquare, MousePointerClick, Pencil } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { docCommentBridge } from '../docs/commentBridge';
import { diagramStore, useDiagram } from '../state/appStore';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';
import { Segmented, inputClass } from '../ui/controls';
import { PanelHeader, SidePanel } from '../ui/Panel';
import { pluralize } from '../ui/plural';
import { closeRightPanel } from '../ui/uiStore';
import { openItem } from '../workspace/actions';
import { useWorkspace } from '../workspace/appWorkspace';
import { Composer, NameGate } from './Composer';
import { resolveDocThreads } from './docRanges';
import { anchorLabel } from './format';
import type { AnchorLabel } from './format';
import { comments, setCommentName, targetOf, useComments, useWho } from './session';
import { commentOnSelection, commentSelection } from './selection';
import { ThreadCard, activityOf, mentionsYou } from './ThreadCard';
import { targetKey } from './store';

/** Takes the viewer to what a conversation is about: the node or point on the canvas, the passage in the doc. */
export function useJump() {
  const flow = useReactFlow();
  return (thread: CommentThread, range?: { from: number; to: number } | null) => {
    comments.open(thread.id);
    const { anchor } = thread;
    if (anchor.type === 'text') {
      const view = docCommentBridge.view;
      if (view && range) view.dispatch({ selection: { anchor: range.from, head: range.to }, scrollIntoView: true });
      return;
    }
    const diagram = diagramStore.getState();
    if (anchor.type === 'point') {
      void flow.setCenter(anchor.x, anchor.y, { duration: 200, zoom: Math.max(flow.getZoom(), 0.8) });
      return;
    }
    if (anchor.type === 'node') {
      if (!own(diagram.model.elements, anchor.id)) return;
      diagram.select({ nodes: [anchor.id], edges: [] });
      void flow.fitView({ nodes: [{ id: anchor.id }], duration: 200, maxZoom: 1.2, padding: 0.8 });
      return;
    }
    const edge = diagram.model.edges.find((item) => item.id === anchor.id);
    if (!edge) return;
    diagram.select({ nodes: [], edges: [edge.id] });
    void flow.fitView({ nodes: [{ id: edge.from }, { id: edge.to }], duration: 200, maxZoom: 1.2, padding: 0.5 });
  };
}

function WhoAmI() {
  const who = useWho();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(who.name);
  const [problem, setProblem] = useState<string | null>(null);
  if (!who.named) return null;
  const save = () => {
    try { setCommentName(name); setEditing(false); setProblem(null); }
    catch (error) { setProblem(error instanceof Error ? error.message : String(error)); }
  };
  return (
    <div className="flex flex-col gap-1.5 border-b border-line px-3.5 py-2">
      {editing ? (
        <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); save(); }}>
          <input aria-label={uiText("Seu nome nos comentários")} className={`${inputClass} h-8 min-w-0 flex-1`} value={name} autoFocus onChange={(event) => setName(event.target.value)} />
          <Button type="submit" size="sm" variant="primary">{uiText("Salvar")}</Button>
          <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setProblem(null); }}>{uiText("Cancelar")}</Button>
        </form>
      ) : (
        <div className="flex items-center gap-1.5 text-caption text-muted">
          <span>{uiText("Comentando como")}</span>
          <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: who.color }} />
          <strong className="min-w-0 truncate font-medium text-ink">{who.name}</strong>
          <IconButton label={uiText("Mudar meu nome")} iconSize={12} onClick={() => { setName(who.name); setEditing(true); }}><Pencil /></IconButton>
        </div>
      )}
      {problem && <p role="alert" className="text-caption text-danger">{problem}</p>}
    </div>
  );
}

export function CommentsPanel() {
  const view = useWorkspace((state) => state.view);
  const diagram = useWorkspace((state) => state.diagram);
  const manifest = useWorkspace((state) => state.data?.manifest);
  const target = targetOf(view, diagram);
  const onDiagram = target?.kind === 'diagram';
  const docText = useWorkspace((state) => (view.kind === 'doc' && state.data ? own(state.data.docs, view.slug) : undefined)) ?? '';
  const model = useDiagram((state) => state.model);
  const file = useComments((state) => state.file);
  const filter = useComments((state) => state.filter);
  const active = useComments((state) => state.active);
  const draft = useComments((state) => state.draft);
  const loaded = useComments((state) => state.loaded);
  const broken = useComments((state) => state.broken);
  const warnings = useComments((state) => state.warnings);
  const summary = useComments((state) => state.summary);
  const commentMode = useComments((state) => state.tool);
  const who = useWho();
  const jump = useJump();
  const now = Date.now();

  const threads = useMemo(() => liveThreads(file), [file]);
  const ranges = useMemo(() => (target?.kind === 'doc' ? resolveDocThreads(docText, threads) : new Map()), [target?.kind, docText, threads]);
  const open = threads.filter((thread) => thread.status === 'open');
  const resolved = threads.filter((thread) => thread.status === 'resolved');
  const shown = (filter === 'open' ? open : resolved).slice().sort((a, b) => Number(mentionsYou(b, who.name, who.owner)) - Number(mentionsYou(a, who.name, who.owner)) || activityOf(b) - activityOf(a));

  // Looking at the panel is reading what mentions you: it stops being new a moment after it is on screen.
  // A pin that was clicked brings its conversation into view in the list.
  useEffect(() => {
    if (active) document.querySelector(`[data-thread="${CSS.escape(active)}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);
  useEffect(() => {
    const timer = setTimeout(() => comments.markSeen(), 1200);
    return () => clearTimeout(timer);
  }, [file, target?.slug]);

  const labelOf = (thread: CommentThread): AnchorLabel | undefined => {
    if (thread.anchor.type !== 'text') return undefined;
    const base = anchorLabel(thread.anchor, null);
    const found = ranges.get(thread.id);
    if (!found) return { ...base, orphan: true, note: uiText("trecho não encontrado") };
    return found.exact ? base : { ...base, note: uiText("trecho editado") };
  };

  const elsewhere = Object.entries(summary)
    .filter(([key, entry]) => key !== (target ? targetKey(target) : '') && entry.mentions > 0)
    .map(([key, entry]) => {
      const [kind, slug] = [key.slice(0, key.indexOf(':')) as 'diagram' | 'doc', key.slice(key.indexOf(':') + 1)];
      const title = (kind === 'diagram' ? manifest?.diagrams : manifest?.docs)?.find((item) => item.slug === slug)?.title ?? slug;
      return { kind, slug, title, mentions: entry.mentions };
    });

  const subtitle = !target ? uiText("Sem comentários neste item") : `${pluralize(open.length, uiText("conversa aberta"), uiText("conversas abertas"), 'f')}${resolved.length ? ` · ${resolved.length} ${resolved.length === 1 ? uiText("resolvida") : uiText("resolvidas")}` : ''}`;
  return (
    <SidePanel label={uiText("Comentários")}>
      <PanelHeader icon={<MessagesSquare size={14} />} title={uiText("Comentários")} subtitle={subtitle} onClose={() => closeRightPanel('comments')} />
      {!target ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <EmptyState illustration="docs" title={uiText("Aqui não há comentários")} text={uiText("Abra um diagrama ou um documento para comentar. Overview e sketches não têm comentários.")} />
        </div>
      ) : (
        <>
          <WhoAmI />
          <div className="flex flex-col gap-2 border-b border-line px-3.5 py-3">
            {who.canWrite && (onDiagram ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant={commentMode ? 'primary' : 'secondary'} icon={<MousePointerClick size={13} />} aria-pressed={commentMode} onClick={() => comments.setTool(!commentMode)}>
                  {commentMode ? uiText("Clique no canvas…") : uiText("Comentar no canvas")}
                </Button>
                <Button size="sm" variant="ghost" onClick={commentOnSelection}>{uiText("Comentar na seleção")}</Button>
              </div>
            ) : (
              <Button size="sm" variant="secondary" className="self-start" icon={<MessageSquarePlus size={13} />} onClick={commentSelection}>{uiText("Comentar a seleção")}</Button>
            ))}
            {draft && !onDiagram && (
              <div data-draft className="flex flex-col gap-2 rounded-control border border-accent p-2.5">
                <p className="text-caption font-medium">{uiText("Novo comentário sobre")} {anchorLabel(draft.anchor, null).text}</p>
                <Composer label={uiText("Novo comentário")} placeholder={uiText("Escreva o comentário…")} submitLabel={uiText("Comentar")} autoFocus onCancel={() => comments.cancelDraft()} onSubmit={(text) => comments.createThread(draft.anchor, text)} />
              </div>
            )}
            {draft && onDiagram && (
              <p role="status" className="rounded-control border border-accent px-2.5 py-2 text-caption text-muted">{uiText("Escreva o comentário no ponto marcado, no canvas.")}</p>
            )}
            <NameGate>{null}</NameGate>
            <Segmented
              value={filter}
              onChange={(next) => comments.setFilter(next)}
              options={[{ value: 'open', label: uiText("Abertos ({0})", [open.length]) }, { value: 'resolved', label: uiText("Resolvidos ({0})", [resolved.length]) }]}
            />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
            {broken && <p role="alert" className="rounded-control border border-danger px-2.5 py-2 text-caption text-danger">{broken} {uiText("Corrija ou apague o arquivo em .arch/comments/ para voltar a comentar.")}</p>}
            {warnings.length > 0 && <p role="status" className="text-caption text-muted">{warnings[0]}</p>}
            {!loaded && <p className="text-caption text-muted">{uiText("Carregando comentários…")}</p>}
            {loaded && shown.length === 0 && !broken && (
              <EmptyState
                illustration="docs"
                title={filter === 'open' ? uiText("Nenhuma conversa aberta") : uiText("Nenhuma conversa resolvida")}
                text={filter === 'open' ? (onDiagram ? uiText("Use a ferramenta Comentar (C) e clique em um nó, uma conexão ou um ponto do canvas.") : uiText("Selecione um trecho do documento e comente (⌘⌥M).")) : uiText("As conversas que você resolver aparecem aqui, e podem ser reabertas.")}
              />
            )}
            {shown.map((thread) => (
              <ThreadCard key={thread.id} thread={thread} model={onDiagram ? model : null} label={labelOf(thread)} active={active === thread.id} now={now} onJump={(entry) => jump(entry, ranges.get(entry.id))} />
            ))}
            {elsewhere.length > 0 && (
              <section aria-label={uiText("Menções em outros itens")} className="mt-1 flex flex-col gap-1.5 border-t border-line pt-3">
                <h3 className="sk-label">{uiText("Menções para você em outros itens")}</h3>
                {elsewhere.map((item) => (
                  <button key={`${item.kind}:${item.slug}`} type="button" className="flex items-center gap-2 rounded-control border border-line px-2.5 py-1.5 text-left text-caption hover:border-line-strong" onClick={() => { void openItem(item.kind, item.slug); }}>
                    <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
                    <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">{item.mentions}</span>
                  </button>
                ))}
              </section>
            )}
          </div>
        </>
      )}
    </SidePanel>
  );
}
