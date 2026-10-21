import { requestAuthHeaders } from '../workspace/requestAuth';
import { getLocale } from '../i18n';
import { systemMessage, uiText } from '../i18n';
import { readChatEdit } from '@strukt/core';
import type { ChatEdit, ChatTarget, ChatModelChoice, ChatSearchActivity } from '@strukt/core';
import type { DiagramOp } from '@strukt/core';

export type AiMode = 'edit' | 'generate';

export interface OpsRequest {
  instruction: string;
  json: string;
  selection: string[];
  mode: AiMode;
}

/** `offline`: no server, or a server without ANTHROPIC_API_KEY (503): the caller falls back to local rules. */
export type Reply<T> = ({ kind: 'ok' } & T) | { kind: 'offline'; reason: string } | { kind: 'error'; message: string };
export type OpsReply = Reply<{ ops: DiagramOp[]; summary: string; model: string }>;
export type DocReply = Reply<{ markdown: string }>;
export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

const UNREACHABLE = uiText("Servidor de IA fora do ar (rode \"bun run dev\").");
const defaultFetch: Fetch = (input, init) => globalThis.fetch(input, init);

type Posted = { kind: 'json'; status: number; data: Record<string, unknown> } | { kind: 'offline'; reason: string };

async function post(path: string, body: unknown, fetchFn: Fetch, signal?: AbortSignal): Promise<Posted> {
  let res: Response;
  try {
    res = await fetchFn(path, { method: 'POST', headers: { 'content-type': 'application/json', ...requestAuthHeaders() }, body: JSON.stringify({ ...(body as Record<string, unknown>), ...(Object.keys(requestAuthHeaders()).length ? {locale: getLocale()} : {}) }), signal });
  } catch {
    // An abort rejects the fetch too: the caller (aiStore/docSession) already knows it cancelled, and discards this.
    return { kind: 'offline', reason: UNREACHABLE };
  }
  const json = (res.headers.get('content-type') ?? '').includes('application/json');
  const data: unknown = json ? await res.json().catch(() => null) : null;
  // Our server always answers JSON; anything else is the dev proxy answering for a server that is not running.
  if (!data || typeof data !== 'object') return { kind: 'offline', reason: UNREACHABLE };
  const record = data as Record<string, unknown>;
  if (res.status === 503) return { kind: 'offline', reason: typeof record.error === 'string' ? systemMessage(record.error) : UNREACHABLE };
  return { kind: 'json', status: res.status, data: record };
}

function failure(status: number, data: Record<string, unknown>): { kind: 'error'; message: string } {
  return { kind: 'error', message: typeof data.error === 'string' ? systemMessage(data.error) : uiText("O servidor de IA respondeu {0}.", [status]) };
}

/** POST /api/ai/diagram (apps/server): instruction + current diagram JSON → validated ops. */
export async function requestOps(body: OpsRequest, fetchFn: Fetch = defaultFetch, signal?: AbortSignal): Promise<OpsReply> {
  const res = await post('/api/ai/diagram', body, fetchFn, signal);
  if (res.kind === 'offline') return res;
  if (res.status >= 400) return failure(res.status, res.data);
  const { ops, summary, model } = res.data;
  if (!Array.isArray(ops) || typeof summary !== 'string' || typeof model !== 'string') return { kind: 'error', message: uiText("Resposta inválida do servidor de IA.") };
  return { kind: 'ok', ops: ops as DiagramOp[], summary, model };
}

/** POST /api/ai/doc: current diagram JSON → architecture document in Markdown. */
export async function requestDoc(json: string, fetchFn: Fetch = defaultFetch, signal?: AbortSignal): Promise<DocReply> {
  const res = await post('/api/ai/doc', { json }, fetchFn, signal);
  if (res.kind === 'offline') return res;
  if (res.status >= 400) return failure(res.status, res.data);
  const { markdown } = res.data;
  if (typeof markdown !== 'string') return { kind: 'error', message: uiText("Resposta inválida do servidor de IA.") };
  return { kind: 'ok', markdown };
}

export interface ChatTurn { role: 'user' | 'assistant'; content: string }
export type ChatReply = Reply<{ reply: string; edit?: ChatEdit; change?: { summary: string; undo: () => void } }>;

/**
 * POST /api/ai/chat: the conversation so far + the project context → the assistant's answer, as it is written: the
 * server sends one JSON object per line (`{t}` pieces, then `{done}` or `{error}`), each piece goes to `onText`.
 * A failure before the first piece keeps the words of the other requests (offline / error).
 */
export async function requestChat(messages: ChatTurn[], context: string, fetchFn: Fetch = defaultFetch, signal?: AbortSignal, onText?: (piece: string) => void, target?: ChatTarget, sessionId?: string, selection?: ChatModelChoice, onSearch?: (activity: ChatSearchActivity) => void): Promise<ChatReply> {
  let res: Response;
  try {
    res = await fetchFn('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json', ...requestAuthHeaders(), ...(sessionId ? { 'x-strukt-session': sessionId } : {}) }, body: JSON.stringify({ messages, context, stream: true, ...(Object.keys(requestAuthHeaders()).length ? {locale: getLocale()} : {}), ...(target ? { target } : {}), ...(selection ? { selection } : {}) }), signal });
  } catch {
    return { kind: 'offline', reason: UNREACHABLE };
  }
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/x-ndjson')) {
    const data: unknown = type.includes('application/json') ? await res.json().catch(() => null) : null;
    if (!data || typeof data !== 'object') return { kind: 'offline', reason: UNREACHABLE };
    const record = data as Record<string, unknown>;
    if (res.status === 503) return { kind: 'offline', reason: typeof record.error === 'string' ? systemMessage(record.error) : UNREACHABLE };
    if (res.status >= 400) return failure(res.status, record);
    if (typeof record.reply !== 'string') return { kind: 'error', message: uiText("Resposta inválida do servidor de IA.") };
    const edit = record.edit === undefined ? undefined : readChatEdit(record.edit);
    if (record.edit !== undefined && !edit) return { kind: 'error', message: uiText("A IA devolveu uma alteração inválida.") };
    onText?.(record.reply);
    return { kind: 'ok', reply: record.reply, ...(edit ? { edit } : {}) };
  }
  if (!res.body) return { kind: 'error', message: uiText("Resposta inválida do servidor de IA.") };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let reply = '';
  let edit: ChatEdit | undefined;
  const handle = (line: string): ChatReply | null => {
    if (!line.trim()) return null;
    let event: { t?: unknown; done?: unknown; error?: unknown; edit?: unknown; search?: unknown };
    try { event = JSON.parse(line); } catch { return { kind: 'error', message: uiText("Resposta inválida do servidor de IA.") }; }
    if (event.search && typeof event.search === 'object') {
      const activity = event.search as ChatSearchActivity;
      if (typeof activity.query === 'string' && activity.query.length <= 400 && ['searching', 'complete', 'error'].includes(activity.status)) onSearch?.({ query: activity.query, status: activity.status, ...(typeof activity.count === 'number' && Number.isInteger(activity.count) && activity.count >= 0 && activity.count <= 6 ? { count: activity.count } : {}) });
    }
    if (typeof event.t === 'string') {
      reply += event.t;
      onText?.(event.t);
    }
    if (event.edit !== undefined) {
      const checked = readChatEdit(event.edit);
      if (!checked || edit) return { kind: 'error', message: uiText("A IA devolveu uma alteração inválida.") };
      edit = checked;
    }
    if (typeof event.error === 'string') return { kind: 'error', message: systemMessage(event.error) };
    return event.done === true ? { kind: 'ok', reply, ...(edit ? { edit } : {}) } : null;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const outcome = handle(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (outcome) {
          void reader.cancel().catch(() => {});
          return outcome;
        }
      }
    }
    const last = handle(buffer);
    if (last) return last;
  } catch {
    // An abort (the caller already knows it cancelled and discards this) or a connection that dropped mid-answer.
  }
  return { kind: 'error', message: uiText("A resposta foi interrompida.") };
}
