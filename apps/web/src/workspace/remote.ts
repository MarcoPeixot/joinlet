import { identifyNavigation } from './navigation';
import { setRequestCsrf } from './requestAuth';
import { systemMessage, uiText } from '../i18n';
import { MANIFEST_PATH, StorageConflict } from '@strukt/workspace';
import type { StorageAdapter } from '@strukt/workspace';
import { ACCESS_ENDED, accessEnded } from './accessEnded';
import { mergeManifestTexts } from './manifestMerge';

export interface RemoteSession {
  owner?: boolean; apiBase?: string;
  repo: string; csrf: string; mcpUrl: string; mode?: 'lan' | 'cloud';
  /** What the invite allows: `edit` changes everything, `comment` only writes comments, `view` nothing. */
  role?: 'edit' | 'comment' | 'view';
  /** A link that cannot edit the workspace (`view`, `comment`): the adapter sends no write, except comments for `comment`. */
  readOnly?: boolean;
  /** Who owns this guest's comments for the host's write rule (the invite's id): see `checkCommentWrite`. */
  member?: string;
}
export type RemoteConnection = { kind: 'ready'; session: RemoteSession } | { kind: 'login'; mcpUrl: string } | { kind: 'ended'; message: string } | null;

export async function remoteSession(): Promise<RemoteConnection> {
  setRequestCsrf(undefined);
  const response = await fetch('/api/remote/session').catch(() => null);
  if (!response) return null;
  if (response.status === 401) {
    const body = await response.json().catch(() => ({})) as { mcpUrl?: string; code?: string; error?: string };
    if (body.code === 'invite_ended') return { kind: 'ended', message: typeof body.error === 'string' ? body.error : ACCESS_ENDED };
    return typeof body.mcpUrl === 'string' ? { kind: 'login', mcpUrl: body.mcpUrl } : null;
  }
  if (response.status === 403) {
    const body = await response.json();
    throw new Error(systemMessage(body.error ?? 'Workspace unavailable.'));
  }
  if (!response.ok) return null;
  const body = await response.json() as Partial<RemoteSession>;
  if (typeof body.csrf === 'string') setRequestCsrf(body.csrf);
  return typeof body.repo === 'string' && typeof body.csrf === 'string' && typeof body.mcpUrl === 'string' ? { kind: 'ready', session: body as RemoteSession } : null;
}

/** A manifest the host holds that this guest's list has not absorbed yet; `base` is the text this guest last read or wrote. */
export interface ManifestUpdate { base: string | null; theirs: string }

/** The shared session's storage: besides reads and writes it keeps the one manifest every guest writes in step with the host's. */
export interface RemoteAdapter extends StorageAdapter {
  /** Asks the host for `strukt.json`; resolves the update when somebody else changed it since this guest last saw it, else null. */
  pollManifest(): Promise<ManifestUpdate | null>;
  /** Called after a save found the manifest changed by someone else and merged both lists (the host now holds `theirs`, the merge). */
  onManifestMerged(listener: (update: ManifestUpdate) => void): () => void;
}

const MANIFEST_RETRIES = 3;

export function createRemoteAdapter(session: RemoteSession): RemoteAdapter {
  const api = session.apiBase ?? '/api';
  const endpoint = `${api}/remote/workspace?repo=${encodeURIComponent(session.repo)}`;
  const baseline = new Map<string, string | null>();
  let knownFiles: string[] = [];
  let revision = 0;
  let revisionCheckedAt = 0;
  /** The manifest text last seen on the host (read, written or polled): a poll reports only what differs from it. */
  let seenManifest: string | null = null;
  /** Bumped by every manifest write: a poll that overlapped one drops its answer (it may predate the write). */
  let manifestWrites = 0;
  const mergedListeners = new Set<(update: ManifestUpdate) => void>();
  async function request(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const response = await fetch(url.startsWith('/api/remote/') ? api + url.slice(4) : url, init);
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      if (response.status === 401 && data.code === 'invite_ended') accessEnded();
      const message = typeof data.error === 'string' ? systemMessage(data.error) : uiText("Falha ao acessar o GitHub.");
      throw response.status === 409 ? new StorageConflict(message) : new Error(message);
    }
    return data;
  }
  /** A read-only link sends no write; a `comment` link still writes comments (the host holds it to its own rule). */
  const blocked = (path: string) => session.readOnly === true && !(session.role === 'comment' && path.startsWith('comments/'));
  const post = async (path: string, body: Record<string, unknown>) => {
    const data = await request(path, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-strukt-csrf': session.csrf },
      body: JSON.stringify({ repo: session.repo, ...body }),
    });
    if (typeof data.revision === 'number') {
      revision = data.revision;
      revisionCheckedAt = Date.now();
    }
    return data;
  };
  /**
   * The manifest lists everyone's items, so a stale `expected` is not a failure: read what the host has now, keep both
   * guests' changes (`mergeManifestTexts`, three ways against the text this guest last saw) and write the merge over it.
   * The baseline is always the host's text, so the next attempt (or "Tentar de novo") starts from the truth.
   */
  const writeManifest = async (text: string): Promise<void> => {
    manifestWrites++;
    let mine = text;
    let merged: { base: string | null } | null = null;
    for (let attempt = 0; ; attempt++) {
      try {
        await post('/api/remote/workspace', { path: MANIFEST_PATH, text: mine, expected: baseline.get(MANIFEST_PATH) ?? null });
        baseline.set(MANIFEST_PATH, mine);
        seenManifest = mine;
        if (!knownFiles.includes(MANIFEST_PATH)) knownFiles.push(MANIFEST_PATH);
        break;
      } catch (error) {
        if (!(error instanceof StorageConflict) || attempt >= MANIFEST_RETRIES) throw error;
        const base: string | null = baseline.get(MANIFEST_PATH) ?? null;
        const theirs = (await request(`${endpoint}&path=${encodeURIComponent(MANIFEST_PATH)}`)).text as string | null;
        baseline.set(MANIFEST_PATH, theirs);
        merged ??= { base };
        if (theirs !== null) mine = mergeManifestTexts(base, mine, theirs);
      }
    }
    manifestWrites++;
    if (merged) for (const listener of [...mergedListeners]) listener({ base: merged.base, theirs: mine });
  };
  return identifyNavigation({
    kind: 'folder',
    label: session.mode === 'cloud' ? 'Joinlet Cloud' : session.mode === 'lan' ? uiText("Rede local: {0}", [session.repo]) : `GitHub: ${session.repo}`,
    async read(path) {
      const text = (await request(`${endpoint}&path=${encodeURIComponent(path)}`)).text as string | null;
      baseline.set(path, text);
      if (path === MANIFEST_PATH) seenManifest = text;
      return text;
    },
    async write(path, text) {
      if (session.mode === 'cloud' && path.startsWith('context/')) return;
      if (blocked(path)) return;
      if (path === MANIFEST_PATH) return writeManifest(text);
      await post('/api/remote/workspace', { path, text, ...(!path.startsWith('context/') ? { expected: baseline.get(path) ?? null } : {}) });
      baseline.set(path, text);
      if (!knownFiles.includes(path)) knownFiles.push(path);
    },
    async remove(path) {
      if (blocked(path)) return;
      await post('/api/remote/workspace', { path, remove: true, ...(!path.startsWith('context/') ? { expected: baseline.get(path) ?? null } : {}) });
      baseline.set(path, null);
      knownFiles = knownFiles.filter((file) => file !== path);
    },
    async list() {
      knownFiles = (await request(endpoint)).files as string[];
      return knownFiles;
    },
    async pollManifest() {
      const mark = manifestWrites;
      const theirs = (await request(`${endpoint}&path=${encodeURIComponent(MANIFEST_PATH)}`)).text as string | null;
      if (theirs === null || mark !== manifestWrites || theirs === seenManifest) return null;
      seenManifest = theirs;
      const base = baseline.get(MANIFEST_PATH) ?? null;
      return theirs === base ? null : { base, theirs };
    },
    onManifestMerged(listener) {
      mergedListeners.add(listener);
      return () => void mergedListeners.delete(listener);
    },
    async stamps() {
      if (!knownFiles.length) knownFiles = (await request(endpoint)).files as string[];
      if (Date.now() - revisionCheckedAt > 15_000) {
        revision = (await request(`/api/remote/revision?repo=${encodeURIComponent(session.repo)}`)).revision as number;
        revisionCheckedAt = Date.now();
      }
      return Object.fromEntries(knownFiles.map((file) => [file, revision]));
    },
  }, `remote:${session.mode ?? "github"}:${api}:${session.repo}`);
}

export async function initializeRemote(session: RemoteSession): Promise<string[]> {
  const response = await fetch('/api/remote/init', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-strukt-csrf': session.csrf },
    body: JSON.stringify({ repo: session.repo }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? uiText("Não foi possível iniciar o workspace no GitHub."));
  }
  const body = await response.json() as { setup?: { conflicts?: string[] } };
  return body.setup?.conflicts ?? [];
}
