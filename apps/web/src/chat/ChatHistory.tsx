import { getLocale, uiText } from '../i18n';
import { Ellipsis, Pencil, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { IconButton } from '../ui/IconButton';
import { InlineInput } from '../ui/InlineInput';
import { Menu, MenuItem } from '../ui/Menu';
import { chatStore, useChat } from './session';

const when = (time: number) => {
  const days = Math.floor((Date.now() - time) / 86400000);
  return days < 1 ? uiText("Hoje") : days === 1 ? uiText("Ontem") : `${days} d`;
};

/** Conversations are real workspace sessions, with names, search and independent drafts. */
export function ChatHistory({ compact = false, onOpen, onShowAll }: { compact?: boolean; onOpen: (id: string) => void; onShowAll?: () => void }) {
  const chats = useChat(s => s.chats);
  const activeId = useChat(s => s.activeId);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const filtered = chats.filter(chat => chat.title.toLocaleLowerCase(getLocale()).includes(query.toLocaleLowerCase(getLocale())));
  const shown = compact ? chats.slice(0, 3) : filtered;
  return <section aria-label={uiText("Histórico de conversas")} className={`sk-chat-history ${compact ? 'is-compact' : ''}`}>
    <div className="mb-3 flex items-center justify-between"><h3 className="text-caption font-medium text-muted">{compact ? uiText("Conversas recentes") : uiText("Conversas deste workspace")}</h3><span className="text-meta text-faint">{chats.length}</span></div>
    {!compact && <label className="sk-chat-history-search"><Search size={14} className="shrink-0 text-muted" /><input aria-label={uiText("Buscar conversas")} value={query} onChange={event => setQuery(event.target.value)} placeholder={uiText("Buscar conversas…")} /></label>}
    <ul className="flex flex-col gap-1">
      {shown.map(chat => <li key={chat.id} className="sk-chat-history-row group" data-active={chat.id === activeId || undefined}>
        {editing === chat.id ? <InlineInput initial={chat.title} label={uiText("Nome da conversa")} onCancel={() => setEditing(null)} onCommit={name => { chatStore.getState().renameChat(chat.id, name); setEditing(null); }} /> : <>
          <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => onOpen(chat.id)} title={chat.title} aria-current={chat.id === activeId ? 'page' : undefined}><span className="min-w-0 flex-1 truncate text-body">{chat.title}</span><time className="shrink-0 text-meta text-faint" dateTime={new Date(chat.updatedAt).toISOString()}>{when(chat.updatedAt)}</time></button>
          {!compact && <Menu label={uiText("Ações da conversa")} trigger={<IconButton label={uiText("Ações de {0}", [chat.title])}><Ellipsis /></IconButton>}><MenuItem icon={<Pencil size={14} />} onSelect={() => setEditing(chat.id)}>{uiText("Renomear conversa")}</MenuItem><MenuItem icon={<Trash2 size={14} />} onSelect={() => chatStore.getState().deleteChat(chat.id)}>{uiText("Excluir conversa")}</MenuItem></Menu>}
        </>}
      </li>)}
    </ul>
    {!shown.length && <p className="py-5 text-caption text-muted">{query ? uiText("Nenhuma conversa encontrada.") : uiText("Suas conversas aparecerão aqui.")}</p>}
    {compact && chats.length > 0 && <button type="button" className="mt-3 text-caption text-muted hover:text-ink" onClick={onShowAll}>{uiText("Ver todas as conversas")}</button>}
  </section>;
}
