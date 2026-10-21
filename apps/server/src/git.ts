import { assertBetaGrowth, BetaLimitError } from '@strukt/workspace';
import { isAbsolute, join, resolve } from 'node:path';
import { lstat, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { AGENT_CONFIG_PATHS, diffWorktree, prStatus, publish, renderDiffMarkdown } from '@strukt/git';
import type { CommandRunner } from '@strukt/git';
import { createMemoryAdapter, loadWorkspace, openConcerns, parseCommentsPath, workspaceFiles, writeFiles } from '@strukt/workspace';
import { checkEvidence } from '@strukt/workspace/health';
import { createFsAdapter, findArchDir, openWorkspaceAt } from '@strukt/workspace/fs';

export interface GitRepoInfo {
  root: string;
  archDir: string;
  nameWithOwner: string | null;
  branch: string;
  defaultBase: string | null;
  ghReady: boolean;
}

export interface GitChange {
  /** Two-letter porcelain code, trimmed (`M`, `A`, `D`, `??`…). */
  status: string;
  path: string;
}

/** Gives gh and git HTTPS pushes a per-process OAuth token without changing global Git config. */
export function withGithubToken(runner: CommandRunner, token: string | null, requireOAuth = false): CommandRunner {
  if (!token && !requireOAuth) return runner;
  const env = {
    // An invalid sentinel prevents gh from silently falling back to a different account already logged in on the machine.
    GH_TOKEN: token ?? 'strukt-oauth-not-connected',
    GITHUB_TOKEN: token ?? 'strukt-oauth-not-connected',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '3',
    GIT_CONFIG_KEY_0: 'credential.helper',
    GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
    GIT_CONFIG_VALUE_1: '',
    GIT_CONFIG_KEY_2: 'credential.https://github.com.helper',
    GIT_CONFIG_VALUE_2: '!gh auth git-credential',
  };
  return (cmd, args, options) => runner(cmd, args, { ...options, env: { ...options?.env, ...env } });
}

export type GitStatusReply = { ok: true; repo: GitRepoInfo; changes: GitChange[] } | { ok: false; error: string };
export type GitDiffReply = { ok: true; markdown: string } | { ok: false; error: string };
export type GitPublishReply = { ok: true; url: string; branch: string } | { ok: false; error: string };
export type GitPrReply = { ok: true; text: string } | { ok: false; error: string };
export type GitDiagramReply = { ok: true; ref: string; json: string; layout: string | null; shared: string | null; flows: string | null } | { ok: false; error: string };
export type GitHealthReply = { ok: true; concerns: ReturnType<typeof openConcerns>; evidence: Awaited<ReturnType<typeof checkEvidence>> } | { ok: false; error: string };

const parseChanges = (text: string): GitChange[] =>
  text
    .split('\n')
    .filter(Boolean)
    .map((line) => ({ status: line.slice(0, 2).trim() || '?', path: line.slice(3) }));

/** Finds the exact git root before a workspace exists; used only by the first-time connection. */
export async function gitRepoRoot(runner: CommandRunner, dir: string): Promise<{ root: string } | { error: string }> {
  if (!dir.trim() || !isAbsolute(dir)) return { error: 'Informe o caminho absoluto da pasta do repositório.' };
  let directory: Awaited<ReturnType<typeof stat>>;
  try {
    directory = await stat(dir);
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    return { error: code === 'ENOENT' ? 'A pasta do repositório não existe neste computador.' : `Não foi possível abrir a pasta do repositório (${code ?? 'erro de acesso'}).` };
  }
  if (!directory.isDirectory()) return { error: 'O caminho informado não é uma pasta.' };
  try {
    const result = await runner('git', ['rev-parse', '--show-toplevel'], { cwd: dir });
    const root = result.stdout.trim();
    if (result.code !== 0 || !isAbsolute(root)) return { error: 'A pasta não é um repositório git.' };
    return { root: resolve(root) };
  } catch (cause) {
    return { error: `Não foi possível executar git nesta pasta: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
}

/** Copies a browser workspace into a git repo that has no `.arch/`, without touching other repo files. */
export async function initializeRepoWorkspace(root: string, raw: unknown): Promise<{ ok: true } | { ok: false; error: string; code?: string }> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'O workspace do navegador não foi enviado.' };
  const entries = Object.entries(raw);
  if (entries.length > 2_000 || entries.some(([, text]) => typeof text !== 'string') || entries.reduce((size, [, text]) => size + (typeof text === 'string' ? Buffer.byteLength(text, 'utf8') : 0), 0) > 8_000_000) {
    return { ok: false, error: 'O workspace é grande demais ou contém arquivos inválidos.' };
  }
  const files = Object.fromEntries(entries) as Record<string, string>;
  try {
    const loaded = await loadWorkspace(createMemoryAdapter(files));
    if (!loaded || loaded.warnings.length) return { ok: false, error: 'O workspace do navegador contém arquivos inválidos.' };
    assertBetaGrowth('diagrams', 0, loaded.data.manifest.diagrams.length);
    const owned = new Set(Object.keys(workspaceFiles(loaded.data)));
    for (const path of Object.keys(files)) {
      const safe = path && !path.startsWith('/') && !path.includes('\\') && !path.includes('\0') && path.split('/').every((part) => part && part !== '.' && part !== '..');
      if (!safe || (!owned.has(path) && !path.startsWith('versions/') && !path.startsWith('context/') && parseCommentsPath(path) === null)) {
        return { ok: false, error: `Arquivo não permitido no workspace: ${path}.` };
      }
    }
  } catch (error) {
    if (error instanceof BetaLimitError) return { ok: false, ...error.toJSON() };
    return { ok: false, error: 'O workspace do navegador não pôde ser validado.' };
  }

  const target = join(root, '.arch');
  try {
    await lstat(target);
    return { ok: false, error: 'A pasta .arch/ já existe. Confira o conteúdo antes de conectar.' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { ok: false, error: 'Não foi possível verificar a pasta .arch/.' };
  }
  const temporary = await mkdtemp(join(root, '.arch-strukt-'));
  try {
    await writeFiles(createFsAdapter(temporary), files);
    await rename(temporary, target);
    return { ok: true };
  } catch {
    await rm(temporary, { recursive: true, force: true });
    return { ok: false, error: 'Não foi possível criar .arch/ no repositório.' };
  }
}

/** Resolves the repository root of a workspace directory (the browser cannot know it by itself). */
async function resolveRoot(dir: string): Promise<{ root: string; archDir: string } | { error: string }> {
  if (typeof dir !== 'string' || !dir.trim() || !isAbsolute(dir)) return { error: 'Informe o caminho absoluto da pasta do repositório.' };
  const opened = await openWorkspaceAt(dir);
  if (!opened) return { error: 'A pasta não tem um workspace do Joinlet (.arch/strukt.json).' };
  return { root: opened.root, archDir: opened.archDir };
}

const GH_TTL_MS = 5 * 60_000;

interface GhInfo { ghReady: boolean; nameWithOwner: string | null; defaultBase: string | null }
/** `gh auth status` + `gh repo view` per repo root; `key` (the token) invalidates it on login/logout. */
export type GhCache = Map<string, { at: number; key: string | null; value: GhInfo }>;
const defaultGhCache: GhCache = new Map();

export interface GitStatusOptions {
  cache?: GhCache;
  /** Changes when the GitHub account does (the OAuth token), so a login is never masked by the cache. */
  cacheKey?: string | null;
  now?: () => number;
}

/** Root resolved once per path: later polls only stat `.arch/strukt.json`, never re-walk or re-parse the workspace. */
const rootCache = new Map<string, { root: string; archDir: string }>();

async function resolveLightRoot(dir: string): Promise<{ root: string; archDir: string } | { error: string }> {
  if (typeof dir !== 'string' || !dir.trim() || !isAbsolute(dir)) return { error: 'Informe o caminho absoluto da pasta do repositório.' };
  const cached = rootCache.get(dir);
  if (cached) {
    const still = await stat(join(cached.archDir, 'strukt.json')).then((info) => info.isFile(), () => false);
    if (still) return cached;
    rootCache.delete(dir);
  }
  const found = await findArchDir(dir);
  if (!found) return { error: 'A pasta não tem um workspace do Joinlet (.arch/strukt.json).' };
  rootCache.set(dir, found);
  return found;
}

export type GitChangesReply = { ok: true; changes: GitChange[] } | { ok: false; error: string };

/** The badge poll: only `git status --porcelain`, no gh, no workspace parse. */
export async function gitChanges(runner: CommandRunner, dir: string): Promise<GitChangesReply> {
  const resolved = await resolveLightRoot(dir);
  if ('error' in resolved) return { ok: false, error: resolved.error };
  const status = await runner('git', ['status', '--porcelain', '--', '.arch', ...AGENT_CONFIG_PATHS], { cwd: resolved.root });
  if (status.code !== 0) return { ok: false, error: 'A pasta não é um repositório git.' };
  return { ok: true, changes: parseChanges(status.stdout) };
}

/** Repo info + pending `.arch/` changes, for the GitHub panel. */
export async function gitStatus(runner: CommandRunner, dir: string, options: GitStatusOptions = {}): Promise<GitStatusReply> {
  const { cache = defaultGhCache, cacheKey = null, now = Date.now } = options;
  const resolved = await resolveLightRoot(dir);
  if ('error' in resolved) return { ok: false, error: resolved.error };
  const git = (args: readonly string[]) => runner('git', args, { cwd: resolved.root });
  const inside = await git(['rev-parse', '--is-inside-work-tree']);
  if (inside.code !== 0) return { ok: false, error: 'A pasta não é um repositório git.' };

  const branch = (await git(['branch', '--show-current'])).stdout.trim() || '(destacado)';
  let info: GhInfo;
  const hit = cache.get(resolved.root);
  if (hit && hit.key === cacheKey && now() - hit.at < GH_TTL_MS) info = hit.value;
  else {
    const gh = (args: readonly string[]) => runner('gh', args, { cwd: resolved.root });
    const auth = await gh(['auth', 'status']);
    info = { ghReady: auth.code === 0, nameWithOwner: null, defaultBase: null };
    if (auth.code === 0) {
      const view = await gh(['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef', '--jq', '.nameWithOwner + "\\n" + .defaultBranchRef.name']);
      if (view.code === 0) {
        const [name, base] = view.stdout.trim().split('\n');
        info.nameWithOwner = name?.trim() || null;
        info.defaultBase = base?.trim() || null;
      }
    }
    cache.set(resolved.root, { at: now(), key: cacheKey, value: info });
  }
  const changes = parseChanges((await git(['status', '--porcelain', '--', '.arch', ...AGENT_CONFIG_PATHS])).stdout);
  return {
    ok: true,
    repo: { root: resolved.root, archDir: resolved.archDir, nameWithOwner: info.nameWithOwner, branch, defaultBase: info.defaultBase, ghReady: info.ghReady },
    changes,
  };
}

/** The semantic diff of the working tree against `base` (the default branch when omitted). */
export async function gitDiff(runner: CommandRunner, dir: string, base?: string): Promise<GitDiffReply> {
  const resolved = await resolveRoot(dir);
  if ('error' in resolved) return { ok: false, error: resolved.error };
  let reference = base?.trim();
  if (!reference) {
    const status = await gitStatus(runner, dir);
    reference = status.ok ? status.repo.defaultBase ?? 'HEAD' : 'HEAD';
  }
  const outcome = await diffWorktree(runner, resolved.root, reference);
  if (!outcome.ok) return { ok: false, error: outcome.error };
  const health = await gitHealth(dir);
  const issues = health.ok ? health.evidence : [];
  const safe = (value: string) => value.replace(/\s+/g, ' ').trim().replace(/[\\`*_[\]<>#|]/g, '\\$&');
  const details = issues.length ? `\n### Evidências quebradas\n\n${issues.map((issue) => `- ${safe(`${issue.diagram}/${issue.id}`)}${issue.path ? ` (${safe(issue.path)})` : ''}: ${safe(issue.message)}`).join('\n')}\n` : '';
  return { ok: true, markdown: `${renderDiffMarkdown(outcome.result)}${details}` };
}

export async function gitHealth(dir: string): Promise<GitHealthReply> {
  const resolved = await resolveRoot(dir);
  if ('error' in resolved) return { ok: false, error: resolved.error };
  const opened = await openWorkspaceAt(resolved.root);
  if (!opened) return { ok: false, error: 'Workspace do Joinlet não encontrado.' };
  return { ok: true, concerns: openConcerns(opened.data.concerns), evidence: await checkEvidence(opened.data, resolved.root) };
}

/** Reads one diagram at a Git ref for a read-only canvas comparison. */
export async function gitDiagramAtRef(runner: CommandRunner, dir: string, ref: string, slug: string): Promise<GitDiagramReply> {
  const resolved = await resolveRoot(dir);
  if ('error' in resolved) return { ok: false, error: resolved.error };
  if (!/^[A-Za-z0-9][A-Za-z0-9_./-]{0,150}$/.test(ref) || ref.includes('..') || ref.endsWith('/')) return { ok: false, error: 'Ref do Git inválida.' };
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(slug)) return { ok: false, error: 'Nome de diagrama inválido.' };
  const show = (path: string) => runner('git', ['show', `${ref}:.arch/diagrams/${slug}.${path}`], { cwd: resolved.root });
  const json = await show('strukt.json');
  if (json.code !== 0) return { ok: false, error: `Diagrama "${slug}" não encontrado em "${ref}".` };
  const layout = await show('layout.json');
  const shared = await runner('git', ['show', `${ref}:.arch/model.json`], { cwd: resolved.root });
  const flows = await show('flows.json');
  return { ok: true, ref, json: json.stdout, layout: layout.code === 0 ? layout.stdout : null, shared: shared.code === 0 ? shared.stdout : null, flows: flows.code === 0 ? flows.stdout : null };
}

/** `publish` with the repository root resolved from the user's directory. */
export async function gitPublish(
  runner: CommandRunner,
  options: { dir: string; title: string; body?: string; branch?: string; base?: string; draft?: boolean },
): Promise<GitPublishReply> {
  const resolved = await resolveRoot(options.dir);
  if ('error' in resolved) return { ok: false, error: resolved.error };
  const result = await publish({
    runner,
    cwd: resolved.root,
    title: options.title,
    body: options.body,
    branch: options.branch,
    base: options.base,
    draft: options.draft,
  });
  return result.ok ? { ok: true, url: result.url, branch: result.branch } : result;
}

/** Read-only PR summary (state, review, checks). */
export async function gitPrStatus(runner: CommandRunner, dir: string, pr?: string): Promise<GitPrReply> {
  const resolved = await resolveRoot(dir);
  if ('error' in resolved) return { ok: false, error: resolved.error };
  return prStatus(runner, resolved.root, pr);
}
