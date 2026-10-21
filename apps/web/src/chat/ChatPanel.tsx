import { uiText, getLocale } from '../i18n';
import { JoActivity } from './JoActivity';
import { localizedAssistants as BUILTIN_ASSISTANTS } from '../i18n/assistants';
import type { Assistant } from '@strukt/workspace';
import { ArrowDown, ArrowUp, ChevronDown, Copy, FileText, History, MessageCirclePlus, RotateCcw, Settings2, Sparkles, Square, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { renderMarkdown, useMarkdownReady } from '../ai/markdown';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Menu, MenuCheckItem, MenuGroup, MenuItem, MenuLabel, MenuSeparator } from '../ui/Menu';
import { PanelHeader, SidePanel } from '../ui/Panel';
import { closeRightPanel, showToast } from '../ui/uiStore';
import { useWorkspace } from '../workspace/appWorkspace';
import { saveMarkdownAsDoc } from '../workspace/actions';
import { ChatModelPicker } from './ChatModelPicker';
import { ChatHistory } from './ChatHistory';
import { AssistantsDialog } from './AssistantsDialog';
import { linkCitations } from './citations';
import { parseReferenceHref } from './citationAddress';
import { useCitationResolver } from '../workspace/useCitationResolver';
import { DiagramReferences } from '../workspace/DiagramReferences';
import type { CitationResolver } from './citations';
import { goToCitation } from './reveal';
import { chatStore, useChat } from './session';
import type { ChatMessage } from './store';

const SUGGESTIONS = {
  diagram: [uiText("Resuma este diagrama"), uiText("Quais são os pontos únicos de falha?"), uiText("Adicione um cache Redis ao diagrama")],
  doc: [uiText("Resuma este documento"), uiText("Melhore a clareza deste texto"), uiText("Adicione uma seção de decisões")],
  sketch: [uiText("Explique este sketch"), uiText("Adicione um bloco de API"), uiText("Organize o fluxo deste sketch")],
  board: [uiText("Resuma o workspace"), uiText("Quais decisões estão documentadas?"), uiText("Como os diagramas se relacionam?")],
};

const isCitationHref = (href: string) => parseReferenceHref(href) !== null;

/** The answer as Markdown; a citation (`[[Id]]` the workspace has) is a link, and a click on it goes to the element. */
function Answer({ message, resolve }: { message: ChatMessage; resolve: CitationResolver }) {
  const ready = useMarkdownReady();
  const html = useMemo(() => renderMarkdown(linkCitations(message.content, resolve), { citations: isCitationHref }), [message.content, ready, resolve]);
  return (
    <>
    <div
      className="sk-markdown text-body"
      onClick={(event) => {
        const target = parseReferenceHref((event.target as Element).closest('a')?.getAttribute('href'));
        if (!target) return;
        event.preventDefault();
        void goToCitation(target);
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
    <DiagramReferences markdown={message.content} resolve={resolve} />
    </>
  );
}


const runOf = (assistant: Assistant) => ({ name: assistant.name, scope: assistant.scope, ...(assistant.changes ? { changes: true as const } : {}) });
const SCOPE_HINT = { diagram: uiText("diagrama"), workspace: uiText("tudo") } as const;

/** The document title for an assistant's answer: its own first heading (an ADR has one), else the assistant's name. */
const docTitle = (markdown: string, fallback: string) => (/^#{1,2}\s+(.+)$/m.exec(markdown)?.[1] ?? fallback).replace(/[*_`]/g, '').trim().slice(0, 80) || fallback;

/** The side chat: asks the AI about the open diagram, the documents and the rest of the workspace (it reads their JSON/Markdown). */
export function ChatPanel() {
  const kind = useWorkspace((s) => s.view.kind);
  const messages = useChat((s) => s.messages);
  const activity = useChat(s => s.activity);
  const status = useChat((s) => s.status);
  const error = useChat((s) => s.error);
  const offline = useChat((s) => s.offline);
  const chats = useChat((s) => s.chats);
  const activeId = useChat((s) => s.activeId);
  const openTitle = useWorkspace((s) => {
    const { view, data, diagram } = s;
    if (!data) return null;
    if (view.kind === 'board') return uiText("o overview");
    const slug = view.kind === 'diagram' ? diagram : view.slug;
    const list = view.kind === 'diagram' ? data.manifest.diagrams : view.kind === 'doc' ? data.manifest.docs : data.manifest.sketches;
    return list.find((item) => item.slug === slug)?.title ?? null;
  });
  const resolve = useCitationResolver();
  const saved = useWorkspace((s) => s.data?.assistants) ?? [];
  const [managing, setManaging] = useState(false);
  const draft = useChat(s => s.draft);
  const setDraft = (text: string) => chatStore.getState().setDraft(text);
  const [historyView, setHistoryView] = useState(false);
  const title = chats.find(chat => chat.id === activeId)?.title;
  const input = useRef<HTMLTextAreaElement>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [away, setAway] = useState(false);
  const jumpToLatest = () => {
    follow.current = true; setAway(false);
    const el = conversation.current;
    if (el) el.scrollTop = el.scrollHeight;
  };
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    const size = () => {
      el.style.height = '0px';
      el.style.height = `${Math.min(160, Math.max(58, el.scrollHeight))}px`;
      if (follow.current) jumpToLatest();
    };
    size();
    let frame = 0;
    let lastWidth: number | undefined;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined && width !== lastWidth) {
        lastWidth = width;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(size);
      }
    });
    observer.observe(el);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [draft]);
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => { jumpToLatest(); }, [activeId]);
  useLayoutEffect(() => {
    if (follow.current) jumpToLatest();
  }, [messages.length, messages[messages.length - 1]?.content.length, status, error]);
  const openChat = (id: string) => { chatStore.getState().openChat(id); setHistoryView(false); input.current?.focus(); };
  const newChat = () => { chatStore.getState().newChat(); setHistoryView(false); input.current?.focus(); };
  const send = (text: string) => {
    if (!text.trim() || status === 'loading') return;
    follow.current = true; setAway(false);
    setDraft(''); setHistoryView(false);
    void chatStore.getState().send(text);
  };
  const searchActivity = useChat(s => s.searchActivity);
  const loading = status === 'loading';
  /** An assistant starts its own conversation: it reads a different slice of the workspace than a free question. */
  const runAssistant = (assistant: Assistant) => {
    if (loading) return;
    chatStore.getState().newChat();
    void chatStore.getState().send(assistant.instruction, runOf(assistant));
  };
  return (
    <SidePanel label={uiText("Chat com a IA")} className="sk-chat-panel">
      <PanelHeader
        title={"Chat"}
        onClose={() => closeRightPanel('chat')}
        closeLabel={uiText("Fechar chat")}
        actions={
          <>
            <Menu
              label={uiText("Assistentes")}
              trigger={
                <IconButton label={uiText("Assistentes")}>
                  <Sparkles />
                </IconButton>
              }
            >
              <MenuGroup label={uiText("Embutidos")}>
                {BUILTIN_ASSISTANTS.map((assistant) => (
                  <MenuItem key={assistant.id} hint={SCOPE_HINT[assistant.scope]} disabled={loading} onSelect={() => runAssistant(assistant)}>
                    {assistant.name}
                  </MenuItem>
                ))}
              </MenuGroup>
              {saved.length > 0 && (
                <>
                  <MenuSeparator />
                  <MenuGroup label={uiText("Deste workspace")}>
                    {saved.map((assistant) => (
                      <MenuItem key={assistant.id} hint={SCOPE_HINT[assistant.scope]} disabled={loading} onSelect={() => runAssistant(assistant)}>
                        {assistant.name}
                      </MenuItem>
                    ))}
                  </MenuGroup>
                </>
              )}
              <MenuSeparator />
              <MenuItem icon={<Settings2 size={14} />} onSelect={() => setManaging(true)}>{uiText("Gerenciar assistentes…")}</MenuItem>
            </Menu>
            {chats.length > 0 && (
              <Menu
                label={uiText("Conversas")}
                trigger={
                  <IconButton label={uiText("Conversas anteriores")}>
                    <History />
                  </IconButton>
                }
              >
                <MenuLabel>{uiText("Conversas deste workspace")}</MenuLabel>
                <MenuItem onSelect={() => setHistoryView(true)}>{uiText("Ver todas as conversas")}</MenuItem>
                <MenuSeparator />
                {chats.map((chat) => (
                  <MenuCheckItem key={chat.id} checked={chat.id === activeId} description={new Date(chat.updatedAt).toLocaleString(getLocale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} onSelect={() => openChat(chat.id)}>
                    {chat.title}
                  </MenuCheckItem>
                ))}
              </Menu>
            )}
            <IconButton label={uiText("Nova conversa")} onClick={newChat}>
                <MessageCirclePlus />
              </IconButton>
            {activeId !== null && (
              <IconButton label={uiText("Apagar conversa")} onClick={() => chatStore.getState().clear()}>
                <Trash2 />
              </IconButton>
            )}
          </>
        }
      />
      {(title || historyView) && <div className="sk-chat-session-title"><span className="truncate" title={title}>{historyView ? uiText("Histórico de conversas") : title}</span>{historyView && <button type="button" onClick={() => setHistoryView(false)} className="shrink-0 text-caption text-muted hover:text-ink">{uiText("Voltar")}</button>}</div>}
      {historyView ? <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4"><ChatHistory onOpen={openChat} /></div> : <div ref={conversation} role="log" aria-label={uiText("Mensagens da conversa")} aria-busy={loading}
        onScroll={(event) => {
          const el = event.currentTarget;
          const paused = el.scrollHeight - el.scrollTop - el.clientHeight > 64;
          follow.current = !paused; setAway(paused);
        }}
        className="sk-chat-conversation flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3.5 py-3.5" aria-live="polite">
        {messages.length === 0 && (
          <div className="sk-chat-empty flex flex-col gap-4 text-body">
            {chats.length > 0 && <ChatHistory compact onOpen={openChat} onShowAll={() => setHistoryView(true)} />}
            <div className="pt-4 pb-1"><img src="/brand/jo-connected-v2.webp" width="1536" height="1024" alt="" className="mb-3 h-20 w-30 object-contain" /><h3 className="text-heading font-medium tracking-tight text-ink">{uiText("O que vamos construir?")}</h3><p className="mt-2 text-caption leading-relaxed text-muted">{uiText("Explore a arquitetura ou peça uma alteração em")} {openTitle ? uiText("“{0}”", [openTitle]) : uiText("seu workspace")}.</p></div>
            <div className="flex flex-col items-start gap-1.5">
              {SUGGESTIONS[kind].map((text) => (
                <button key={text} type="button" onClick={() => { setDraft(text); input.current?.focus(); }} className="w-full rounded-control bg-panel-2/50 px-3 py-2.5 text-left text-caption text-muted transition-colors hover:bg-panel-2 hover:text-ink">
                  {text}
                </button>
              ))}
            </div>
            <details className="sk-chat-assistants">
              <summary className="flex cursor-pointer list-none items-center justify-between rounded-control px-2 py-1.5 text-caption text-muted hover:bg-panel-2 hover:text-ink">{uiText("Análises especializadas")}<ChevronDown size={13} aria-hidden /></summary>
              <div className="mt-2 flex flex-col gap-1">
              {[...BUILTIN_ASSISTANTS, ...saved].map((assistant) => (
                <button key={assistant.id} type="button" onClick={() => runAssistant(assistant)} className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-caption text-muted transition-colors hover:bg-panel-2 hover:text-ink">
                  <Sparkles size={12} className="flex-none text-muted" />
                  {assistant.name}
                </button>
              ))}
              </div>
            </details>
          </div>
        )}
        {messages.map((message, index) =>
          message.role === 'user' ? (
            message.assistant ? (
              <div key={message.id} data-role="user" data-assistant={message.assistant.name} className="flex max-w-[88%] flex-col gap-1 self-end rounded-control bg-accent-soft px-3 py-2">
                <span className="flex items-center gap-1 text-caption font-semibold text-accent">
                  <Sparkles size={12} /> {message.assistant.name}
                </span>
                <p className="line-clamp-3 whitespace-pre-wrap break-words text-caption text-muted">{message.content}</p>
              </div>
            ) : (
              <p key={message.id} data-role="user" className="sk-chat-user max-w-[88%] self-end whitespace-pre-wrap break-words rounded-control bg-accent-soft px-3 py-2 text-body">{message.content}</p>
            )
          ) : (
            <div key={message.id} data-role="assistant" className="max-w-full self-start break-words">
              <Answer message={message} resolve={resolve} />
              {message.changeSummary && <div className="mt-2 rounded-control bg-panel-2 p-2.5 text-caption">
                <p className="text-muted">{message.changeSummary}</p>
                {message.undo && <Button size="sm" className="mt-2" disabled={loading} icon={<RotateCcw size={12} />} onClick={() => chatStore.getState().undoChange(message.id)}>{uiText("Desfazer alteração")}</Button>}
              </div>}
              {!(loading && index === messages.length - 1) && <div className="sk-chat-message-actions">
                <IconButton label={uiText("Copiar resposta")} iconSize={14} onClick={() => { void navigator.clipboard.writeText(message.content).then(() => showToast(uiText("Resposta copiada.")), () => showToast(uiText("Não foi possível copiar."))); }}><Copy /></IconButton>
                {!messages[index - 1]?.assistant && <IconButton label={uiText("Salvar resposta como documento")} iconSize={14} onClick={() => void saveMarkdownAsDoc(docTitle(message.content, title || uiText("Resposta do chat")), message.content)}><FileText /></IconButton>}
              </div>}
              {message.interrupted && <div className="mt-1 flex flex-wrap items-center gap-2"><p className="text-caption text-faint">{uiText("Resposta interrompida.")}</p>{index === messages.length - 1 && !loading && !error && <Button size="sm" variant="ghost" icon={<RotateCcw size={12} />} onClick={() => void chatStore.getState().retry()}>{uiText("Gerar novamente")}</Button>}</div>}
              {messages[index - 1]?.assistant && !message.interrupted && !(loading && index === messages.length - 1) && (
                <Button size="sm" className="mt-2" icon={<FileText size={13} />} onClick={() => void saveMarkdownAsDoc(docTitle(message.content, messages[index - 1]!.assistant!.name), message.content)}>{uiText("Salvar como documento")}</Button>
              )}
            </div>
          ),
        )}
        {loading && <JoActivity phase={searchActivity?.status === 'searching' ? 'searching' : activity} detail={searchActivity?.status === 'searching' ? searchActivity.query : undefined} />}
        {error && (
          <div role="alert" className="flex flex-col items-start gap-2 text-body text-danger">
            <p>{error}</p>
            {!offline && (
              <Button size="sm" icon={<RotateCcw size={13} />} onClick={() => void chatStore.getState().retry()}>{uiText("Tentar de novo")}</Button>
            )}
          </div>
        )}
      </div>}
      {away && !historyView && <div className="flex shrink-0 justify-center pb-2">
        <Button size="sm" icon={<ArrowDown size={13} />} onClick={jumpToLatest}>{uiText("Última resposta")}</Button>
      </div>}
      <form
        className="sk-chat-compose flex shrink-0 flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
      >
        <div className="sk-chat-compose-tools">
          <span className="sk-chat-context" title={openTitle ? uiText("Lendo: {0}", [openTitle]) : uiText("Lendo o workspace")}><FileText size={12} /><span className="truncate">{openTitle ? uiText("Lendo: {0}", [openTitle]) : "Workspace"}</span></span>
          {loading && <span role="status" className="ml-auto text-meta text-muted">{searchActivity?.status === 'searching' ? uiText("Pesquisando…") : uiText("Respondendo…")}</span>}
        </div>
        <textarea
          ref={input}
          aria-label={uiText("Mensagem para a IA")}
          rows={1}
          value={draft}
          placeholder={uiText("Pergunte ou peça uma alteração…")}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send(draft);
            }
          }}
          className="max-h-40 min-h-8 w-full resize-none rounded-control border border-line-strong bg-panel-2 px-2.5 py-1.5 text-body outline-none focus:border-accent"
        />
        <div className="sk-chat-compose-tools">
          <ChatModelPicker disabled={loading} />
          <span className="flex-1" />
        {loading ? (
          <IconButton label={uiText("Parar")} onClick={() => chatStore.getState().stop()}>
            <Square />
          </IconButton>
        ) : (
          <IconButton label={uiText("Enviar")} type="submit" disabled={!draft.trim()} className={draft.trim() ? 'sk-chat-send' : ''}>
            <ArrowUp />
          </IconButton>
        )}
        </div>
      </form>
      <AssistantsDialog open={managing} saved={saved} onClose={() => setManaging(false)} />
    </SidePanel>
  );
}
