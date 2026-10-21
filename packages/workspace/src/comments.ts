/**
 * Comments on a diagram or a doc: threads anchored to a node, a connection, a point of the canvas or a passage of a
 * doc, stored in `.arch/comments/<kind>-<slug>.json` (spec 2026-10-03-comentarios-design.md). Pure code: the file
 * format, a tolerant parser, a strict validator, a convergent merge and the write rule the host applies to the
 * `comment` role.
 *
 * Everyone who writes the file (the owner's app, any guest, an agent) reads the latest text, applies its change on
 * top and writes it back, so two people's changes meet in `mergeComments`: threads and messages are matched by id,
 * the latest edit wins per message, a delete is a tombstone that never comes back and a thread's status follows its
 * latest change. The merge is commutative, associative and idempotent, so every replica ends in the same file.
 */
import type { CommentKind } from './commentsPath';


export const COMMENT_LIMITS = {
  /** Threads per file, tombstones included. */
  threads: 500,
  messagesPerThread: 200,
  messages: 3000,
  text: 4000,
  quote: 500,
  context: 40,
  name: 60,
  mentions: 20,
  ref: 120,
  bytes: 1_000_000,
} as const;

/**
 * Raw entries read from one file, before duplicates collapse: twice the stored limit leaves room for the copies a
 * git merge leaves behind, and bounds what a hostile file can make the parser (and the merge) chew on.
 */
const RAW_THREADS = COMMENT_LIMITS.threads * 2;
const RAW_MESSAGES = COMMENT_LIMITS.messages * 2;

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const OWNER = /^[A-Za-z0-9_:-]{1,60}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const COORD_MAX = 10_000_000;
/** A date (ms) a JS Date can hold. */
const STAMP_MAX = 8.64e15;

export type CommentAnchor =
  | { type: 'node'; id: string }
  | { type: 'edge'; id: string }
  /** A point of the canvas in flow coordinates (it follows pan and zoom). */
  | { type: 'point'; x: number; y: number }
  /** A passage of a doc: the quoted text with a little context and its offset when the comment was made. */
  | { type: 'text'; quote: string; prefix: string; suffix: string; from: number };

export interface CommentAuthor { name: string; color: string }

export interface CommentMessage {
  id: string;
  /** Who owns the message for the host's write rule: `i:<invite id>` for a guest, `c:<client id>` otherwise. */
  owner: string;
  author: CommentAuthor;
  text: string;
  /** Created at (ms). */
  at: number;
  /** The names @-mentioned (as the people's own names, see `findMentions`). */
  mentions?: string[];
  edited?: number;
  /** Tombstone: when it was deleted. The text is gone. */
  deleted?: number;
}

export interface CommentThread {
  id: string;
  anchor: CommentAnchor;
  /** Owner of the person who started it. */
  by: string;
  created: number;
  status: 'open' | 'resolved';
  /** When the status last changed (the latest change wins). */
  statusAt: number;
  statusBy?: CommentAuthor;
  messages: CommentMessage[];
  /** Tombstone: the thread was deleted (its messages are tombstones too). */
  deleted?: number;
}

export interface CommentsFile { version: 1; threads: CommentThread[] }

export const emptyComments = (): CommentsFile => ({ version: 1, threads: [] });

/** A failure the person can read (limits). */
export class CommentError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function stamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= STAMP_MAX ? Math.floor(value) : null;
}

/** A name or reference: a bounded string without control characters, never `__proto__`. */
function label(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= max && !CONTROL.test(text) && text !== '__proto__' ? text : null;
}

function readAuthor(value: unknown): CommentAuthor | null {
  if (!isRecord(value)) return null;
  const name = label(value.name, COMMENT_LIMITS.name);
  return name && typeof value.color === 'string' && COLOR.test(value.color) ? { name, color: value.color.toLowerCase() } : null;
}

function readAnchor(value: unknown, kind: CommentKind): CommentAnchor | null {
  if (!isRecord(value)) return null;
  if (kind === 'diagram') {
    if (value.type === 'node' || value.type === 'edge') {
      const id = label(value.id, COMMENT_LIMITS.ref);
      return id ? { type: value.type, id } : null;
    }
    if (value.type === 'point') {
      const { x, y } = value;
      return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= COORD_MAX && Math.abs(y) <= COORD_MAX ? { type: 'point', x, y } : null;
    }
    return null;
  }
  if (value.type !== 'text') return null;
  const { quote, prefix, suffix, from } = value;
  if (typeof quote !== 'string' || !quote || quote.length > COMMENT_LIMITS.quote) return null;
  if (typeof prefix !== 'string' || prefix.length > COMMENT_LIMITS.context || typeof suffix !== 'string' || suffix.length > COMMENT_LIMITS.context) return null;
  return typeof from === 'number' && Number.isInteger(from) && from >= 0 && from <= 100_000_000 ? { type: 'text', quote, prefix, suffix, from } : null;
}

const sameAnchor = (a: CommentAnchor, b: CommentAnchor) => JSON.stringify(canonicalAnchor(a)) === JSON.stringify(canonicalAnchor(b));

function canonicalAnchor(anchor: CommentAnchor): CommentAnchor {
  switch (anchor.type) {
    case 'node': case 'edge': return { type: anchor.type, id: anchor.id };
    case 'point': return { type: 'point', x: anchor.x, y: anchor.y };
    case 'text': return { type: 'text', quote: anchor.quote, prefix: anchor.prefix, suffix: anchor.suffix, from: anchor.from };
  }
}

function readMention(value: unknown): string | null {
  return label(value, COMMENT_LIMITS.name);
}

/** What the file keeps of a deleted message: who and when, never what. */
function tombstone(message: CommentMessage, deleted: number): CommentMessage {
  return { id: message.id, owner: message.owner, author: message.author, text: '', at: message.at, deleted };
}

function readMessage(value: unknown, problems: string[]): CommentMessage | null {
  if (!isRecord(value)) { problems.push('uma mensagem inválida'); return null; }
  const id = typeof value.id === 'string' && ID.test(value.id) && value.id !== '__proto__' ? value.id : null;
  const owner = typeof value.owner === 'string' && OWNER.test(value.owner) && value.owner !== '__proto__' ? value.owner : null;
  const author = readAuthor(value.author);
  const at = stamp(value.at);
  if (!id || !owner || !author || at === null) { problems.push('uma mensagem sem id, dono, autor ou data'); return null; }
  const base = { id, owner, author, at };
  if (value.deleted !== undefined) {
    const deleted = stamp(value.deleted);
    if (deleted === null) { problems.push('uma mensagem com data de exclusão inválida'); return null; }
    return tombstone(base as CommentMessage, deleted);
  }
  if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > COMMENT_LIMITS.text) {
    problems.push(typeof value.text === 'string' && value.text.length > COMMENT_LIMITS.text ? `um texto passa de ${COMMENT_LIMITS.text} caracteres` : 'uma mensagem sem texto');
    return null;
  }
  const message: CommentMessage = { ...base, text: value.text };
  if (value.mentions !== undefined) {
    const mentions = Array.isArray(value.mentions) ? [...new Set(value.mentions.map(readMention))] : null;
    if (!mentions || mentions.includes(null) || mentions.length > COMMENT_LIMITS.mentions) problems.push('menções inválidas');
    else if (mentions.length) message.mentions = mentions as string[];
  }
  if (value.edited !== undefined) {
    const edited = stamp(value.edited);
    if (edited === null) problems.push('uma data de edição inválida');
    else message.edited = edited;
  }
  return message;
}

function readThread(value: unknown, kind: CommentKind, problems: string[], budget: { messages: number }, strict: boolean): CommentThread | null {
  if (!isRecord(value)) { problems.push('uma conversa inválida'); return null; }
  const id = typeof value.id === 'string' && ID.test(value.id) && value.id !== '__proto__' ? value.id : null;
  const anchor = readAnchor(value.anchor, kind);
  const by = typeof value.by === 'string' && OWNER.test(value.by) && value.by !== '__proto__' ? value.by : null;
  const created = stamp(value.created);
  if (!id || !anchor || !by || created === null || !Array.isArray(value.messages)) { problems.push('uma conversa sem id, âncora, autor ou data'); return null; }
  const status = value.status === 'resolved' ? 'resolved' : value.status === 'open' || value.status === undefined ? 'open' : null;
  if (!status) { problems.push('uma conversa com estado desconhecido'); return null; }
  const statusAt = value.statusAt === undefined ? created : stamp(value.statusAt);
  if (statusAt === null) { problems.push('uma conversa com data de estado inválida'); return null; }
  const messages = new Map<string, CommentMessage>();
  for (const raw of value.messages) {
    if (budget.messages <= 0) { problems.push(`mais de ${RAW_MESSAGES} mensagens no arquivo; o excedente`); break; }
    budget.messages -= 1;
    const message = readMessage(raw, problems);
    if (!message) continue;
    const known = messages.get(message.id);
    if (known && strict) { problems.push('um id de mensagem repetido'); continue; }
    messages.set(message.id, known ? pickMessage(known, message) : message);
  }
  let deleted: number | undefined;
  if (value.deleted !== undefined) {
    const at = stamp(value.deleted);
    if (at === null) { problems.push('uma conversa com data de exclusão inválida'); return null; }
    deleted = at;
  }
  if (!messages.size) { problems.push('uma conversa sem mensagens'); return null; }
  const thread: CommentThread = { id, anchor, by, created, status, statusAt, messages: [...messages.values()] };
  const statusBy = value.statusBy === undefined ? undefined : readAuthor(value.statusBy);
  if (statusBy) thread.statusBy = statusBy;
  else if (value.statusBy !== undefined) problems.push('um autor de estado inválido');
  if (deleted !== undefined) thread.deleted = deleted;
  return settle(thread);
}

/** The thread in its canonical shape: a deleted thread's messages are tombstones; messages in order. */
function settle(thread: CommentThread): CommentThread {
  const messages = thread.messages
    .map((message) => (thread.deleted !== undefined && (message.deleted === undefined || message.deleted > thread.deleted) ? tombstone(message, thread.deleted) : message))
    .sort(byAt);
  return { ...thread, messages };
}

const byAt = (a: { at: number; id: string }, b: { at: number; id: string }) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byCreated = (a: CommentThread, b: CommentThread) => a.created - b.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export interface ParsedComments {
  file: CommentsFile;
  /** What was dropped or cut (pt-BR). Empty for a clean file. */
  warnings: string[];
  /** The text is not a comments file we can read (invalid JSON, a newer version): a writer must not replace it. */
  broken: boolean;
}

/**
 * Reads a comments file for `kind`. Tolerant: what cannot be read (a thread, a message, a field out of range) is
 * dropped with a warning and the rest is kept; a file that is not JSON, or is from a newer version, reads as empty and
 * `broken`. Over the limits, the excess is dropped. Threads and messages come out in canonical order.
 */
export function parseComments(text: string | null, kind: CommentKind): ParsedComments {
  return readComments(text, kind, false);
}

/** `strict` (what a writer is held to) refuses a repeated thread or message id instead of merging the copies. */
function readComments(text: string | null, kind: CommentKind, strict: boolean): ParsedComments {
  if (text === null || !text.trim()) return { file: emptyComments(), warnings: [], broken: false };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { file: emptyComments(), warnings: ['O arquivo de comentários não é um JSON válido (marcas de conflito?).'], broken: true }; }
  if (!isRecord(raw) || !Array.isArray(raw.threads)) return { file: emptyComments(), warnings: ['O arquivo de comentários não tem o formato esperado.'], broken: true };
  if (typeof raw.version === 'number' && raw.version > 1) return { file: emptyComments(), warnings: [`O arquivo de comentários é de uma versão mais nova do Joinlet (v${raw.version}).`], broken: true };
  const problems: string[] = [];
  const copies = new Map<string, CommentThread[]>();
  const budget = { messages: RAW_MESSAGES };
  for (const value of raw.threads.slice(0, RAW_THREADS)) {
    const thread = readThread(value, kind, problems, budget, strict);
    if (!thread) continue;
    const known = copies.get(thread.id);
    if (known && strict) { problems.push('um id de conversa repetido'); continue; }
    if (known) known.push(thread);
    else copies.set(thread.id, [thread]);
  }
  if (raw.threads.length > RAW_THREADS) problems.push(`mais de ${RAW_THREADS} conversas no arquivo; o excedente`);
  const threads = new Map([...copies].map(([id, group]) => [id, group.length === 1 ? group[0]! : mergeThreads(group)]));
  const file: CommentsFile = { version: 1, threads: [...threads.values()].sort(byCreated) };
  const cut = fit(file);
  if (cut) problems.push(cut);
  // One line per kind of problem, not one per occurrence: a damaged file would flood the screen.
  const warnings = [...new Set(problems.map((problem) => `Comentários: ${problem} foi ignorado.`))];
  return { file: cut ? truncated(file) : file, warnings, broken: false };
}

/** A pt-BR reason when `file` is past a limit, else null. */
function fit(file: CommentsFile): string | null {
  if (file.threads.length > COMMENT_LIMITS.threads) return `passou de ${COMMENT_LIMITS.threads} conversas; o excedente`;
  let total = 0;
  for (const thread of file.threads) {
    if (thread.messages.length > COMMENT_LIMITS.messagesPerThread) return `uma conversa passou de ${COMMENT_LIMITS.messagesPerThread} mensagens; o excedente`;
    total += thread.messages.length;
  }
  return total > COMMENT_LIMITS.messages ? `passou de ${COMMENT_LIMITS.messages} mensagens; o excedente` : null;
}

function truncated(file: CommentsFile): CommentsFile {
  let budget = COMMENT_LIMITS.messages;
  const threads: CommentThread[] = [];
  for (const thread of file.threads.slice(0, COMMENT_LIMITS.threads)) {
    const messages = thread.messages.slice(0, Math.min(COMMENT_LIMITS.messagesPerThread, budget));
    if (!messages.length) break;
    budget -= messages.length;
    threads.push({ ...thread, messages });
  }
  return { version: 1, threads };
}

/** The reason `text` is not an acceptable comments file for `kind` (anything the tolerant parser would drop), else null. */
export function validateComments(text: string, kind: CommentKind): string | null {
  if (new TextEncoder().encode(text).length > COMMENT_LIMITS.bytes) return 'O arquivo de comentários passou do tamanho máximo.';
  const parsed = readComments(text, kind, true);
  return parsed.broken || parsed.warnings.length ? parsed.warnings[0]! : null;
}

function messageJson(message: CommentMessage): Record<string, unknown> {
  const { id, owner, author, text, at, mentions, edited, deleted } = message;
  return {
    id, owner, author: { name: author.name, color: author.color }, text, at,
    ...(mentions?.length ? { mentions } : {}), ...(edited !== undefined ? { edited } : {}), ...(deleted !== undefined ? { deleted } : {}),
  };
}

function threadJson(thread: CommentThread): Record<string, unknown> {
  return {
    id: thread.id, anchor: canonicalAnchor(thread.anchor), by: thread.by, created: thread.created, status: thread.status, statusAt: thread.statusAt,
    ...(thread.statusBy ? { statusBy: { name: thread.statusBy.name, color: thread.statusBy.color } } : {}),
    ...(thread.deleted !== undefined ? { deleted: thread.deleted } : {}),
    messages: thread.messages.map(messageJson),
  };
}

/** Canonical text: fixed key order, threads and messages in creation order, 2-space indent, final newline. */
export function printComments(file: CommentsFile): string {
  const threads = [...file.threads].sort(byCreated).map((thread) => threadJson(settle(thread)));
  return `${JSON.stringify({ version: 1, threads }, null, 2)}\n`;
}

// --- merge -----------------------------------------------------------------------------------------------------------

/** Orders two values the same way on every replica (a tie of timestamps must not depend on which side is which). */
const same = (a: unknown, b: unknown) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0);

function pickMessage(a: CommentMessage, b: CommentMessage): CommentMessage {
  if (a.deleted !== undefined || b.deleted !== undefined) {
    const deleted = Math.min(a.deleted ?? Infinity, b.deleted ?? Infinity);
    const base = [a, b].sort((x, y) => same(messageJson(tombstone(x, 0)), messageJson(tombstone(y, 0))))[0]!;
    return tombstone(base, deleted);
  }
  const versionA = a.edited ?? a.at;
  const versionB = b.edited ?? b.at;
  if (versionA !== versionB) return versionA > versionB ? a : b;
  return same(messageJson(a), messageJson(b)) >= 0 ? a : b;
}

const mergeThread = (a: CommentThread, b: CommentThread): CommentThread => mergeThreads([a, b]);

/**
 * Every copy of one thread merged in a single pass (the same result as folding them two at a time, without
 * re-sorting the growing message list at every step).
 */
function mergeThreads(copies: readonly CommentThread[]): CommentThread {
  const key = (thread: CommentThread) => JSON.stringify([thread.created, thread.by, canonicalAnchor(thread.anchor)]);
  const statusKey = (thread: CommentThread) => JSON.stringify([thread.status, thread.statusBy]);
  let base = copies[0]!;
  let latest = copies[0]!;
  let deleted: number | undefined;
  const messages = new Map<string, CommentMessage>();
  for (const copy of copies) {
    if (key(copy) < key(base)) base = copy;
    if (copy.statusAt !== latest.statusAt ? copy.statusAt > latest.statusAt : statusKey(copy) > statusKey(latest)) latest = copy;
    if (copy.deleted !== undefined) deleted = deleted === undefined ? copy.deleted : Math.min(deleted, copy.deleted);
    for (const message of copy.messages) {
      const known = messages.get(message.id);
      messages.set(message.id, known ? pickMessage(known, message) : message);
    }
  }
  const merged: CommentThread = { id: copies[0]!.id, anchor: base.anchor, by: base.by, created: base.created, status: latest.status, statusAt: latest.statusAt, messages: [...messages.values()] };
  if (latest.statusBy) merged.statusBy = latest.statusBy;
  if (deleted !== undefined) merged.deleted = deleted;
  return settle(merged);
}

/** The union of two copies of a file (see the module comment): the same result whichever is `a`. Never throws. */
export function mergeComments(a: CommentsFile, b: CommentsFile): CommentsFile {
  const copies = new Map<string, CommentThread[]>();
  for (const thread of [...a.threads, ...b.threads]) {
    const known = copies.get(thread.id);
    if (known) known.push(thread);
    else copies.set(thread.id, [thread]);
  }
  const threads = [...copies.values()].map((group) => (group.length === 1 ? settle(group[0]!) : mergeThreads(group)));
  return { version: 1, threads: threads.sort(byCreated) };
}

// --- changes ---------------------------------------------------------------------------------------------------------

/** A change to a file, replayable on any copy of it: applying one twice, or on a newer copy, is safe. */
export type CommentOp =
  | { op: 'thread'; thread: CommentThread }
  | { op: 'reply'; thread: string; message: CommentMessage }
  | { op: 'edit'; thread: string; message: string; text: string; mentions: string[]; at: number }
  | { op: 'remove'; thread: string; message: string; at: number }
  | { op: 'status'; thread: string; status: 'open' | 'resolved'; by: CommentAuthor; at: number }
  | { op: 'delete'; thread: string; at: number };

function checkText(text: string): void {
  if (!text.trim()) throw new CommentError('Escreva o comentário antes de enviar.');
  if (text.length > COMMENT_LIMITS.text) throw new CommentError(`O comentário passa de ${COMMENT_LIMITS.text} caracteres.`);
}

/** Applies one change; throws a `CommentError` (pt-BR) when it would pass a limit. A thread that is gone is ignored. */
export function applyCommentOp(file: CommentsFile, op: CommentOp): CommentsFile {
  const replace = (id: string, change: (thread: CommentThread) => CommentThread): CommentsFile => {
    let found = false;
    const threads = file.threads.map((thread) => {
      if (thread.id !== id) return thread;
      found = true;
      return settle(change(thread));
    });
    return found ? { version: 1, threads } : file;
  };
  const alive = (thread: CommentThread) => thread.deleted === undefined;
  let next: CommentsFile;
  switch (op.op) {
    case 'thread': {
      for (const message of op.thread.messages) if (message.deleted === undefined) checkText(message.text);
      next = mergeComments(pruneComments(file, op.thread.created), { version: 1, threads: [op.thread] });
      break;
    }
    case 'reply': {
      checkText(op.message.text);
      next = replace(op.thread, (thread) => (alive(thread) ? { ...thread, messages: [...thread.messages.filter((m) => m.id !== op.message.id), op.message] } : thread));
      break;
    }
    case 'edit': {
      checkText(op.text);
      next = replace(op.thread, (thread) => ({
        ...thread,
        messages: thread.messages.map((message) => {
          if (message.id !== op.message || message.deleted !== undefined) return message;
          const { mentions: _old, ...rest } = message;
          return { ...rest, text: op.text, ...(op.mentions.length ? { mentions: op.mentions } : {}), edited: Math.max(op.at, message.at) };
        }),
      }));
      break;
    }
    case 'remove': {
      next = replace(op.thread, (thread) => {
        const messages = thread.messages.map((message) => (message.id === op.message && message.deleted === undefined ? tombstone(message, op.at) : message));
        // A thread with nothing left to read goes with its last message.
        return messages.every((message) => message.deleted !== undefined) && thread.deleted === undefined ? { ...thread, messages, deleted: op.at } : { ...thread, messages };
      });
      break;
    }
    case 'status': {
      next = replace(op.thread, (thread) => (thread.statusAt > op.at || !alive(thread) ? thread : { ...thread, status: op.status, statusAt: op.at, statusBy: op.by }));
      break;
    }
    case 'delete': {
      next = replace(op.thread, (thread) => (alive(thread) ? { ...thread, deleted: op.at } : thread));
      break;
    }
  }
  const over = fit(next);
  if (over) throw new CommentError(`Este item ${over.replace(/; o excedente$/, '')}. Resolva ou exclua conversas antes de abrir outras.`);
  return next;
}

/** How long a deleted conversation is remembered (so a stale copy does not bring it back) before it is dropped. */
export const TOMBSTONE_MS = 30 * 86_400_000;

/** Drops conversations deleted more than `TOMBSTONE_MS` before `now`: they hold no text, only their ids. */
export function pruneComments(file: CommentsFile, now: number): CommentsFile {
  const threads = file.threads.filter((thread) => thread.deleted === undefined || now - thread.deleted < TOMBSTONE_MS);
  return threads.length === file.threads.length ? file : { version: 1, threads };
}

/** `thread` ops build a thread from its first message. */
export function newThread(input: { id: string; anchor: CommentAnchor; message: CommentMessage }): CommentThread {
  const { id, anchor, message } = input;
  return { id, anchor, by: message.owner, created: message.at, status: 'open', statusAt: message.at, messages: [message] };
}

// --- reading ---------------------------------------------------------------------------------------------------------

export const liveThreads = (file: CommentsFile): CommentThread[] => file.threads.filter((thread) => thread.deleted === undefined);
export const liveMessages = (thread: CommentThread): CommentMessage[] => thread.messages.filter((message) => message.deleted === undefined);

// --- the host's rule for the `comment` role --------------------------------------------------------------------------

/**
 * What the host stores for a guest's write: the canonical text of what the guest sent (nothing it did not mean to
 * keep, so padding and unknown fields cannot bloat the file) with the identity of what the guest itself added or
 * changed pinned to its invite: the author of its new or edited messages and the `statusBy` of a status it changed.
 * Everything already in the file keeps the name it had. `owner` is the invite's id (`i:<id>`), `name` the invite's name.
 */
export function pinCommentIdentity(beforeText: string | null, afterText: string, kind: CommentKind, owner: string, name: string): string {
  const before = new Map(parseComments(beforeText, kind).file.threads.map((thread) => [thread.id, thread]));
  const after = parseComments(afterText, kind).file;
  const threads = after.threads.map((thread) => {
    const old = before.get(thread.id);
    const known = new Map((old?.messages ?? []).map((message) => [message.id, canonical(message)]));
    const messages = thread.messages.map((message) => (message.owner === owner && known.get(message.id) !== canonical(message) ? { ...message, author: { name, color: message.author.color } } : message));
    const statusChanged = !old || old.statusAt !== thread.statusAt || old.status !== thread.status;
    const pinned: CommentThread = { ...thread, messages };
    if (statusChanged && thread.statusBy) pinned.statusBy = { name, color: thread.statusBy.color };
    return pinned;
  });
  return printComments({ version: 1, threads });
}

const canonical = (message: CommentMessage) => JSON.stringify(messageJson(message));
/** Clocks differ: dates up to this far ahead of the host's are believed (a date far ahead would win every later change). */
const SKEW_MS = 10 * 60_000;
const ahead = (message: CommentMessage, now: number) => Math.max(message.at, message.edited ?? 0, message.deleted ?? 0) > now + SKEW_MS;

/**
 * What a `comment` invite may do to a comments file (`member` is its invite's owner id): add conversations and
 * messages as itself, edit and delete its own messages and its own conversations, resolve or reopen any conversation.
 * Everything else must stay byte-for-byte what it is: other people's messages and conversations, anchors, authors,
 * dates. Returns a pt-BR reason when `afterText` breaks that, else null. The host also refuses a file that is not
 * valid (limits, shapes) and one over a file that is broken today (it would destroy what is there).
 */
export function checkCommentWrite(beforeText: string | null, afterText: string, kind: CommentKind, member: string, now = Date.now()): string | null {
  const invalid = validateComments(afterText, kind);
  if (invalid) return invalid;
  const before = parseComments(beforeText, kind);
  if (before.broken) return 'O arquivo de comentários está com erros. Peça a quem edita para corrigi-lo.';
  const after = parseComments(afterText, kind).file;
  const known = new Map(after.threads.map((thread) => [thread.id, thread]));
  const refuse = 'Este convite só pode acrescentar e editar os próprios comentários.';
  for (const old of before.file.threads) {
    const thread = known.get(old.id);
    // A deleted conversation holds no text: dropping it (the cleanup after `TOMBSTONE_MS`) is anyone's.
    if (!thread) { if (old.deleted !== undefined) continue; return refuse; }
    if (thread.by !== old.by || thread.created !== old.created || !sameAnchor(thread.anchor, old.anchor)) return refuse;
    // Only who started a conversation may delete it (and then everything in it goes).
    const closed = thread.deleted !== undefined && old.deleted === undefined;
    if (thread.deleted !== old.deleted && !(closed && old.by === member)) return refuse;
    const messages = new Map(thread.messages.map((message) => [message.id, message]));
    for (const previous of old.messages) {
      const message = messages.get(previous.id);
      if (!message) return refuse;
      if (canonical(message) === canonical(previous)) continue;
      if (closed && message.deleted !== undefined && canonical(message) === canonical(tombstone(previous, thread.deleted!))) continue;
      if (previous.owner !== member || message.owner !== previous.owner || message.id !== previous.id || message.at !== previous.at || canonical({ ...message, text: '', mentions: undefined, edited: undefined, deleted: undefined }) !== canonical({ ...previous, text: '', mentions: undefined, edited: undefined, deleted: undefined })) return refuse;
      if (previous.deleted !== undefined && message.deleted === undefined) return refuse;
      if (ahead(message, now)) return refuse;
    }
    const had = new Set(old.messages.map((message) => message.id));
    for (const message of thread.messages) if (!had.has(message.id) && (message.owner !== member || ahead(message, now))) return refuse;
    if ((thread.statusAt !== old.statusAt || thread.deleted !== old.deleted) && (thread.statusAt > now + SKEW_MS || (thread.deleted ?? 0) > now + SKEW_MS)) return refuse;
  }
  const existed = new Set(before.file.threads.map((thread) => thread.id));
  for (const thread of after.threads) {
    if (existed.has(thread.id)) continue;
    if (thread.by !== member || thread.messages.some((message) => message.owner !== member || ahead(message, now)) || thread.created > now + SKEW_MS || thread.statusAt > now + SKEW_MS) return refuse;
  }
  return null;
}
