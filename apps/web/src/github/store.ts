import { journey } from '../onboarding/journey';
import { uiText } from '../i18n';
import { createStore } from 'zustand/vanilla';
import type { GitChange, GitRepo, GithubClient } from './client';

export const REPO_KEY = 'strukt:repo';

export interface GithubState {
  open: boolean;
  /** Absolute path of the repository folder (the browser cannot discover it by itself). */
  repoPath: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  repo: GitRepo | null;
  changes: GitChange[];
  diff: string;
  diffStatus: 'idle' | 'loading' | 'ready' | 'error';
  title: string;
  body: string;
  draft: boolean;
  branch: string;
  publishing: boolean;
  publishedUrl: string | null;
  publishError: string | null;
  prText: string;
  prStatus: 'idle' | 'loading' | 'ready' | 'error';
  setOpen(open: boolean): void;
  setRepoPath(path: string): void;
  setTitle(title: string): void;
  setBody(body: string): void;
  setDraft(draft: boolean): void;
  setBranch(branch: string): void;
  refresh(options?: { quiet?: boolean }): Promise<void>;
  loadDiff(): Promise<void>;
  publish(): Promise<void>;
  loadPr(): Promise<void>;
}

export interface GithubDeps {
  client: Pick<GithubClient, 'status' | 'changes' | 'diff' | 'publish' | 'pr'>;
  notify(message: string): void;
  /** Where `repoPath` is kept (localStorage in the app, a fake in tests). */
  storage?: { get(key: string): string | null; set(key: string, value: string): void };
  defaultTitle?: string;
}

const DEFAULT_TITLE = uiText("Atualiza a arquitetura");

function readPath(storage: GithubDeps['storage']): string {
  try {
    return storage?.get(REPO_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * The GitHub panel: repo info + pending `.arch/` changes, the semantic diff and the publish flow.
 * Every call goes through the local server (`/api/git/*`), which runs git/gh in the given folder.
 */
export function createGithubStore(deps: GithubDeps) {
  let generation = 0;
  return createStore<GithubState>()((set, get) => ({
    open: false,
    repoPath: readPath(deps.storage),
    status: 'idle',
    error: null,
    repo: null,
    changes: [],
    diff: '',
    diffStatus: 'idle',
    title: deps.defaultTitle ?? DEFAULT_TITLE,
    body: '',
    draft: false,
    branch: '',
    publishing: false,
    publishedUrl: null,
    publishError: null,
    prText: '',
    prStatus: 'idle',

    setOpen(open) {
      set({ open });
      if (open) void get().refresh();
    },

    setRepoPath(path) {
      generation++;
      const repoPath = path.trim();
      try {
        deps.storage?.set(REPO_KEY, repoPath);
      } catch {
        // the path still applies for this session
      }
      set({ repoPath, repo: null, changes: [], diff: '', diffStatus: 'idle', status: repoPath ? 'loading' : 'idle', error: null,
        title: deps.defaultTitle ?? DEFAULT_TITLE, body: '', branch: '', draft: false, publishing: false,
        publishedUrl: null, publishError: null, prText: '', prStatus: 'idle', open: false });
      if (repoPath) void get().refresh();
    },

    setTitle(title) {
      set({ title });
    },

    setBody(body) {
      set({ body });
    },

    setDraft(draft) {
      set({ draft });
    },

    setBranch(branch) {
      set({ branch });
    },

    /** Reads repo info + pending changes; `quiet` is the badge poll (no loading flicker, no toast). */
    async refresh(options = {}) {
      const epoch = generation;
      const dir = get().repoPath;
      if (!dir) return;
      if (!options.quiet) set({ status: 'loading', error: null });
      // The silent badge poll only needs the pending changes; the open panel keeps the full status.
      if (options.quiet && !get().open && get().repo) {
        const light = await deps.client.changes(dir);
        if (epoch !== generation) return;
        if (light.kind === 'ok') set({ status: 'ready', changes: light.changes, error: null });
        else set({ status: 'error', error: light.kind === 'offline' ? light.reason : light.message, repo: null, changes: [] });
        return;
      }
      const reply = await deps.client.status(dir);
      if (epoch !== generation) return;
      if (reply.kind === 'ok') {
        set({ status: 'ready', repo: reply.repo, changes: reply.changes, error: null });
        return;
      }
      const message = reply.kind === 'offline' ? reply.reason : reply.message;
      set({ status: 'error', error: message, repo: null, changes: [] });
      if (!options.quiet && reply.kind === 'offline') deps.notify(message);
    },

    /** The semantic diff of the working tree against the base branch. */
    async loadDiff() {
      const epoch = generation;
      const { repoPath, repo } = get();
      if (!repoPath) return;
      set({ diffStatus: 'loading' });
      const reply = await deps.client.diff(repoPath, repo?.defaultBase ?? undefined);
      if (epoch !== generation) return;
      if (reply.kind === 'ok') set({ diffStatus: 'ready', diff: reply.markdown });
      else set({ diffStatus: 'error', diff: reply.kind === 'offline' ? reply.reason : reply.message });
    },

    async publish() {
      const captured=journey.token();
      const epoch = generation;
      const { repoPath, title, body, branch, draft } = get();
      if (!repoPath || !title.trim() || get().publishing) return;
      set({ publishing: true, publishError: null, publishedUrl: null });
      const reply = await deps.client.publish({ dir: repoPath, title: title.trim(), body, branch: branch.trim() || undefined, draft });
      if (epoch !== generation) return;
      if (reply.kind === 'ok') {
        set({ publishing: false, publishedUrl: reply.url });
        journey.complete('publish',captured);
        deps.notify(uiText("PR aberto: {0}", [reply.url]));
        await get().refresh();
        await get().loadDiff();
        return;
      }
      const message = reply.kind === 'offline' ? reply.reason : reply.message;
      set({ publishing: false, publishError: message });
      deps.notify(message);
    },

    async loadPr() {
      const epoch = generation;
      const { repoPath } = get();
      if (!repoPath) return;
      set({ prStatus: 'loading' });
      const reply = await deps.client.pr(repoPath);
      if (epoch !== generation) return;
      if (reply.kind === 'ok') set({ prStatus: 'ready', prText: reply.text });
      else set({ prStatus: 'error', prText: reply.kind === 'offline' ? reply.reason : reply.message });
    },
  }));
}

export type GithubStore = ReturnType<typeof createGithubStore>;
