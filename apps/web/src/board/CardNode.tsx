import { uiText } from '../i18n';
import { ITEM_LIST, NOTE_COLORS, docExcerpt, sketchElementCount, updateCard } from '@strukt/workspace';
import type { BoardCard, ItemKind } from '@strukt/workspace';
import { Handle, NodeToolbar, Position } from '@xyflow/react';
import { ArrowUpRight } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { renderMarkdown, useMarkdownReady } from '../docs/markdown';
import { sketchThumbnail } from '../sketch/thumbnail';
import { useUi } from '../ui/uiStore';
import { openItem } from '../workspace/actions';
import { useWorkspace, workspace } from '../workspace/appWorkspace';
import { ITEM_ICONS } from '../workspace/labels';
import { diagramFor, docFor, sketchFor } from './boardFlow';
import type { CardNode } from './boardFlow';
import { useDiagramThumbnail } from './thumbnail';

function DiagramPreview({ slug }: { slug: string }) {
  const snapshot = useWorkspace((s) => diagramFor(s.data, slug));
  const theme = useUi((s) => s.theme);
  const url = useDiagramThumbnail(snapshot, theme);
  if (!snapshot?.model.order.length) return <span className="strukt-card__empty">{uiText("Diagrama vazio")}</span>;
  return url ? <img className="strukt-card__thumb" src={url} alt="" draggable={false} /> : null;
}

function DocPreview({ slug }: { slug: string }) {
  const text = useWorkspace((s) => docFor(s.data, slug) ?? '');
  const ready = useMarkdownReady();
  const html = useMemo(() => renderMarkdown(docExcerpt(text)), [text, ready]);
  return <div className="sk-markdown strukt-card__md" dangerouslySetInnerHTML={{ __html: html }} />;
}

function SketchPreview({ slug }: { slug: string }) {
  const text = useWorkspace((s) => sketchFor(s.data, slug) ?? '');
  const count = sketchElementCount(text);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!count) return setUrl(null);
    let alive = true;
    const timer = setTimeout(() => {
      void sketchThumbnail(text).then((next) => {
        if (alive) setUrl(next);
      });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [text, count]);
  if (url) return <img className="strukt-card__thumb" src={url} alt="" draggable={false} />;
  return <span className="strukt-card__empty">{count ? `${count} ${count === 1 ? uiText("elemento") : uiText("elementos")}` : uiText("Sketch vazio")}</span>;
}

function ItemBody({ card }: { card: BoardCard }) {
  const kind = card.kind as ItemKind;
  const slug = card.slug ?? '';
  const title = useWorkspace((s) => s.data?.manifest[ITEM_LIST[kind]].find((e) => e.slug === slug)?.title ?? '');
  const Icon = ITEM_ICONS[kind];
  return (
    <>
      <header className="strukt-card__head">
        <Icon size={13} className="flex-none" />
        <span className="truncate">{title}</span>
      </header>
      <div className="strukt-card__body">
        {kind === 'diagram' && <DiagramPreview slug={slug} />}
        {kind === 'doc' && <DocPreview slug={slug} />}
        {kind === 'sketch' && <SketchPreview slug={slug} />}
      </div>
    </>
  );
}

/** Above a selected diagram/doc/sketch card: takes you to the item the card shows. */
function OpenCard({ card }: { card: BoardCard }) {
  const kind = card.kind as ItemKind;
  const slug = card.slug ?? '';
  const title = useWorkspace((s) => s.data?.manifest[ITEM_LIST[kind]].find((e) => e.slug === slug)?.title ?? '');
  return (
    <button type="button" aria-label={uiText("Abrir {0}", [title])} className="sk-float nopan flex h-8 items-center gap-1.5 rounded-control px-3 text-caption font-medium text-ink hover:bg-panel-2" onClick={() => void openItem(kind, slug)}>{uiText("Abrir")} <ArrowUpRight size={13} />
    </button>
  );
}

function NoteBody({ card, autoFocus }: { card: BoardCard; autoFocus: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // `preventScroll`: focusing must not scroll the board's pane (the note is already placed in view).
  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  return (
    <>
      <div className="strukt-card__grip" aria-hidden />
      <textarea
        ref={ref}
        className="strukt-card__note nodrag nowheel"
        aria-label={uiText("Texto da nota")}
        placeholder={uiText("Escreva…")}
        value={card.text ?? ''}
        onChange={(event) => workspace.updateBoard((board) => updateCard(board, card.id, { text: event.target.value }))}
      />
    </>
  );
}

function NoteColors({ card }: { card: BoardCard }) {
  const current = card.color ?? NOTE_COLORS[0];
  return (
    <div className="strukt-card__colors" role="group" aria-label={uiText("Cor da nota")}>
      {NOTE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={uiText("Cor {0}", [color])}
          aria-pressed={current === color}
          style={{ background: color }}
          onClick={() => workspace.updateBoard((board) => updateCard(board, card.id, { color }))}
        />
      ))}
    </div>
  );
}

/** A Overview card: live preview of a diagram/doc/sketch, or a post-it note. The right port starts connections. */
export const CardNodeView = memo(function CardNodeView({ data, selected }: NodeProps<CardNode>) {
  const { card, autoFocus } = data;
  const note = card.kind === 'note';
  return (
    <div
      className={`strukt-card${note ? ' strukt-card--note' : ''}`}
      data-kind={card.kind}
      data-selected={selected || undefined}
      style={note ? { background: card.color ?? NOTE_COLORS[0] } : undefined}
    >
      {note ? <NoteBody card={card} autoFocus={autoFocus} /> : <ItemBody card={card} />}
      {note ? (
        <NodeToolbar isVisible={selected} position={Position.Top}>
          <NoteColors card={card} />
        </NodeToolbar>
      ) : (
        <NodeToolbar position={Position.Top}>
          <OpenCard card={card} />
        </NodeToolbar>
      )}
      <Handle type="target" position={Position.Left} className="strukt-card__port strukt-card__port--in" />
      <Handle type="source" position={Position.Right} className="strukt-card__port" title={uiText("Arraste até outro card para conectar")} />
    </div>
  );
});
