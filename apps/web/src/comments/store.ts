import { uiText } from '../i18n';
import { CommentError, applyCommentOp, commitComments, emptyComments, findMentions, liveMessages, liveThreads, listCommentFiles, mentionsFor, newThread, parseComments, parseCommentsPath } from '@strukt/workspace';
import type { CommentAnchor, CommentKind, CommentMessage, CommentOp, CommentThread, CommentsFile, StorageAdapter } from '@strukt/workspace';
import { createStore } from 'zustand/vanilla';
import type { Who } from './identity';

export interface CommentTarget { kind: CommentKind; slug: string }
export const targetKey = (target: CommentTarget): string => `${target.kind}:${target.slug}`;

export interface ItemSummary { open: number; mentions: number; fresh: number }

/** A place picked for a new conversation, waiting for its first message. */
export interface Draft { anchor: CommentAnchor }

export interface CommentsState {
  target: CommentTarget | null;
  /** What the screen shows: the file on disk with the changes still being written put on top. */
  file: CommentsFile;
  loaded: boolean;
  /** The file cannot be read (conflict markers, a newer format): nothing is written until someone fixes it. */
  broken: string | null;
  warnings: string[];
  /** The last failure, in words (a refused write, a limit). */
  error: string | null;
  /** The conversation open on the canvas or in the doc. */
  active: string | null;
  draft: Draft | null;
  filter: 'open' | 'resolved';
  /** The comment tool: a click on the canvas picks the place of a new conversation. */
  tool: boolean;
  /** The other items' comments (mentions of you, open ones), refreshed now and then. */
  summary: Record<string, ItemSummary>;
  /** When this person last looked at the open item's comments. */
  seenAt: number;
}

export interface CommentsDeps {
  adapter(): StorageAdapter | null;
  who(): Who;
  now(): number;
  newId(): string;
  /** Runs `fn` every `ms` until the returned function is called. */
  every(ms: number, fn: () => void): () => void;
  visible?(): boolean;
  /** Says something short to the person (a toast). */
  notify(message: string): void;
  seen: { get(key: string): number; set(key: string, at: number): void };
  /** The names to look for in a comment's text, to record its mentions. */
  names?(): readonly string[];
  pollMs?: number;
  scanMs?: number;
}

export const POLL_MS = 3000;
export const SCAN_MS = 15_000;
const SCAN_FILES = 40;

const initial = (): CommentsState => ({ target: null, file: emptyComments(), loaded: false, broken: null, warnings: [], error: null, active: null, draft: null, filter: 'open', tool: false, summary: {}, seenAt: 0 });

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
const tryApply = (file: CommentsFile, op: CommentOp): CommentsFile => { try { return applyCommentOp(file, op); } catch { return file; } };

/**
 * The comments of the open diagram or doc. Writes go to `.arch/comments/<kind>-<slug>.json` through the workspace's
 * adapter (the owner's folder, or the host's REST surface for a guest): each change is shown at once, written on top
 * of the file as it is on disk (`commitComments`) and shared by polling the file every `POLL_MS`.
 */
export function createCommentsStore(deps: CommentsDeps) {
  const store = createStore<CommentsState>()(() => initial());
  const set = (patch: Partial<CommentsState>) => store.setState(patch);
  const get = store.getState;

  /** What is on disk (as last read or written) and the changes still going out. */
  let base: CommentsFile = emptyComments();
  let lastText: string | null = null;
  let pending: CommentOp[] = [];
  let epoch = 0;
  let stops: Array<() => void> = [];
  let jobs: Array<{ ops: CommentOp[]; done(ok: boolean): void; epoch: number }> = [];
  let draining = false;
  let polling = false;

  const view = () => pending.reduce(tryApply, base);
  const show = () => {
    const next = view();
    // A poll that finds nothing new must not hand the screen a new object.
    if (JSON.stringify(next) !== JSON.stringify(get().file)) set({ file: next });
  };

  const adopt = (text: string | null, kind: CommentKind) => {
    lastText = text;
    const parsed = parseComments(text, kind);
    base = parsed.file;
    set({ broken: parsed.broken ? parsed.warnings[0]! : null, warnings: parsed.broken ? [] : parsed.warnings, loaded: true });
    show();
  };

  async function poll(): Promise<void> {
    const { target } = get();
    const adapter = deps.adapter();
    if (!target || !adapter || polling || draining || jobs.length || deps.visible?.() === false) return;
    const mine = epoch;
    polling = true;
    try {
      const text = await adapter.read(`comments/${target.kind}-${target.slug}.json`);
      if (mine !== epoch || draining || jobs.length) return;
      if (!get().loaded || text !== lastText) adopt(text, target.kind);
    } catch (error) {
      if (mine === epoch && !get().loaded) set({ loaded: true, error: reason(error) });
    } finally { polling = false; }
  }

  /** The summary of the other items: one read per comments file, a few at a time. */
  async function scan(): Promise<void> {
    const adapter = deps.adapter();
    if (!adapter || deps.visible?.() === false) return;
    const mine = epoch;
    try {
      const files = listCommentFiles(await adapter.list()).slice(0, SCAN_FILES);
      const who = deps.who();
      const summary: Record<string, ItemSummary> = {};
      for (const entry of files) {
        const parsed = parseComments(await adapter.read(entry.path), entry.kind);
        const key = targetKey(entry);
        const mentions = mentionsFor(parsed.file, who.name, who.owner, deps.seen.get(key));
        summary[key] = { open: liveThreads(parsed.file).filter((thread) => thread.status === 'open').length, mentions: mentions.threads.length, fresh: mentions.fresh };
      }
      if (mine === epoch && JSON.stringify(summary) !== JSON.stringify(get().summary)) set({ summary });
    } catch { /* the next scan tries again */ }
  }

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (jobs.length) {
        const job = jobs.shift()!;
        const { target } = get();
        const adapter = deps.adapter();
        if (job.epoch !== epoch || !target || !adapter) { pending = pending.filter((op) => !job.ops.includes(op)); job.done(false); continue; }
        let ok = false;
        try {
          const result = await commitComments(adapter, target.kind, target.slug, job.ops, { wait: (attempt) => new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.random() * 60)) });
          if (job.epoch === epoch) {
            lastText = result.text;
            base = result.file;
            ok = result.refused.length === 0;
            set({ error: ok ? null : result.refused[0]!.message, broken: null });
            if (!ok) deps.notify(result.refused[0]!.message);
          }
        } catch (error) {
          if (job.epoch === epoch) {
            const message = error instanceof CommentError ? error.message : uiText("Não foi possível salvar o comentário: {0}", [reason(error)]);
            set({ error: message });
            deps.notify(message);
          }
        }
        pending = pending.filter((op) => !job.ops.includes(op));
        if (job.epoch === epoch) show();
        job.done(ok);
      }
    } finally { draining = false; }
  }

  /** Applies the changes on screen now and writes them; resolves true when they are in the file. */
  function submit(ops: CommentOp[]): Promise<boolean> {
    const { target, broken } = get();
    const who = deps.who();
    if (!target || !deps.adapter()) return Promise.resolve(false);
    if (!who.canWrite) {
      deps.notify(uiText("Este link só permite ver os comentários."));
      return Promise.resolve(false);
    }
    if (broken) {
      deps.notify(uiText("{0} Corrija ou apague o arquivo em .arch/comments/ antes de comentar.", [broken]));
      return Promise.resolve(false);
    }
    try { ops.reduce(applyCommentOp, view()); }
    catch (error) {
      const message = error instanceof CommentError ? error.message : reason(error);
      set({ error: message });
      deps.notify(message);
      return Promise.resolve(false);
    }
    pending = [...pending, ...ops];
    show();
    return new Promise((done) => {
      jobs.push({ ops, done, epoch });
      void drain().then(() => poll());
    });
  }

  const textOps = (text: string): { text: string; mentions: string[] } => ({ text, mentions: findMentions(text, deps.names?.() ?? []) });
  const message = (text: string): CommentMessage => {
    const who = deps.who();
    const mentions = textOps(text).mentions;
    return { id: deps.newId(), owner: who.owner, author: { name: who.name, color: who.color }, text, at: deps.now(), ...(mentions.length ? { mentions } : {}) };
  };
  const threadOf = (id: string) => get().file.threads.find((thread) => thread.id === id);
  const messageOf = (thread: CommentThread, id: string) => liveMessages(thread).find((entry) => entry.id === id);
  /** Only your own messages, unless you moderate. */
  const mayChange = (entry: CommentMessage | undefined) => !!entry && (entry.owner === deps.who().owner || deps.who().moderator);
  const refuse = (words: string) => { deps.notify(words); return Promise.resolve(false); };

  function attach(target: CommentTarget | null): void {
      stops.forEach((stop) => stop());
      stops = [];
      epoch++;
      base = emptyComments();
      lastText = null;
      pending = [];
      jobs = [];
      polling = false;
      set({ ...initial(), summary: get().summary, filter: get().filter, target, seenAt: target ? deps.seen.get(targetKey(target)) : 0 });
      if (!target) return;
      void poll();
      void scan();
      stops.push(deps.every(deps.pollMs ?? POLL_MS, () => void poll()), deps.every(deps.scanMs ?? SCAN_MS, () => void scan()));
  }

  return {
    store,
    attach,
    refresh: poll,
    scan,
    detach: () => attach(null),

    setFilter: (filter: CommentsState['filter']) => set({ filter }),
    open: (id: string | null) => set({ active: id, draft: id ? null : get().draft }),
    startDraft: (anchor: CommentAnchor) => set({ draft: { anchor }, active: null, tool: false }),
    setTool: (tool: boolean) => set({ tool, draft: tool ? null : get().draft }),
    cancelDraft: () => set({ draft: null }),
    /** The person looked at the comments: what mentions them is no longer new. */
    markSeen(): void {
      const { target } = get();
      if (!target) return;
      const at = deps.now();
      deps.seen.set(targetKey(target), at);
      set({ seenAt: at });
    },

    async createThread(anchor: CommentAnchor, text: string): Promise<boolean> {
      const id = deps.newId();
      const ok = await submit([{ op: 'thread', thread: newThread({ id, anchor, message: message(text) }) }]);
      if (ok) set({ draft: null, active: id });
      return ok;
    },
    reply(threadId: string, text: string): Promise<boolean> {
      const thread = threadOf(threadId);
      if (!thread || thread.deleted !== undefined) return refuse(uiText("Esta conversa não existe mais."));
      return submit([{ op: 'reply', thread: threadId, message: message(text) }]);
    },
    edit(threadId: string, messageId: string, text: string): Promise<boolean> {
      const thread = threadOf(threadId);
      if (!thread || !mayChange(messageOf(thread, messageId))) return refuse(uiText("Só dá para editar os próprios comentários."));
      const { text: clean, mentions } = textOps(text);
      return submit([{ op: 'edit', thread: threadId, message: messageId, text: clean, mentions, at: deps.now() }]);
    },
    remove(threadId: string, messageId: string): Promise<boolean> {
      const thread = threadOf(threadId);
      if (!thread || !mayChange(messageOf(thread, messageId))) return refuse(uiText("Só dá para excluir os próprios comentários."));
      return submit([{ op: 'remove', thread: threadId, message: messageId, at: deps.now() }]);
    },
    setStatus(threadId: string, status: 'open' | 'resolved'): Promise<boolean> {
      const who = deps.who();
      if (!threadOf(threadId)) return refuse(uiText("Esta conversa não existe mais."));
      return submit([{ op: 'status', thread: threadId, status, by: { name: who.name, color: who.color }, at: deps.now() }]);
    },
    deleteThread(threadId: string): Promise<boolean> {
      const thread = threadOf(threadId);
      if (!thread || (thread.by !== deps.who().owner && !deps.who().moderator)) return refuse(uiText("Só quem começou a conversa pode excluí-la."));
      return submit([{ op: 'delete', thread: threadId, at: deps.now() }]);
    },
  };
}

export type CommentsStore = ReturnType<typeof createCommentsStore>;

/** The kind and slug of a comments path, for a caller that has the path. */
export const targetOfPath = (path: string): CommentTarget | null => parseCommentsPath(path);
