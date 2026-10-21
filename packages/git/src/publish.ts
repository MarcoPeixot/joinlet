import { anyChange, diffRefs, diffWorktree, renderDiffMarkdown } from './diff';
import type { CommandRunner } from './run';

export interface PublishOptions {
  runner: CommandRunner;
  /** Repository working directory (the workspace root, not `.arch/`). */
  cwd: string;
  title: string;
  body?: string;
  branch?: string;
  base?: string;
  draft?: boolean;
}

export type PublishResult = { ok: true; url: string; branch: string } | { ok: false; error: string };

const slugify = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'mudanca';

/** `20260923-190000`, stable enough for a branch name and unique per minute. */
const stamp = (now: Date) => now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

export const PR_MARKER = '<!-- strukt:pr -->';
export const DIFF_MARKER = '<!-- strukt:diff -->';
export const AGENT_CONFIG_PATHS = ['.mcp.json', '.cursor/mcp.json', '.vscode/mcp.json', '.codex/config.toml', 'AGENTS.md'] as const;

/**
 * Publishes `.arch/` and project agent setup as a branch + commit + PR: only these paths are staged,
 * nothing is ever forced, and the semantic diff goes in the PR body. On failure the branch may already
 * exist locally or remotely; the error says exactly where it stopped.
 */
export async function publish(options: PublishOptions): Promise<PublishResult> {
  const { runner, cwd, title } = options;
  const git = (args: readonly string[]) => runner('git', args, { cwd });
  const gh = (args: readonly string[]) => runner('gh', args, { cwd });

  const inside = await git(['rev-parse', '--is-inside-work-tree']);
  if (inside.code !== 0) return { ok: false, error: 'Não é um repositório git; rode "git init" ou abra o repositório do projeto.' };
  const auth = await gh(['auth', 'status']);
  if (auth.code !== 0) {
    return { ok: false, error: 'O gh não está disponível ou autenticado. Instale (https://cli.github.com) e rode "gh auth login".' };
  }
  const status = await git(['status', '--porcelain', '--', '.arch', ...AGENT_CONFIG_PATHS]);
  if (status.code !== 0) return { ok: false, error: `git status falhou: ${status.stderr.trim()}` };
  if (!status.stdout.trim()) return { ok: false, error: 'Nada para publicar: .arch/ e configurações MCP não têm mudanças.' };
  const configChanges = AGENT_CONFIG_PATHS.filter((path) => status.stdout.split('\n').some((line) => line.slice(3) === path));
  const paths = ['.arch', ...configChanges];

  const repo = await gh(['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name']);
  if (repo.code !== 0 || !repo.stdout.trim()) {
    return { ok: false, error: `Não foi possível descobrir a branch padrão (gh repo view): ${repo.stderr.trim() || 'repositório sem remoto?'}` };
  }
  const base = options.base ?? repo.stdout.trim();
  const branch = options.branch ?? `strukt/${slugify(title)}-${stamp(new Date())}`;
  const exists = await git(['rev-parse', '--verify', `refs/heads/${branch}`]);
  if (exists.code === 0) return { ok: false, error: `A branch "${branch}" já existe; escolha outro nome.` };

  const diff = await diffWorktree(runner, cwd, base);
  const diffSection = diff.ok
    ? `### Mudanças de arquitetura\n\n${renderDiffMarkdown(diff.result)}`
    : `> Diff semântico indisponível: ${diff.error}`;
  const body = [options.body?.trim(), diffSection].filter(Boolean).join('\n\n');

  const switched = await git(['switch', '-c', branch]);
  if (switched.code !== 0) return { ok: false, error: `git switch falhou: ${switched.stderr.trim()}` };
  const added = await git(['add', '--', ...paths]);
  if (added.code !== 0) return { ok: false, error: `git add falhou: ${added.stderr.trim()}` };
  const committed = await git(['commit', '--only', '-m', `docs(arch): ${title}`, '-m', body, '--', ...paths]);
  if (committed.code !== 0) return { ok: false, error: `git commit falhou: ${committed.stderr.trim()}` };
  const pushed = await git(['push', '-u', 'origin', branch]);
  if (pushed.code !== 0) return { ok: false, error: `git push falhou: ${pushed.stderr.trim()}` };

  const args = ['pr', 'create', '--base', base, '--head', branch, '--title', title, '--body', `${body}\n\n${PR_MARKER}`];
  if (options.draft) args.push('--draft');
  const pr = await gh(args);
  if (pr.code !== 0) return { ok: false, error: `gh pr create falhou (a branch "${branch}" já foi enviada): ${pr.stderr.trim()}` };
  const url = pr.stdout.trim().split('\n').filter(Boolean).at(-1) ?? '';
  return { ok: true, url, branch };
}

export interface PrCommentOptions {
  runner: CommandRunner;
  cwd: string;
  base: string;
  head: string;
  /** PR number; defaults to the PR of the current branch. */
  pr?: string;
  /** Link to the CI run that holds the `strukt-diff` artifact (visual SVG diff); supplied explicitly by the workflow. */
  artifactUrl?: string;
}

/** Plain https links only (no query, fragment, spaces or markdown/HTML metacharacters): the URL goes into a comment body. */
const ARTIFACT_URL = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~%/-]*)?$/;

export type PrCommentResult = { ok: true; action: 'created' | 'updated'; url: string } | { ok: false; error: string };

/** Posts (or updates) the semantic diff comment on a PR; idempotent through `DIFF_MARKER`. */
export async function prComment(options: PrCommentOptions): Promise<PrCommentResult> {
  const { runner, cwd } = options;
  if (options.artifactUrl !== undefined && !ARTIFACT_URL.test(options.artifactUrl)) {
    return { ok: false, error: '--artifact-url precisa ser um link https simples (sem parâmetros, espaços ou caracteres especiais).' };
  }
  const gh = (args: readonly string[]) => runner('gh', args, { cwd });
  const repo = await gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  if (repo.code !== 0 || !repo.stdout.trim()) return { ok: false, error: `Não foi possível descobrir o repositório (gh repo view): ${repo.stderr.trim()}` };
  const nameWithOwner = repo.stdout.trim();

  let pr = options.pr;
  if (!pr) {
    const view = await gh(['pr', 'view', '--json', 'number', '--jq', '.number']);
    if (view.code !== 0 || !view.stdout.trim()) return { ok: false, error: `Não foi possível descobrir o PR desta branch: ${view.stderr.trim()}` };
    pr = view.stdout.trim();
  }
  const diff = await diffRefs(runner, cwd, options.base, options.head);
  if (!diff.ok) return { ok: false, error: diff.error };
  const visual = options.artifactUrl && diff.result.diagrams.some((d) => anyChange(d.changes))
    ? `\n\nDiff visual: veja o artefato \`strukt-diff\` desta execução ([abrir execução](${options.artifactUrl})).`
    : '';
  const body = `${renderDiffMarkdown(diff.result)}${visual}\n\n${DIFF_MARKER}`;
  const url = `https://github.com/${nameWithOwner}/pull/${pr}`;

  const existing = await gh(['api', `repos/${nameWithOwner}/issues/${pr}/comments`, '--paginate', '--jq', `.[] | select(.body | contains("${DIFF_MARKER}")) | .id`]);
  const id = existing.stdout.trim().split('\n').filter(Boolean)[0];
  if (id) {
    const updated = await gh(['api', '-X', 'PATCH', `repos/${nameWithOwner}/issues/comments/${id}`, '-f', `body=${body}`]);
    if (updated.code !== 0) return { ok: false, error: `Não foi possível atualizar o comentário: ${updated.stderr.trim()}` };
    return { ok: true, action: 'updated', url };
  }
  const created = await gh(['api', `repos/${nameWithOwner}/issues/${pr}/comments`, '-f', `body=${body}`]);
  if (created.code !== 0) return { ok: false, error: `Não foi possível comentar no PR: ${created.stderr.trim()}` };
  return { ok: true, action: 'created', url };
}

export type PrStatusResult = { ok: true; text: string } | { ok: false; error: string };

/** Read-only summary of a PR: state, review decision, mergeability and checks. */
export async function prStatus(runner: CommandRunner, cwd: string, pr?: string): Promise<PrStatusResult> {
  const args = ['pr', 'view', ...(pr ? [pr] : []), '--json', 'url,state,isDraft,reviewDecision,mergeable,statusCheckRollup'];
  const res = await runner('gh', args, { cwd });
  if (res.code !== 0) return { ok: false, error: `gh pr view falhou: ${res.stderr.trim()}` };
  let data: {
    url: string;
    state: string;
    isDraft: boolean;
    reviewDecision: string | null;
    mergeable: string;
    statusCheckRollup?: { conclusion?: string; status?: string; name?: string; context?: string }[];
  };
  try {
    data = JSON.parse(res.stdout);
  } catch {
    return { ok: false, error: 'Resposta inesperada do gh pr view.' };
  }
  const checks = (data.statusCheckRollup ?? []).map((check) => `${check.name ?? check.context ?? 'check'}: ${check.conclusion ?? check.status ?? '?'}`);
  return {
    ok: true,
    text: [
      `PR ${data.url}`,
      `estado: ${data.state}${data.isDraft ? ' (rascunho)' : ''}`,
      `review: ${data.reviewDecision ?? 'pendente'}`,
      `merge: ${data.mergeable}`,
      ...(checks.length ? ['checks:', ...checks.map((check) => `  ${check}`)] : ['checks: (nenhum)']),
    ].join('\n'),
  };
}
