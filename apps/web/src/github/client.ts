import { uiText } from '../i18n';
/** The slice of `fetch` the GitHub client uses; tests inject a fake. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface GitRepo {
  root: string;
  archDir: string;
  nameWithOwner: string | null;
  branch: string;
  defaultBase: string | null;
  ghReady: boolean;
}

export interface GitChange {
  status: string;
  path: string;
}
export interface ArchitectureIssue { diagram: string; id: string; path: string; message: string }

/** `offline`: the local server is not running (or answered 503): the panel explains and stops. */
export type GithubReply<T> = ({ kind: 'ok' } & T) | { kind: 'offline'; reason: string } | { kind: 'error'; message: string };

export interface PublishInput {
  dir: string;
  title: string;
  body?: string;
  branch?: string;
  base?: string;
  draft?: boolean;
}

const UNREACHABLE = uiText("O servidor local (bun run dev) precisa estar rodando para falar com o git e o gh.");

const defaultFetch: Fetch = (input, init) => globalThis.fetch(input, init);

type Raw = { kind: 'json'; status: number; data: Record<string, unknown> } | { kind: 'offline'; reason: string };

async function call(path: string, init: RequestInit, fetchFn: Fetch, signal?: AbortSignal): Promise<Raw> {
  let res: Response;
  try {
    res = await fetchFn(path, { ...init, signal });
  } catch {
    return { kind: 'offline', reason: UNREACHABLE };
  }
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const data: unknown = isJson ? await res.json().catch(() => null) : null;
  // Our server always answers JSON; anything else is the dev proxy answering for a server that is not running.
  if (!data || typeof data !== 'object') return { kind: 'offline', reason: UNREACHABLE };
  const record = data as Record<string, unknown>;
  if (res.status === 503) return { kind: 'offline', reason: typeof record.error === 'string' ? record.error : UNREACHABLE };
  return { kind: 'json', status: res.status, data: record };
}

function failure(status: number, data: Record<string, unknown>): { kind: 'error'; message: string } {
  return { kind: 'error', message: typeof data.error === 'string' ? data.error : uiText("O servidor respondeu {0}.", [status]) };
}

const post = (path: string, body: unknown, fetchFn: Fetch, signal?: AbortSignal) =>
  call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, fetchFn, signal);

export async function requestGitStatus(dir: string, fetchFn: Fetch = defaultFetch, signal?: AbortSignal): Promise<GithubReply<{ repo: GitRepo; changes: GitChange[] }>> {
  const res = await call(`/api/git/status?dir=${encodeURIComponent(dir)}`, { method: 'GET' }, fetchFn, signal);
  if (res.kind === 'offline') return res;
  if (res.status >= 400) return failure(res.status, res.data);
  const { repo, changes } = res.data as { repo?: GitRepo; changes?: GitChange[] };
  if (!repo || !Array.isArray(changes)) return { kind: 'error', message: uiText("Resposta inválida do servidor.") };
  return { kind: 'ok', repo, changes };
}

/** The badge poll: pending changes only (no gh calls, no repo info). */
export async function requestGitChanges(dir: string, fetchFn: Fetch = defaultFetch, signal?: AbortSignal): Promise<GithubReply<{ changes: GitChange[] }>> {
  const res = await call(`/api/git/changes?dir=${encodeURIComponent(dir)}`, { method: 'GET' }, fetchFn, signal);
  if (res.kind === 'offline') return res;
  if (res.status >= 400) return failure(res.status, res.data);
  const { changes } = res.data as { changes?: GitChange[] };
  if (!Array.isArray(changes)) return { kind: 'error', message: uiText("Resposta inválida do servidor.") };
  return { kind: 'ok', changes };
}

export async function requestGitDiff(dir: string, base?: string, fetchFn: Fetch = defaultFetch, signal?: AbortSignal): Promise<GithubReply<{ markdown: string }>> {
  const res = await post('/api/git/diff', { dir, base }, fetchFn, signal);
  if (res.kind === 'offline') return res;
  if (res.status >= 400) return failure(res.status, res.data);
  const { markdown } = res.data as { markdown?: string };
  if (typeof markdown !== 'string') return { kind: 'error', message: uiText("Resposta inválida do servidor.") };
  return { kind: 'ok', markdown };
}

export async function requestGitDiagram(dir: string, diagram: string, base: string, fetchFn: Fetch = defaultFetch, signal?: AbortSignal): Promise<GithubReply<{ ref: string; json: string; layout: string | null; shared: string | null; flows: string | null }>> {
  const res = await post('/api/git/diagram', { dir, diagram, base }, fetchFn, signal);
  if (res.kind === 'offline') return res;
  if (res.status >= 400) return failure(res.status, res.data);
  const { ref, json, layout, shared, flows } = res.data;
  if (typeof ref !== 'string' || typeof json !== 'string' || !(typeof layout === 'string' || layout === null)) return { kind: 'error', message: uiText("Resposta inválida do servidor.") };
  return { kind: 'ok', ref, json, layout, shared: typeof shared === 'string' ? shared : null, flows: typeof flows === 'string' ? flows : null };
}

export async function requestGitHealth(dir: string, fetchFn: Fetch = defaultFetch, signal?: AbortSignal): Promise<GithubReply<{ evidence: ArchitectureIssue[] }>> {
  const res = await post('/api/git/health', { dir }, fetchFn, signal);
  if (res.kind === 'offline') return res;
  if (res.status >= 400) return failure(res.status, res.data);
  const { evidence } = res.data;
  if (!Array.isArray(evidence)) return { kind: 'error', message: uiText("Resposta inválida do servidor.") };
  return { kind: 'ok', evidence: evidence as ArchitectureIssue[] };
}

export async function requestGitPublish(input: PublishInput, fetchFn: Fetch = defaultFetch, signal?: AbortSignal): Promise<GithubReply<{ url: string; branch: string }>> {
  const res = await post('/api/git/publish', input, fetchFn, signal);
  if (res.kind === 'offline') return res;
  if (res.status >= 400) return failure(res.status, res.data);
  const { url, branch } = res.data as { url?: string; branch?: string };
  if (typeof url !== 'string' || typeof branch !== 'string') return { kind: 'error', message: uiText("Resposta inválida do servidor.") };
  return { kind: 'ok', url, branch };
}

export async function requestGitPr(dir: string, pr?: string, fetchFn: Fetch = defaultFetch, signal?: AbortSignal): Promise<GithubReply<{ text: string }>> {
  const res = await post('/api/git/pr', { dir, pr }, fetchFn, signal);
  if (res.kind === 'offline') return res;
  if (res.status >= 400) return failure(res.status, res.data);
  const { text } = res.data as { text?: string };
  if (typeof text !== 'string') return { kind: 'error', message: uiText("Resposta inválida do servidor.") };
  return { kind: 'ok', text };
}

export const githubClient = {
  status: requestGitStatus,
  changes: requestGitChanges,
  diff: requestGitDiff,
  diagram: requestGitDiagram,
  health: requestGitHealth,
  publish: requestGitPublish,
  pr: requestGitPr,
};

export type GithubClient = typeof githubClient;
