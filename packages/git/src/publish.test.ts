import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prComment, publish } from './publish';
import { fakeRunner, when } from './testing';

const dirs: string[] = [];
async function tempWorkspace(diagram: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'strukt-git-'));
  dirs.push(root);
  const files: Record<string, string> = {
    'strukt.json': `${JSON.stringify({ version: 1, name: 'Loja', diagrams: [{ slug: 'a', title: 'A' }], docs: [], sketches: [] }, null, 2)}\n`,
    'diagrams/a.strukt.json': diagram,
  };
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, '.arch', path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, text, 'utf8');
  }
  return root;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const nodeJson = (...ids: string[]) => `${JSON.stringify({ version: 1, nodes: ids.map((id) => ({ id })), connections: [] }, null, 2)}\n`;

/** A ref's `.arch/` tree: manifest + one diagram. */
const treeOf = (diagram: string) => ({
  'strukt.json': `${JSON.stringify({ version: 1, name: 'Loja', diagrams: [{ slug: 'a', title: 'A' }], docs: [], sketches: [] }, null, 2)}\n`,
  'diagrams/a.strukt.json': diagram,
});

/** The scripted happy path of `publish` (no branch given: it is generated). */
function happyResponses(diffTree: Record<string, string>) {
  return {
    files: { main: diffTree },
    responses: [
      { when: (cmd: string, args: readonly string[]) => cmd === 'git' && args[0] === 'rev-parse' && args.includes('--is-inside-work-tree'), result: { code: 0, stdout: 'true\n', stderr: '' } },
      { when: when('git', 'rev-parse'), result: { code: 128, stdout: '', stderr: 'not found' } },
      { when: when('gh', 'auth'), result: { code: 0, stdout: 'ok', stderr: '' } },
      { when: when('git', 'status'), result: { code: 0, stdout: ' M .arch/diagrams/a.strukt.json\n', stderr: '' } },
      { when: when('gh', 'repo'), result: { code: 0, stdout: 'main\n', stderr: '' } },
      { when: when('git', 'switch'), result: { code: 0, stdout: '', stderr: '' } },
      { when: when('git', 'add'), result: { code: 0, stdout: '', stderr: '' } },
      { when: when('git', 'commit'), result: { code: 0, stdout: '', stderr: '' } },
      { when: when('git', 'push'), result: { code: 0, stdout: '', stderr: '' } },
      { when: when('gh', 'pr'), result: { code: 0, stdout: 'https://github.com/x/y/pull/1\n', stderr: '' } },
    ],
  };
}

describe('publish', () => {
  it('creates a branch, commits only .arch/ and opens a PR with the semantic diff', async () => {
    const cwd = await tempWorkspace(nodeJson('API', 'DB', 'Cache'));
    const calls: { cmd: string; args: readonly string[] }[] = [];
    const { responses, files } = happyResponses(treeOf(nodeJson('API', 'DB')));
    const runner = fakeRunner({ responses, files, calls });
    const result = await publish({ runner, cwd, title: 'Adiciona cache', body: 'Cache para leitura.', branch: 'strukt/cache' });
    expect(result).toMatchObject({ ok: true, branch: 'strukt/cache', url: 'https://github.com/x/y/pull/1' });

    expect(calls.map((call) => `${call.cmd} ${call.args[0]}`)).toEqual([
      'git rev-parse', 'gh auth', 'git status', 'gh repo', 'git rev-parse', 'git ls-tree', 'git show', 'git show',
      'git switch', 'git add', 'git commit', 'git push', 'gh pr',
    ]);
    expect(calls.find((call) => call.args[0] === 'switch')!.args).toEqual(['switch', '-c', 'strukt/cache']);
    expect(calls.find((call) => call.args[0] === 'add')!.args).toEqual(['add', '--', '.arch']);
    const commit = calls.find((call) => call.args[0] === 'commit')!;
    expect(commit.args).toContain('docs(arch): Adiciona cache');
    const pr = calls.find((call) => call.args[0] === 'pr')!;
    expect(pr.args).toContain('--base');
    expect(pr.args).toContain('main');
    expect(pr.args.join(' ')).toContain('Cache para leitura.');
    expect(pr.args.join(' ')).toContain('- Adicionados: `Cache`');
    expect(pr.args.join(' ')).toContain('<!-- strukt:pr -->');
  });

  it('includes generated agent configuration in the PR while excluding other staged files', async () => {
    const cwd = await tempWorkspace(nodeJson('API', 'DB'));
    const calls: { cmd: string; args: readonly string[] }[] = [];
    const { responses, files } = happyResponses(treeOf(nodeJson('API')));
    const status = responses.find((entry) => entry.when('git', ['status']));
    if (!status) throw new Error('missing fake status');
    status.result.stdout = ' M .arch/diagrams/a.strukt.json\n?? .mcp.json\n';
    const result = await publish({ runner: fakeRunner({ responses, files, calls }), cwd, title: 'Configura agentes', branch: 'strukt/agentes' });
    expect(result.ok).toBe(true);
    expect(calls.find((call) => call.args[0] === 'add')?.args).toEqual(['add', '--', '.arch', '.mcp.json']);
    expect(calls.find((call) => call.args[0] === 'commit')?.args).toContain('--only');
    expect(calls.find((call) => call.args[0] === 'commit')?.args).not.toContain('other-file.txt');
  });

  it('generates a branch name from the title when none is given', async () => {
    const cwd = await tempWorkspace(nodeJson('API'));
    const calls: { cmd: string; args: readonly string[] }[] = [];
    const { responses, files } = happyResponses(treeOf(nodeJson('API')));
    const runner = fakeRunner({ responses, files, calls });
    const result = await publish({ runner, cwd, title: 'Fila de Pedidos' });
    if (!result.ok) throw new Error(result.error);
    expect(result.branch).toMatch(/^strukt\/fila-de-pedidos-\d{8}-\d{6}$/);
  });

  it('refuses to publish without changes and never switches branches', async () => {
    const cwd = await tempWorkspace(nodeJson('API'));
    const calls: { cmd: string; args: readonly string[] }[] = [];
    const runner = fakeRunner({
      calls,
      responses: [
        { when: when('git', 'rev-parse'), result: { code: 0, stdout: 'true\n', stderr: '' } },
        { when: when('gh', 'auth'), result: { code: 0, stdout: 'ok', stderr: '' } },
        { when: when('git', 'status'), result: { code: 0, stdout: '', stderr: '' } },
      ],
    });
    expect(await publish({ runner, cwd, title: 'x' })).toEqual({ ok: false, error: 'Nada para publicar: .arch/ e configurações MCP não têm mudanças.' });
    expect(calls.some((call) => call.args[0] === 'switch')).toBe(false);
  });

  it('explains when gh is missing or not authenticated', async () => {
    const cwd = await tempWorkspace(nodeJson('API'));
    const runner = fakeRunner({
      responses: [
        { when: when('git', 'rev-parse'), result: { code: 0, stdout: 'true\n', stderr: '' } },
        { when: when('gh', 'auth'), result: { code: 1, stdout: '', stderr: 'not logged in' } },
      ],
    });
    expect(await publish({ runner, cwd, title: 'x' })).toEqual({
      ok: false,
      error: 'O gh não está disponível ou autenticado. Instale (https://cli.github.com) e rode "gh auth login".',
    });
  });

  it('refuses an existing branch', async () => {
    const cwd = await tempWorkspace(nodeJson('API', 'Cache'));
    const runner = fakeRunner({
      responses: [
        { when: when('git', 'rev-parse'), result: { code: 0, stdout: 'true\n', stderr: '' } },
        { when: when('gh', 'auth'), result: { code: 0, stdout: 'ok', stderr: '' } },
        { when: when('git', 'status'), result: { code: 0, stdout: ' M .arch/diagrams/a.strukt.json\n', stderr: '' } },
        { when: when('gh', 'repo'), result: { code: 0, stdout: 'main\n', stderr: '' } },
      ],
    });
    expect(await publish({ runner, cwd, title: 'x', branch: 'strukt/x' })).toEqual({ ok: false, error: 'A branch "strukt/x" já existe; escolha outro nome.' });
  });
});

describe('prComment', () => {
  const options = { base: 'main', head: 'feature', pr: '7' };

  it('creates the comment when there is none and includes the marker', async () => {
    const cwd = await tempWorkspace(nodeJson('API'));
    const calls: { cmd: string; args: readonly string[] }[] = [];
    const runner = fakeRunner({
      calls,
      files: { main: treeOf(nodeJson('API')), feature: treeOf(nodeJson('API', 'Cache')) },
      responses: [
        { when: when('gh', 'repo'), result: { code: 0, stdout: 'x/y\n', stderr: '' } },
        { when: when('gh', 'api'), result: { code: 0, stdout: '\n', stderr: '' } },
      ],
    });
    expect(await prComment({ runner, cwd, ...options })).toEqual({ ok: true, action: 'created', url: 'https://github.com/x/y/pull/7' });
    const post = calls.filter((call) => call.args[0] === 'api').at(-1)!;
    expect(post.args.join(' ')).toContain('repos/x/y/issues/7/comments');
    expect(post.args.join(' ')).toContain('<!-- strukt:diff -->');
    expect(post.args.join(' ')).toContain('Adicionados: `Cache`');
  });

  it('updates the existing comment (idempotent)', async () => {
    const cwd = await tempWorkspace(nodeJson('API'));
    const calls: { cmd: string; args: readonly string[] }[] = [];
    const runner = fakeRunner({
      calls,
      files: { main: treeOf(nodeJson('API')), feature: treeOf(nodeJson('API', 'Cache')) },
      responses: [
        { when: when('gh', 'repo'), result: { code: 0, stdout: 'x/y\n', stderr: '' } },
        { when: (cmd: string, args: readonly string[]) => cmd === 'gh' && args[0] === 'api' && args.includes('--paginate'), result: { code: 0, stdout: '123\n', stderr: '' } },
        { when: when('gh', 'api'), result: { code: 0, stdout: '', stderr: '' } },
      ],
    });
    expect(await prComment({ runner, cwd, ...options })).toEqual({ ok: true, action: 'updated', url: 'https://github.com/x/y/pull/7' });
    const patch = calls.filter((call) => call.args[0] === 'api').at(-1)!;
    expect(patch.args).toContain('-X');
    expect(patch.args).toContain('repos/x/y/issues/comments/123');
  });

  it('reports a missing ref', async () => {
    const cwd = await tempWorkspace(nodeJson('API'));
    const runner = fakeRunner({
      files: { feature: treeOf(nodeJson('API')) },
      responses: [{ when: when('gh', 'repo'), result: { code: 0, stdout: 'x/y\n', stderr: '' } }],
    });
    expect(await prComment({ runner, cwd, ...options })).toEqual({
      ok: false,
      error: 'Não foi possível ler .arch/ em "main" (ref inexistente ou sem workspace).',
    });
  });

  describe('artifact note', () => {
    const artifactUrl = 'https://github.com/x/y/actions/runs/99';
    const run = async (extra: object, files = { main: treeOf(nodeJson('API')), feature: treeOf(nodeJson('API', 'Cache')) }) => {
      const cwd = await tempWorkspace(nodeJson('API'));
      const calls: { cmd: string; args: readonly string[] }[] = [];
      const runner = fakeRunner({
        calls,
        files,
        responses: [
          { when: when('gh', 'repo'), result: { code: 0, stdout: 'x/y\n', stderr: '' } },
          { when: when('gh', 'api'), result: { code: 0, stdout: '\n', stderr: '' } },
        ],
      });
      const result = await prComment({ runner, cwd, ...options, ...extra });
      return { result, post: calls.filter((call) => call.args[0] === 'api').at(-1)?.args.join(' ') ?? '' };
    };

    it('mentions the strukt-diff artifact with the run link and keeps the marker', async () => {
      const { result, post } = await run({ artifactUrl });
      expect(result.ok).toBe(true);
      expect(post).toContain('Diff visual: veja o artefato `strukt-diff` desta execução');
      expect(post).toContain(`(${artifactUrl})`);
      expect(post.endsWith('<!-- strukt:diff -->')).toBe(true);
    });

    it('has no artifact note without --artifact-url', async () => {
      expect((await run({})).post).not.toContain('Diff visual');
    });

    it('has no artifact note when nothing changed in the diagrams', async () => {
      const same = { main: treeOf(nodeJson('API')), feature: treeOf(nodeJson('API')) };
      expect((await run({ artifactUrl }, same)).post).not.toContain('Diff visual');
    });

    it('refuses URLs that are not plain https links (markdown injection)', async () => {
      for (const bad of ['javascript:alert(1)', 'http://x.y/a', 'https://x.y/a) [click](https://evil', 'https://x.y/a b', 'not a url', 'https://x.y/<img>']) {
        const { result } = await run({ artifactUrl: bad });
        expect(result).toEqual({ ok: false, error: expect.stringContaining('--artifact-url') });
      }
    });
  });
});
