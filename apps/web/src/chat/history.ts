import { uiText } from '../i18n';
/** Who ran a question: a saved or built-in assistant, with what it reads (kept so "Tentar de novo" asks the same way). */
export interface AssistantRun {
  name: string;
  scope: 'diagram' | 'workspace';
  /** Also sends what changed in the diagram since its last saved version. */
  changes?: true;
}

export interface StoredMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  /** Set on the question an assistant sent. */
  assistant?: AssistantRun;
  /** An answer cut short by an error: kept (it is on screen), but "Tentar de novo" asks again in its place. */
  interrupted?: true;
  changeSummary?: string;
  /** Session-only callback: JSON persistence deliberately drops it. */
  undo?: () => void;
}

export interface Chat {
  id: string;
  title: string;
  customTitle?: string;
  updatedAt: number;
  messages: StoredMessage[];
}

export interface ChatStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export const MAX_CHATS = 20;
/** What one workspace's conversations may take of the browser's storage (it holds a few MB for the whole origin). */
const MAX_CHARS = 150_000;
const keyOf = (workspaceKey: string) => `strukt:chats:${workspaceKey}`;

export function chatTitle(firstQuestion: string): string {
  const line = firstQuestion.trim().split("\n")[0]!.trim();
  if (!line) return uiText("Nova conversa");
  return line.length > 48 ? `${line.slice(0, 47)}…` : line;
}

function readRun(raw: unknown): AssistantRun | null {
  const run = raw as { name?: unknown; scope?: unknown; changes?: unknown } | null;
  if (!run || typeof run !== 'object' || typeof run.name !== 'string' || !run.name.trim() || (run.scope !== 'diagram' && run.scope !== 'workspace')) return null;
  return { name: run.name.trim().slice(0, 60), scope: run.scope, ...(run.changes === true ? { changes: true as const } : {}) };
}

function readMessage(raw: unknown): StoredMessage | null {
  const item = raw as { id?: unknown; role?: unknown; content?: unknown; interrupted?: unknown; assistant?: unknown; changeSummary?: unknown } | null;
  if (!item || typeof item.id !== 'number' || (item.role !== 'user' && item.role !== 'assistant') || typeof item.content !== 'string') return null;
  const assistant = item.role === 'user' ? readRun(item.assistant) : null;
  return { id: item.id, role: item.role, content: item.content, ...(assistant ? { assistant } : {}), ...(typeof item.changeSummary === 'string' ? { changeSummary: item.changeSummary.slice(0, 2000) } : {}), ...(item.interrupted === true ? { interrupted: true as const } : {}) };
}

/** Older versions could save two messages with one id (a reload restarted the counter): later repeats get fresh ids. */
function uniqueIds(messages: StoredMessage[]): StoredMessage[] {
  const seen = new Set<number>();
  let top = messages.reduce((max, message) => Math.max(max, message.id), 0);
  return messages.map((message) => {
    if (!seen.has(message.id)) { seen.add(message.id); return message; }
    seen.add(++top);
    return { ...message, id: top };
  });
}

/** The conversations saved for a workspace, newest first; whatever does not look like one is dropped, never thrown. */
export function loadChats(storage: ChatStorage, workspaceKey: string): Chat[] {
  let parsed: unknown;
  try {
    const text = storage.get(keyOf(workspaceKey));
    if (!text) return [];
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const chats: Chat[] = [];
  for (const raw of parsed as unknown[]) {
    const item = raw as { id?: unknown; title?: unknown; customTitle?: unknown; updatedAt?: unknown; messages?: unknown } | null;
    if (!item || typeof item.id !== 'string' || item.id === '__proto__' || typeof item.title !== 'string' || typeof item.updatedAt !== 'number' || !Array.isArray(item.messages)) continue;
    chats.push({ id: item.id, title: item.title.slice(0, 80), ...(typeof item.customTitle === 'string' && item.customTitle.trim() ? { customTitle: item.customTitle.trim().slice(0, 80) } : {}), updatedAt: item.updatedAt, messages: uniqueIds((item.messages as unknown[]).flatMap((message) => readMessage(message) ?? [])) });
  }
  return chats.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHATS);
}

/** Saves the newest conversations that fit; a full or blocked storage loses the save, not the app. */
export function saveChats(storage: ChatStorage, workspaceKey: string, chats: Chat[]): void {
  let kept = [...chats].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHATS);
  let text = JSON.stringify(kept);
  while (text.length > MAX_CHARS && kept.length > 1) {
    kept = kept.slice(0, -1);
    text = JSON.stringify(kept);
  }
  try { storage.set(keyOf(workspaceKey), text); } catch { /* private window, quota: the conversation just is not kept */ }
}

/**
 * Copies the conversations kept under `from` to `to`, unless `to` already has a save of its own. `from` stays
 * as it was (another workspace with the same name and place may still read it): nothing is ever lost.
 */
export function migrateChats(storage: ChatStorage, from: string, to: string): void {
  if (from === to) return;
  try {
    if (storage.get(keyOf(to)) !== null) return;
    const text = storage.get(keyOf(from));
    if (text) storage.set(keyOf(to), text);
  } catch { /* nothing to move, or storage blocked: the id's list just starts empty */ }
}
