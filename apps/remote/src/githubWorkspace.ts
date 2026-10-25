import { withKnowledgeHarness } from '@strukt/workspace';
import { refreshGeneratedContext } from '@strukt/workspace/context-storage';
import { assertBetaManifest, MANIFEST_PATH } from '@strukt/workspace';
import { randomBytes } from 'node:crypto';
import type { StorageAdapter } from '@strukt/workspace';
import { AGENT_INSTRUCTION_FILES, agentInstructionText } from '@strukt/workspace/repository-agents';

const API = 'https://api.github.com';
const HEADERS = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export interface GithubWorkspace extends StorageAdapter {
  readonly repo: string;
  readonly branch: string;
  readonly revision: number;
  readonly commit: string;
  setupAgents(url: string): { changed: string[]; conflicts: string[] };
  syncAgentInstructions(): { changed: string[]; conflicts: string[] };
  flush(): Promise<string | null>;
}

export class GithubHttpError extends Error {
  constructor(readonly status: number, path: string) { super(`GitHub respondeu ${status} em ${path}.`); }
}

export function githubApi(token: string, fetcher: typeof fetch = fetch) {
  return async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetcher(`${API}${path}`, {
      ...init,
      headers: { ...HEADERS, authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    });
    if (!response.ok) throw new GithubHttpError(response.status, new URL(path, API).pathname);
    return response.json() as Promise<T>;
  };
}

type Ref = { object: { sha: string } };
type Commit = { tree: { sha: string } };
type Tree = { truncated?: boolean; tree: { path: string; type: string; sha: string; size?: number }[] };
type Blob = { content: string; encoding: string };
type Pull = { html_url: string; body: string | null; head: { ref: string; repo: { full_name: string } } };

export const agentBranchPrefix = (userId: number) => userId === 0 ? 'strukt/shared' : `strukt/agent-${userId}`;

export async function openAgentPull(api: ReturnType<typeof githubApi>, repo: string, userId: number, branchPrefix?: string): Promise<Pull | null> {
  const pulls = await api<Pull[]>(`/repos/${repo}/pulls?state=open&per_page=100`);
  const prefix = branchPrefix ?? agentBranchPrefix(userId);
  return pulls.find((pull) => (pull.head.ref === prefix || pull.head.ref.startsWith(`${prefix}-`)) && pull.head.repo?.full_name === repo && pull.body?.includes('<!-- strukt:remote -->')) ?? null;
}

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
const CONFIGS = ['.mcp.json', '.cursor/mcp.json', '.vscode/mcp.json', '.codex/config.toml', ...AGENT_INSTRUCTION_FILES] as const;
const AGENT_TEXT = '\n## Joinlet\n\nA arquitetura deste projeto fica em `.arch/`. Consulte `get_architecture` e `list_diagrams` antes de alterá-la. Use as ferramentas MCP do Joinlet para criar diagramas e documentos e mantenha ambos atualizados com o código.\n';
const isLocalStrukt = (value: unknown) => typeof value === 'object' && value !== null && typeof (value as { url?: unknown }).url === 'string' && /^http:\/\/(localhost|127\.0\.0\.1):8787\/mcp(?:\/|$)/.test((value as { url: string }).url);

/** Snapshot of one GitHub branch. Writes are staged and sent as one non-force commit and PR. */
export async function openGithubWorkspace(options: {
  token: string;
  repo: string;
  userId: number;
  fetch?: typeof fetch;
  baseBranch?: string;
  workBranch?: string;
  beforeCommit?: () => Promise<void>;
}): Promise<GithubWorkspace> {
  const { repo, token, userId } = options;
  if (!REPO.test(repo) || repo.includes('..')) throw new Error('Repositório GitHub inválido.');
  const api = githubApi(token, options.fetch);
  const base = `/repos/${repo}`;
  const info = await api<{ default_branch: string; permissions?: { push?: boolean } }>(base);
  if (!info.permissions?.push) throw new Error('A conta não tem permissão de escrita neste repositório.');
  const openPull = await openAgentPull(api, repo, userId, options.workBranch);
  let legacyBranch: string | null = null;
  if (userId === 0 && !openPull && !options.workBranch) {
    const pulls = await api<Pull[]>(`${base}/pulls?state=open&per_page=100`);
    const legacy = pulls.filter((pull) => /^strukt\/agent-\d+(?:-[a-f0-9]+)?$/.test(pull.head.ref) && pull.head.repo?.full_name === repo && pull.body?.includes('<!-- strukt:remote -->'));
    if (legacy.length > 1) throw new Error('Há vários PRs anteriores do Joinlet. Revise-os antes de iniciar a branch compartilhada.');
    legacyBranch = legacy[0]?.head.ref ?? null;
  }
  let branch = openPull?.head.ref ?? options.workBranch ?? agentBranchPrefix(userId);
  const getRef = (name: string) => api<Ref>(`${base}/git/ref/heads/${encodeURIComponent(name)}`);
  let branchExists = true;
  let head: Ref;
  try { head = await getRef(branch); }
  catch (error) {
    if (!(error instanceof GithubHttpError) || error.status !== 404) throw error;
    branchExists = false;
    head = await getRef(legacyBranch ?? options.baseBranch ?? info.default_branch);
  }
  // A commit may have succeeded while creating its PR failed. Reuse that branch
  // on the next request; only rotate a branch that already had a closed/merged PR.
  let recoveringPull = false;
  if (!openPull && branchExists) {
    const previous = await api<Pull[]>(`${base}/pulls?state=all&head=${encodeURIComponent(`${repo.split('/')[0]}:${branch}`)}&per_page=1`);
    recoveringPull = previous.length === 0;
  }
  if (!openPull && branchExists && !recoveringPull) {
    branch = `${options.workBranch ?? agentBranchPrefix(userId)}-${randomBytes(4).toString('hex')}`;
    branchExists = false;
    head = await getRef(legacyBranch ?? options.baseBranch ?? info.default_branch);
  }
  let headSha = head.object.sha;
  let treeSha = (await api<Commit>(`${base}/git/commits/${headSha}`)).tree.sha;
  const rootTree = await api<Tree>(`${base}/git/trees/${treeSha}`);
  if (rootTree.truncated) throw new Error('A raiz do repositório é grande demais para sincronização remota.');
  const entries: Tree['tree'] = rootTree.tree.filter((item) => item.type === 'blob' && CONFIGS.includes(item.path as typeof CONFIGS[number]));
  const archRoot = rootTree.tree.find((item) => item.path === '.arch' && item.type === 'tree');
  if (archRoot) {
    const arch = await api<Tree>(`${base}/git/trees/${archRoot.sha}?recursive=1`);
    if (arch.truncated) throw new Error('O .arch/ é grande demais para sincronização remota.');
    entries.push(...arch.tree.filter((item) => item.type === 'blob').map((item) => ({ ...item, path: `.arch/${item.path}` })));
  }
  for (const folder of ['.cursor', '.vscode', '.codex']) {
    const directory = rootTree.tree.find((item) => item.path === folder && item.type === 'tree');
    if (!directory) continue;
    const nested = await api<Tree>(`${base}/git/trees/${directory.sha}`);
    entries.push(...nested.tree.filter((item) => item.type === 'blob' && CONFIGS.includes(`${folder}/${item.path}` as typeof CONFIGS[number])).map((item) => ({ ...item, path: `${folder}/${item.path}` })));
  }
  if (entries.length > 2_000 || entries.some((item) => (item.size ?? 0) > 2_000_000) || entries.reduce((size, item) => size + (item.size ?? 0), 0) > 20_000_000) {
    throw new Error('O workspace é grande demais para sincronização remota.');
  }
  const archive = new Map<string, string>();
  const files = new Map<string, string>();
  const projectFiles = new Map<string, string>();
  const fetchBlob = async (sha: string, path: string) => {
    const blob = await api<Blob>(`${base}/git/blobs/${sha}`);
    if (blob.encoding !== 'base64') throw new Error(`Formato inesperado em ${path}.`);
    return Buffer.from(blob.content.replace(/\s/g, ''), 'base64').toString('utf8');
  };
  for (const entry of entries) {
    if (entry.path.startsWith('.arch/')) archive.set(entry.path.slice('.arch/'.length), entry.sha);
    else projectFiles.set(entry.path, await fetchBlob(entry.sha, entry.path));
  }
  const dirty = new Map<string, string | null>();
  let pullUrl: string | null = openPull?.html_url ?? null;
  let pullPending = recoveringPull;
  let flushQueue: Promise<string | null> = Promise.resolve(pullUrl);
  const pathOf = (path: string) => {
    if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error('Caminho inválido no .arch/.');
    }
    return path;
  };
  const readArch = async (path: string): Promise<string | null> => {
    pathOf(path);
    if (files.has(path)) return files.get(path)!;
    const sha = archive.get(path);
    if (!sha) return null;
    const text = await fetchBlob(sha, `.arch/${path}`);
    // A slow fetch must not resurrect a removed file or replace a newer staged edit.
    if (files.has(path)) return files.get(path)!;
    if (archive.get(path) !== sha) return null;
    files.set(path, text);
    return text;
  };

  return {
    kind: 'memory',
    label: `GitHub: ${repo}/${branch}`,
    repo,
    branch,
    get commit() { return headSha; },
    get revision() { return Number.parseInt(headSha.slice(0, 12), 16); },
    syncAgentInstructions() {
      const changed:string[]=[],conflicts:string[]=[];
      for(const path of AGENT_INSTRUCTION_FILES){const before=projectFiles.get(path)??null,text=agentInstructionText(before);if(text===null){conflicts.push(path);continue;}if(text!==before){projectFiles.set(path,text);dirty.set(path,text);changed.push(path);}}
      return {changed,conflicts};
    },
    setupAgents(url) {
      const changed: string[] = [];
      const conflicts: string[] = [];
      const replace = (path: string, text: string) => {
        if (projectFiles.get(path) === text) return;
        projectFiles.set(path, text);
        dirty.set(path, text);
        changed.push(path);
      };
      for (const [path, key, entry] of [
        ['.mcp.json', 'mcpServers', { type: 'http', url }],
        ['.cursor/mcp.json', 'mcpServers', { url }],
        ['.vscode/mcp.json', 'servers', { type: 'http', url }],
      ] as const) {
        let parsed: Record<string, unknown>;
        try {
          parsed = projectFiles.has(path) ? JSON.parse(projectFiles.get(path)!) as Record<string, unknown> : {};
          if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('invalid');
        } catch { conflicts.push(path); continue; }
        const servers = parsed[key];
        if (servers !== undefined && (!servers || Array.isArray(servers) || typeof servers !== 'object')) { conflicts.push(path); continue; }
        const values = (servers ?? {}) as Record<string, unknown>;
        const current = values.strukt;
        if (current !== undefined && !isLocalStrukt(current) && JSON.stringify(current) !== JSON.stringify(entry)) { conflicts.push(path); continue; }
        if (JSON.stringify(current) === JSON.stringify(entry)) continue;
        parsed[key] = { ...values, strukt: entry };
        replace(path, `${JSON.stringify(parsed, null, 2)}\n`);
      }
      const codex = '.codex/config.toml';
      const currentCodex = projectFiles.get(codex) ?? '';
      const block = /^\s*\[mcp_servers\.strukt\]([\s\S]*?)(?=^\s*\[|$)/m;
      const existing = currentCodex.match(block);
      if (!existing) replace(codex, `${currentCodex.trimEnd()}\n[mcp_servers.strukt]\nurl = "${url}"\n`);
      else if (!existing[1]?.includes(`url = "${url}"`)) {
        if (/url\s*=\s*"http:\/\/(localhost|127\.0\.0\.1):8787\/mcp(?:\/[^\"]*)?"/.test(existing[1] ?? '')) {
          replace(codex, currentCodex.replace(block, (full) => full.replace(/url\s*=\s*"[^"]*"/, `url = "${url}"`)));
        } else conflicts.push(codex);
      }
      const agents = projectFiles.get('AGENTS.md') ?? '# Instruções para agentes';
      const nextAgents = withKnowledgeHarness(agents.includes('## Joinlet') ? agents : `${agents.trimEnd()}${AGENT_TEXT}`);
      if (nextAgents !== agents) replace('AGENTS.md', nextAgents);
      return { changed, conflicts };
    },
    read: readArch,
    async write(path, text) {
      pathOf(path);
      if (Buffer.byteLength(text, 'utf8') > 2_000_000) throw new Error('Arquivo grande demais para sincronização remota.');
      const before = await readArch(path);
      if (before === text) return;
      if (path === MANIFEST_PATH) assertBetaManifest(before, text);
      files.set(path, text);
      archive.set(path, 'staged');
      dirty.set(`.arch/${path}`, text);
    },
    async remove(path) {
      pathOf(path);
      if (!archive.has(path) && !files.has(path)) return;
      files.delete(path);
      archive.delete(path);
      dirty.set(`.arch/${path}`, null);
    },
    async list() { return [...new Set([...archive.keys(), ...files.keys()])].sort(); },
    flush(this: GithubWorkspace) {
      const run = async () => {
        if (!dirty.size && !pullPending) return pullUrl;
        if (dirty.size) {
          await refreshGeneratedContext(this, dirty.has('AGENTS.md'));
          // Network awaits must not consume mutations staged after this snapshot.
          const batch = new Map(dirty);
          await options.beforeCommit?.();
          if (!branchExists) {
            await api(`${base}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: headSha }) });
            branchExists = true;
          }
          const changes: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[] = [];
          for (const [path, value] of batch) {
            const sha = value === null ? null : (await api<{ sha: string }>(`${base}/git/blobs`, {
              method: 'POST', body: JSON.stringify({ content: b64(value), encoding: 'base64' }),
            })).sha;
            changes.push({ path, mode: '100644', type: 'blob', sha });
          }
          const nextTree = await api<{ sha: string }>(`${base}/git/trees`, {
            method: 'POST', body: JSON.stringify({ base_tree: treeSha, tree: changes }),
          });
          const commit = await api<{ sha: string }>(`${base}/git/commits`, {
            method: 'POST', body: JSON.stringify({ message: 'docs(arch): atualiza arquitetura pelo agente', tree: nextTree.sha, parents: [headSha] }),
          });
          try {
            await api(`${base}/git/refs/heads/${branch}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
          } catch (error) {
            if (!(error instanceof GithubHttpError) || ![409, 422].includes(error.status)) throw error;
            throw new Error('A branch mudou no GitHub durante a escrita. Releia a arquitetura antes de repetir.');
          }
          headSha = commit.sha;
          treeSha = nextTree.sha;
          for (const [path, value] of batch) {
            if (dirty.get(path) === value) dirty.delete(path);
          }
          pullPending = !pullUrl;
        }
        if (pullPending) {
          // The previous POST may have succeeded even when its response was lost.
          const existing = await api<Pull[]>(`${base}/pulls?state=open&head=${encodeURIComponent(`${repo.split('/')[0]}:${branch}`)}&per_page=100`);
          const pull = existing.find(p => p.head.ref === branch && p.head.repo?.full_name === repo) ?? await api<Pull>(`${base}/pulls`, {
            method: 'POST', body: JSON.stringify({ title: 'Atualiza arquitetura no Joinlet', head: branch, base: options.baseBranch ?? info.default_branch, body: 'Mudanças em `.arch/` criadas por um agente via Joinlet MCP.\n\n<!-- strukt:remote -->' }),
          });
          pullUrl = pull.html_url;
          pullPending = false;
        }
        return pullUrl;
      };
      // A failed attempt must not poison later retries.
      flushQueue = flushQueue.then(run, run);
      return flushQueue;
    },
  };
}
