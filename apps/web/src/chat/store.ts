import { uiText } from '../i18n';
import { readChatModel } from '@strukt/core';
import type { ChatModelChoice, ChatSearchActivity } from '@strukt/core';
import { createStore } from 'zustand/vanilla';
import type { ChatReply, ChatTurn } from '../ai/client';
import { chatTitle, loadChats, migrateChats, saveChats } from './history';
import type { AssistantRun, Chat, ChatStorage, StoredMessage } from './history';

export type ChatMessage = StoredMessage;
export interface ChatSummary { id: string; title: string; updatedAt: number }

export interface ChatState {
  /** The open conversation. */
  messages: ChatMessage[];
  /** This workspace's conversations, newest first (the open one included once it has a question). */
  chats: ChatSummary[];
  activeId: string | null;
  draft: string;
  modelChoice: ChatModelChoice | null;
  setModelChoice(choice: ChatModelChoice | null): void;
  setDraft(text: string): void;
  renameChat(id: string, title: string): void;
  status: 'idle' | 'loading';
  activity: 'thinking' | 'writing' | 'applying';
  searchActivity: ChatSearchActivity | null;
  error: string | null;
  /** The AI server is not reachable (or has no key): the panel explains instead of offering "try again". */
  offline: boolean;
  /** `assistant`: the question is an assistant's instruction; the context follows its scope. */
  send(text: string, assistant?: AssistantRun): Promise<void>;
  retry(): Promise<void>;
  undoChange(id: number): void;
  /** Cancels the answer being written and keeps what was written. */
  stop(): void;
  /** Deletes the open conversation. */
  clear(): void;
  newChat(): void;
  openChat(id: string): void;
  deleteChat(id: string): void;
  /**
   * Switches to the conversations of a workspace (saved in the browser under `key`) and opens the latest.
   * `legacyKey`: where earlier versions kept them; they move to `key` the first time it has none.
   */
  bind(key: string, legacyKey?: string): void;
}

export interface ChatDeps {
  /** `onText` gets each piece of the answer as it arrives; the reply carries the whole text. */
  request(turns: ChatTurn[], context: string, signal: AbortSignal, onText: (piece: string) => void, sessionId?: string, selection?: ChatModelChoice, onSearch?: (activity: ChatSearchActivity) => void, onActivity?: (phase: 'applying') => void): Promise<ChatReply>;
  /** The text the assistant reads with each question; built fresh so it follows the diagram being edited. `options` only for an assistant's run. */
  getContext(options?: { scope: 'diagram' | 'workspace'; changes?: true }): string | Promise<string>;
  /** Where conversations are kept between visits; without it they live only as long as the page. */
  storage?: ChatStorage;
  now?(): number;
}

/** The server takes 40 messages: older ones drop off the front (a request always starts with the person's turn). */
const MAX_TURNS = 40;
/** What one conversation keeps (and saves). */
const MAX_KEPT = 100;

function recent(messages: ChatMessage[]): ChatTurn[] {
  let turns = messages.slice(-MAX_TURNS);
  while (turns.length && turns[0]!.role !== 'user') turns = turns.slice(1);
  return turns.map(({ role, content, changeSummary }) => {
    const receipt = role === 'assistant' && changeSummary ? `\n\n[Resultado confirmado pelo Joinlet: ${changeSummary}]` : '';
    return { role, content: content.slice(0, 8000 - receipt.length) + receipt };
  });
}

const summaries = (chats: Chat[]): ChatSummary[] =>
  [...chats].sort((a, b) => b.updatedAt - a.updatedAt).map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));

/** The conversations with the assistant: kept per workspace in the browser (never in `.arch/`, never sent anywhere else). */
export function createChatStore(deps: ChatDeps) {
  const now = deps.now ?? Date.now;
  let next = 1;
  let ticket = 0;
  let controller: AbortController | null = null;
  /** The id of the assistant message being written, while there is one. */
  let streaming: number | null = null;
  let key: string | null = null;
  let all: Chat[] = [];
  let drafts: Record<string, string> = {};
  let modelChoices: Record<string, ChatModelChoice> = {};
  let streamTimer: ReturnType<typeof setTimeout> | null = null;
  const readAux = (suffix: string): string | null => { try { return key && deps.storage ? deps.storage.get(`strukt:chat-${suffix}:${key}`) : null; } catch { return null; } };
  const writeAux = (suffix: string, text: string) => { try { if (key && deps.storage) deps.storage.set(`strukt:chat-${suffix}:${key}`, text); } catch { /* session still works */ } };

  return createStore<ChatState>()((set, get) => {
    const save = () => {
      if (key !== null && deps.storage) saveChats(deps.storage, key, all);
      set({ chats: summaries(all) });
    };

    /** Writes the open conversation into the list (a conversation without messages is not kept) and saves. */
    function persist(): void {
      const { activeId, messages } = get();
      if (activeId === null) return save();
      const kept = messages.slice(-MAX_KEPT).map(message => message.id === streaming ? { ...message, interrupted: true as const } : message);
      const previous = all.find(chat => chat.id === activeId);
      const rest = all.filter((chat) => chat.id !== activeId);
      const first = kept.find((message) => message.role === 'user');
      all = kept.length && first ? [...rest, { id: activeId, title: previous?.customTitle ?? first.assistant?.name ?? chatTitle(first.content), ...(previous?.customTitle ? { customTitle: previous.customTitle } : {}), updatedAt: now(), messages: kept }] : rest;
      writeAux('active', activeId);
      save();
    }

    /** Drops the answer in flight (its result will find a newer ticket and be discarded). */
    function cancel(): void {
      ticket++;
      set({ searchActivity: null });
      if (streamTimer) clearTimeout(streamTimer);
      streamTimer = null;
      controller?.abort();
      controller = null;
      streaming = null;
    }

    const show = (chat: Chat | null) => { writeAux('active', chat?.id ?? ''); set({ activeId: chat?.id ?? null, messages: chat?.messages ?? [], modelChoice: modelChoices[chat?.id ?? 'new'] ?? null, draft: typeof drafts[chat?.id ?? 'new'] === 'string' ? drafts[chat?.id ?? 'new']! : '', status: 'idle', error: null, offline: false }); };

    const markInterrupted = () => {
      const id = streaming;
      streaming = null;
      if (id !== null) set((s) => ({ messages: s.messages.map((message) => (message.id === id ? { ...message, interrupted: true as const } : message)) }));
    };

    async function ask(): Promise<void> {
      const mine = ++ticket;
      controller = new AbortController();
      streaming = null;
      set({ activity: 'thinking', status: 'loading', error: null, offline: false, searchActivity: null });
      const onText = (piece: string) => {
        if (mine !== ticket) return;
        set({ activity: 'writing' });
        if (streaming === null) {
          const id = next++;
          streaming = id;
          set((s) => ({ messages: [...s.messages, { id, role: 'assistant', content: piece }] }));
        } else {
          const id = streaming;
          set((s) => ({ messages: s.messages.map((message) => (message.id === id ? { ...message, content: message.content + piece } : message)) }));
        }
        if (streamTimer === null) streamTimer = setTimeout(() => { streamTimer = null; persist(); }, 400);
      };
      let reply: ChatReply;
      try {
        const { messages } = get();
        const run = messages[messages.length - 1]?.assistant;
        const built = deps.getContext(run ? { scope: run.scope, ...(run.changes ? { changes: true as const } : {}) } : undefined);
        // A plain string is used right away (the request starts in the same tick); only a promise is waited for.
        const context = typeof built === 'string' ? built : await built;
        if (mine !== ticket) return; // stopped or replaced while the context was being built
        reply = await deps.request(recent(messages), context, controller.signal, onText, get().activeId ?? undefined, get().modelChoice ?? undefined, activity => { if (mine === ticket) set({ searchActivity: activity }); }, activity => { if (mine === ticket) set({ activity }); });
      } catch (err) {
        reply = { kind: 'error', message: err instanceof Error ? err.message : String(err) };
      }
      if (mine !== ticket) return; // cancelled, or another conversation is open now
      if (streamTimer) clearTimeout(streamTimer);
      streamTimer = null;
      if (reply.kind === 'ok') {
        const id = streaming;
        streaming = null;
        if (id === null) set((s) => ({ messages: [...s.messages, { id: next++, role: 'assistant', content: reply.reply, ...(reply.change ? { changeSummary: reply.change.summary, undo: reply.change.undo } : {}) }] }));
        else set((s) => ({ messages: s.messages.map((message) => (message.id === id ? { ...message, content: reply.reply, ...(reply.change ? { changeSummary: reply.change.summary, undo: reply.change.undo } : {}) } : message)) }));
        set({ status: 'idle', searchActivity: null });
      } else {
        markInterrupted();
        set(reply.kind === 'offline' ? { status: 'idle', error: reply.reason, offline: true, searchActivity: null } : { status: 'idle', error: reply.message, searchActivity: null });
      }
      persist();
    }

    return {
      messages: [],
      chats: [],
      activeId: null,
      draft: '',
      modelChoice: null,
      setModelChoice(choice) {
        if (get().status === 'loading' || (choice !== null && !readChatModel(choice))) return;
        const slot = get().activeId ?? 'new';
        if (choice) modelChoices[slot] = choice; else delete modelChoices[slot];
        set({ modelChoice: choice });
        writeAux('models', JSON.stringify(modelChoices));
      },
      setDraft(text) {
        const slot = get().activeId ?? 'new';
        const draft = text.slice(0, 64000);
        if (draft) drafts[slot] = draft; else delete drafts[slot];
        set({ draft });
        writeAux('drafts', JSON.stringify(drafts));
      },
      renameChat(id, title) {
        const name = title.trim().slice(0, 80);
        if (!name) return;
        all = all.map(chat => chat.id === id ? { ...chat, title: name, customTitle: name } : chat);
        save();
      },
      activity: 'thinking',
      status: 'idle',
      searchActivity: null,
      error: null,
      offline: false,
      async send(text, assistant) {
        const content = text.trim();
        if (!content || get().status === 'loading') return;
        if (get().activeId === null) {
          const id = `c${now().toString(36)}${next}`;
          if (get().modelChoice) { modelChoices[id] = get().modelChoice!; writeAux('models', JSON.stringify(modelChoices)); }
          set({ activeId: id });
        }
        set((s) => ({ messages: [...s.messages, { id: next++, role: 'user', content, ...(assistant ? { assistant } : {}) }] }));
        persist();
        await ask();
      },
      undoChange(id) {
        const message = get().messages.find((m) => m.id === id);
        if (!message?.undo || get().status === 'loading') return;
        try {
          message.undo();
          set({ error: null });
          set((s) => ({ messages: s.messages.map((m) => m.id === id ? { ...m, undo: undefined, changeSummary: uiText("Alteração desfeita.") } : m) }));
          persist();
        } catch (err) { set({ error: err instanceof Error ? err.message : String(err) }); }
      },
      async retry() {
        if (get().status === 'loading') return;
        let { messages } = get();
        const last = messages[messages.length - 1];
        if (last?.interrupted) {
          messages = messages.slice(0, -1);
          set({ messages });
        }
        if (messages[messages.length - 1]?.role !== 'user') return;
        await ask();
      },
      stop() {
        if (get().status !== 'loading') return;
        markInterrupted();
        cancel();
        set({ status: 'idle', error: null });
        persist();
      },
      clear() {
        const { activeId } = get();
        cancel();
        if (activeId !== null) { all = all.filter((chat) => chat.id !== activeId); delete drafts[activeId]; delete modelChoices[activeId]; writeAux('models', JSON.stringify(modelChoices)); }
        writeAux('drafts', JSON.stringify(drafts));
        show(null);
        save();
      },
      newChat() {
        get().stop();
        cancel();
        show(null);
      },
      openChat(id) {
        if (id === get().activeId) return;
        get().stop();
        const chat = all.find((item) => item.id === id);
        if (!chat) return;
        cancel();
        show(chat);
      },
      deleteChat(id) {
        if (get().activeId === id) return get().clear();
        all = all.filter((chat) => chat.id !== id);
        delete modelChoices[id]; writeAux('models', JSON.stringify(modelChoices));
        delete drafts[id]; writeAux('drafts', JSON.stringify(drafts));
        save();
      },
      bind(workspaceKey, legacyKey) {
        if (workspaceKey === key) return;
        get().stop();
        cancel();
        key = workspaceKey;
        if (deps.storage && legacyKey) migrateChats(deps.storage, legacyKey, workspaceKey);
        all = deps.storage ? loadChats(deps.storage, workspaceKey) : [];
        try {
          const raw: unknown = JSON.parse(readAux('drafts') ?? '{}');
          drafts = raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.fromEntries(Object.entries(raw).filter(([id, value]) => (id === 'new' || all.some(chat => chat.id === id)) && typeof value === 'string').map(([id, value]) => [id, String(value).slice(0, 64000)])) : {};
        } catch { drafts = {}; }
        try {
          const raw = JSON.parse(readAux('models') ?? '{}');
          modelChoices = raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.fromEntries(Object.entries(raw).flatMap(([id, value]) => { const choice = readChatModel(value); return choice && (id === 'new' || all.some(chat => chat.id === id)) ? [[id, choice]] : []; })) : {};
        } catch { modelChoices = {}; }
        const lastActive = readAux('active');
        // Ids must stay unique inside a conversation: a loaded one may already hold ids above the counter.
        for (const chat of all) for (const message of chat.messages) if (message.id >= next) next = message.id + 1;
        set({ chats: summaries(all) });
        show(lastActive === null ? all[0] ?? null : all.find(chat => chat.id === lastActive) ?? null);
      },
    };
  });
}
