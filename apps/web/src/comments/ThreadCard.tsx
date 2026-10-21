import { uiText } from '../i18n';
import { liveMessages, isMentioned } from '@strukt/workspace';
import type { CommentMessage, CommentThread } from '@strukt/workspace';
import type { DiagramModel } from '@strukt/core';
import { Check, Crosshair, MoreHorizontal, Pencil, RotateCcw, Spline, Square, TextQuote, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Menu, MenuItem } from '../ui/Menu';
import { Composer } from './Composer';
import { anchorLabel, relativeTime, splitMentions } from './format';
import type { AnchorLabel } from './format';
import { comments, useWho } from './session';

const ICONS = { node: Square, edge: Spline, point: Crosshair, text: TextQuote } as const;

/** The time of the thread's latest activity: what the list is ordered by. */
export const activityOf = (thread: CommentThread): number => Math.max(thread.statusAt, ...thread.messages.map((message) => Math.max(message.at, message.edited ?? 0)));

/** An open conversation that others wrote to mention you in. */
export function mentionsYou(thread: CommentThread, name: string, owner: string): boolean {
  return thread.status === 'open' && liveMessages(thread).some((message) => message.owner !== owner && isMentioned(message, name));
}

/** A comment's words as React text (never HTML), with the people it mentions picked out. */
export function CommentText({ message }: { message: CommentMessage }) {
  return (
    <p className="whitespace-pre-wrap break-words text-body leading-snug">
      {splitMentions(message.text, message.mentions).map((part, index) => (part.mention
        ? <span key={index} className="rounded-[4px] bg-accent-soft px-0.5 font-medium text-accent">{part.text}</span>
        : <span key={index}>{part.text}</span>))}
    </p>
  );
}

function MessageRow({ thread, message, now }: { thread: CommentThread; message: CommentMessage; now: number }) {
  const who = useWho();
  const [editing, setEditing] = useState(false);
  const mine = message.owner === who.owner;
  const may = who.canWrite && (mine || who.moderator);
  return (
    <li data-message={message.id} className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-caption">
        <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: message.author.color }} />
        <span className="min-w-0 truncate font-medium text-ink">{message.author.name}</span>
        <span className="shrink-0 text-faint">{relativeTime(message.at, now)}{message.edited ? ' · editado' : ''}</span>
        <span className="flex-1" />
        {may && !editing && (
          <Menu label={uiText("Ações do comentário de {0}", [message.author.name])} trigger={<IconButton label={uiText("Ações do comentário de {0}", [message.author.name])} iconSize={14}><MoreHorizontal /></IconButton>}>
            <MenuItem icon={<Pencil size={15} />} onSelect={() => setEditing(true)}>{uiText("Editar")}</MenuItem>
            <MenuItem icon={<Trash2 size={15} />} danger onSelect={() => void comments.remove(thread.id, message.id)}>{uiText("Excluir comentário")}</MenuItem>
          </Menu>
        )}
      </div>
      {editing
        ? <Composer label={uiText("Editar comentário")} placeholder={uiText("Edite o comentário")} submitLabel={uiText("Salvar")} initial={message.text} autoFocus onCancel={() => setEditing(false)} onSubmit={async (text) => { const ok = await comments.edit(thread.id, message.id, text); if (ok) setEditing(false); return ok; }} />
        : <CommentText message={message} />}
    </li>
  );
}

interface ThreadCardProps {
  thread: CommentThread;
  model: DiagramModel | null;
  /** Overrides the label (a doc anchor that was found, or lost, says so). */
  label?: AnchorLabel;
  active: boolean;
  now: number;
  /** Takes the viewer to what the conversation is about. */
  onJump?(thread: CommentThread): void;
  /** In a popover on the canvas the card has no frame of its own. */
  bare?: boolean;
}

/** One conversation: what it is about, the messages, a reply box and Resolver/Reabrir. */
export function ThreadCard({ thread, model, label, active, now, onJump, bare }: ThreadCardProps) {
  const who = useWho();
  const where = label ?? anchorLabel(thread.anchor, model);
  const Icon = ICONS[where.icon];
  const messages = liveMessages(thread);
  const resolved = thread.status === 'resolved';
  const forYou = mentionsYou(thread, who.name, who.owner);
  const mayDelete = who.canWrite && (thread.by === who.owner || who.moderator);
  return (
    <article
      data-thread={thread.id}
      aria-label={uiText("Conversa sobre {0}", [where.text])}
      className={`flex flex-col gap-2.5 ${bare ? '' : `rounded-control border p-2.5 ${active ? 'border-accent' : 'border-line'} ${resolved ? 'bg-panel-2' : 'bg-panel'}`}`}
    >
      <header className="flex items-center gap-1.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-caption font-medium text-ink hover:text-accent disabled:cursor-default disabled:hover:text-ink"
          disabled={!onJump || where.orphan}
          onClick={() => onJump?.(thread)}
          title={where.orphan ? where.note : uiText("Ir para o ponto da conversa")}
        >
          <Icon size={13} className="shrink-0 text-muted" />
          <span className="truncate">{where.text}</span>
          {where.note && <span className="shrink-0 font-normal text-faint">({where.note}{")"}</span>}
        </button>
        {forYou && <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-caption font-medium text-accent">{uiText("Para você")}</span>}
        {resolved && <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-caption text-muted">{uiText("Resolvido")}</span>}
        {mayDelete && (
          <Menu label={uiText("Ações da conversa")} trigger={<IconButton label={uiText("Ações da conversa")} iconSize={14}><MoreHorizontal /></IconButton>}>
            <MenuItem icon={<Trash2 size={15} />} danger onSelect={() => void comments.deleteThread(thread.id)}>{uiText("Excluir conversa")}</MenuItem>
          </Menu>
        )}
      </header>
      <ul className="flex flex-col gap-2.5">
        {messages.map((message) => <MessageRow key={message.id} thread={thread} message={message} now={now} />)}
      </ul>
      {resolved && thread.statusBy && <p className="text-caption text-faint">{uiText("Resolvido por")} {thread.statusBy.name} {"·"} {relativeTime(thread.statusAt, now)}</p>}
      {who.canWrite && (
        <div className="flex flex-col gap-2">
          {!resolved && <Composer label={uiText("Responder à conversa")} placeholder={uiText("Responder…")} submitLabel={uiText("Responder")} onSubmit={(text) => comments.reply(thread.id, text)} />}
          <Button
            size="sm"
            variant={resolved ? 'secondary' : 'ghost'}
            className="self-start"
            icon={resolved ? <RotateCcw size={13} /> : <Check size={13} />}
            onClick={() => void comments.setStatus(thread.id, resolved ? 'open' : 'resolved')}
          >
            {resolved ? uiText("Reabrir") : uiText("Resolver")}
          </Button>
        </div>
      )}
    </article>
  );
}
