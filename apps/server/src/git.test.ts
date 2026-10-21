import { withAccessPlan } from '@strukt/workspace/access-context';
import { BETA_PLAN } from '@strukt/workspace';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fakeRunner } from '@strukt/git/testing';
import { newWorkspace, workspaceFiles } from '@strukt/workspace';
import type { CommandRunner } from '@strukt/git';
import { afterEach, describe, expect, it } from 'vitest';
import { gitChanges, gitDiagramAtRef, gitDiff, gitHealth, gitPrStatus, gitPublish, gitStatus, initializeRepoWorkspace, withGithubToken } from './git';
import type { FakeCall } from '@strukt/git/testing';

const dirs: string[] = [];

it('refuses a 21-diagram browser import before creating any repository workspace files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'joinlet-beta-import-'));
  dirs.push(root);
  const data = newWorkspace('Beta');
  data.manifest.diagrams = Array.from({ length: 21 }, (_, i) => ({ slug: `d-${i}`, title: `D ${i}` }));
  expect(await withAccessPlan(BETA_PLAN, () => initializeRepoWorkspace(root, workspaceFiles(data)))).toMatchObject({ ok: false, code: 'DIAGRAM_LIMIT_REACHED' });
  expect(await stat(join(root, '.arch')).catch(() => null)).toBeNull();
});

async function tempRepo(diagram: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'strukt-server-git-'));
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

const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
const nodeJson = (...ids: string[]) => `${JSON.stringify({ version: 1, nodes: ids.map((id) => ({ id })), connections: [] }, null, 2)}\n`;

describe('withGithubToken', () => {
  it('passes OAuth to gh and the per-command git credential helper without changing global config', async () => {
    let received: Parameters<CommandRunner>[2] | undefined;
    const runner: CommandRunner = async (_cmd, _args, options) => {
      received = options;
      return ok();
    };
    await withGithubToken(runner, 'oauth-token')('git', ['push'], { cwd: '/repo' });
    expect(received).toMatchObject({
      cwd: '/repo',
      env: {
        GH_TOKEN: 'oauth-token',
        GITHUB_TOKEN: 'oauth-token',
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_COUNT: '3',
        GIT_CONFIG_VALUE_2: '!gh auth git-credential',
      },
    });
  });
});

const statusRunner = () =>
  fakeRunner({
    responses: [
      { when: (cmd, args) => cmd === 'git' && args[0] === 'rev-parse', result: ok('true\n') },
      { when: (cmd, args) => cmd === 'git' && args[0] === 'branch', result: ok('feat/arch\n') },
      { when: (cmd, args) => cmd === 'gh' && args[0] === 'auth', result: ok('ok') },
      { when: (cmd, args) => cmd === 'gh' && args[0] === 'repo', result: ok('x/y\nmain\n') },
      { when: (cmd, args) => cmd === 'git' && args[0] === 'status', result: ok(' M .arch/diagrams/a.strukt.json\n?? .arch/docs/novo.md\n') },
    ],
  });

describe('gitStatus', () => {
  it('resolves the repo and lists the .arch/ changes', async () => {
    const dir = await tempRepo(nodeJson('API'));
    const result = await gitStatus(statusRunner(), dir);
    expect(result).toMatchObject({
      ok: true,
      repo: { branch: 'feat/arch', nameWithOwner: 'x/y', defaultBase: 'main', ghReady: true },
      changes: [
        { status: 'M', path: '.arch/diagrams/a.strukt.json' },
        { status: '??', path: '.arch/docs/novo.md' },
      ],
    });
  });

  it('refuses relative paths, folders without .arch/ and folders that are not a repo', async () => {
    expect(await gitStatus(statusRunner(), 'relativo')).toEqual({ ok: false, error: 'Informe o caminho absoluto da pasta do repositório.' });
    expect(await gitStatus(statusRunner(), await mkdtemp(join(tmpdir(), 'vazio-')))).toEqual({
      ok: false,
      error: 'A pasta não tem um workspace do Joinlet (.arch/strukt.json).',
    });
    const dir = await tempRepo(nodeJson('API'));
    const runner = fakeRunner({ responses: [{ when: (cmd, args) => cmd === 'git' && args[0] === 'rev-parse', result: { code: 128, stdout: '', stderr: 'not a repo' } }] });
    expect(await gitStatus(runner, dir)).toEqual({ ok: false, error: 'A pasta não é um repositório git.' });
  });
});

describe('gitChanges (light badge poll)', () => {
  const changesRunner = (calls: FakeCall[]) =>
    fakeRunner({
      calls,
      responses: [{ when: (cmd, args) => cmd === 'git' && args[0] === 'status', result: ok(' M .arch/diagrams/a.strukt.json\n') }],
    });

  it('runs exactly one git command: status --porcelain', async () => {
    const dir = await tempRepo(nodeJson('API'));
    const calls: FakeCall[] = [];
    const result = await gitChanges(changesRunner(calls), dir);
    expect(result).toEqual({ ok: true, changes: [{ status: 'M', path: '.arch/diagrams/a.strukt.json' }] });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ cmd: 'git' });
    expect(calls[0]!.args.slice(0, 2)).toEqual(['status', '--porcelain']);
  });

  it('caches the resolved root between polls and still requires .arch/strukt.json', async () => {
    const dir = await tempRepo(nodeJson('API'));
    const calls: FakeCall[] = [];
    const runner = changesRunner(calls);
    await gitChanges(runner, dir);
    await gitChanges(runner, dir);
    expect(calls).toHaveLength(2);
    await rm(join(dir, '.arch', 'strukt.json'));
    expect(await gitChanges(runner, dir)).toEqual({ ok: false, error: 'A pasta não tem um workspace do Joinlet (.arch/strukt.json).' });
    expect(calls).toHaveLength(2);
    expect(await gitChanges(runner, 'relativo')).toEqual({ ok: false, error: 'Informe o caminho absoluto da pasta do repositório.' });
  });
});

describe('gitStatus gh cache', () => {
  it('reuses gh auth/repo view for the same root and token key for 5 minutes', async () => {
    const dir = await tempRepo(nodeJson('API'));
    const calls: FakeCall[] = [];
    const runner = fakeRunner({
      calls,
      responses: [
        { when: (cmd, args) => cmd === 'git' && args[0] === 'rev-parse', result: ok('true\n') },
        { when: (cmd, args) => cmd === 'git' && args[0] === 'branch', result: ok('main\n') },
        { when: (cmd, args) => cmd === 'gh' && args[0] === 'auth', result: ok('ok') },
        { when: (cmd, args) => cmd === 'gh' && args[0] === 'repo', result: ok('x/y\nmain\n') },
        { when: (cmd, args) => cmd === 'git' && args[0] === 'status', result: ok('') },
      ],
    });
    const cache = new Map();
    const first = await gitStatus(runner, dir, { cache, cacheKey: 't1' });
    const second = await gitStatus(runner, dir, { cache, cacheKey: 't1' });
    expect(second).toEqual(first);
    expect(calls.filter((call) => call.cmd === 'gh')).toHaveLength(2);
    await gitStatus(runner, dir, { cache, cacheKey: 't2' });
    expect(calls.filter((call) => call.cmd === 'gh')).toHaveLength(4);
  });
});

describe('initializeRepoWorkspace', () => {
  it('creates .arch from the browser workspace and refuses to overwrite it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'strukt-server-init-'));
    dirs.push(root);
    const files = workspaceFiles(newWorkspace('Loja'));
    expect(await initializeRepoWorkspace(root, files)).toEqual({ ok: true });
    expect(await readFile(join(root, '.arch', 'strukt.json'), 'utf8')).toBe(files['strukt.json']);
    expect((await initializeRepoWorkspace(root, files)).ok).toBe(false);
  });

  it('carries the comment files of the browser workspace, and only well-named ones', async () => {
    const root = await mkdtemp(join(tmpdir(), 'strukt-server-init-'));
    dirs.push(root);
    const comments = '{"version":1,"threads":[]}\n';
    expect(await initializeRepoWorkspace(root, { ...workspaceFiles(newWorkspace('Loja')), 'comments/diagram-mapa.json': comments })).toEqual({ ok: true });
    expect(await readFile(join(root, '.arch', 'comments', 'diagram-mapa.json'), 'utf8')).toBe(comments);
    const other = await mkdtemp(join(tmpdir(), 'strukt-server-init-'));
    dirs.push(other);
    expect((await initializeRepoWorkspace(other, { ...workspaceFiles(newWorkspace('Loja')), 'comments/notes.json': comments })).ok).toBe(false);
  });

  it('rejects paths outside the workspace before writing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'strukt-server-init-'));
    dirs.push(root);
    const files = { ...workspaceFiles(newWorkspace('Loja')), '../outside.txt': 'não' };
    expect((await initializeRepoWorkspace(root, files)).ok).toBe(false);
    expect(await stat(join(root, '.arch')).catch(() => null)).toBeNull();
  });
});

describe('gitDiff', () => {
  it('returns the semantic markdown against the default branch', async () => {
    const dir = await tempRepo(nodeJson('API', 'Cache'));
    await writeFile(join(dir, '.arch', 'evidence.json'), JSON.stringify({ a: { API: [{ path: 'src/missing.ts' }] } }));
    const runner = fakeRunner({
      files: { main: { 'strukt.json': '{"version":1,"name":"Loja","diagrams":[{"slug":"a","title":"A"}],"docs":[],"sketches":[]}\n', 'diagrams/a.strukt.json': nodeJson('API') } },
      responses: [
        { when: (cmd, args) => cmd === 'git' && args[0] === 'rev-parse', result: ok('true\n') },
        { when: (cmd, args) => cmd === 'git' && args[0] === 'branch', result: ok('main\n') },
        { when: (cmd, args) => cmd === 'gh' && args[0] === 'auth', result: ok('ok') },
        { when: (cmd, args) => cmd === 'gh' && args[0] === 'repo', result: ok('x/y\nmain\n') },
        { when: (cmd, args) => cmd === 'git' && args[0] === 'status', result: ok(' M .arch/diagrams/a.strukt.json\n') },
      ],
    });
    const result = await gitDiff(runner, dir);
    expect(result.ok && result.markdown).toContain('- Adicionados: `Cache`');
    expect(result.ok && result.markdown).toContain('### Evidências quebradas');
  });
});

describe('gitDiagramAtRef', () => {
  it('reads one diagram and its layout without touching the worktree', async () => {
    const dir = await tempRepo(nodeJson('API'));
    const calls: { cmd: string; args: readonly string[] }[] = [];
    const runner = fakeRunner({ calls, responses: [
      { when: (_cmd, args) => args[0] === 'show' && String(args[1]).endsWith('.strukt.json'), result: ok(nodeJson('API')) },
      { when: (_cmd, args) => args[0] === 'show' && String(args[1]).endsWith('.layout.json'), result: ok('{"version":1,"nodes":{}}\n') },
    ] });
    expect(await gitDiagramAtRef(runner, dir, 'origin/main', 'a')).toMatchObject({ ok: true, ref: 'origin/main', json: nodeJson('API') });
    expect(calls.map((call) => call.args[0])).toEqual(['show', 'show', 'show', 'show']);
  });

  it('rejects unsafe refs and missing diagrams', async () => {
    const dir = await tempRepo(nodeJson('API'));
    const runner = fakeRunner({ responses: [] });
    expect(await gitDiagramAtRef(runner, dir, '../HEAD', 'a')).toMatchObject({ ok: false });
    expect(await gitDiagramAtRef(runner, dir, 'main', '../a')).toMatchObject({ ok: false });
    expect(await gitDiagramAtRef(runner, dir, 'main', 'a')).toMatchObject({ ok: false, error: expect.stringContaining('não encontrado') });
  });
});

describe('gitHealth', () => {
  it('reports broken code references and unresolved concerns', async () => {
    const dir = await tempRepo(nodeJson('API'));
    await writeFile(join(dir, '.arch', 'evidence.json'), JSON.stringify({ a: { API: [{ path: 'src/missing.ts' }] } }));
    await writeFile(join(dir, '.arch', 'concerns.json'), JSON.stringify([{ id: 'c1', diagram: 'a', element: 'API', message: 'Falta o cache.', status: 'open', createdAt: '2026-09-24T00:00:00Z' }]));
    const result = await gitHealth(dir);
    expect(result).toMatchObject({ ok: true, evidence: [{ diagram: 'a', id: 'API', path: 'src/missing.ts' }], concerns: [{ id: 'c1' }] });
  });
});

describe('gitPublish and gitPrStatus', () => {
  it('publishes from the resolved repository root', async () => {
    const dir = await tempRepo(nodeJson('API', 'Cache'));
    const runner = fakeRunner({
      files: { main: { 'strukt.json': '{"version":1,"name":"Loja","diagrams":[],"docs":[],"sketches":[]}\n' } },
      responses: [
        { when: (cmd, args) => cmd === 'git' && args[0] === 'rev-parse' && args.includes('--is-inside-work-tree'), result: ok('true\n') },
        { when: (cmd, args) => cmd === 'git' && args[0] === 'rev-parse', result: { code: 128, stdout: '', stderr: 'not found' } },
        { when: (cmd, args) => cmd === 'git' && args[0] === 'status', result: ok(' M .arch/diagrams/a.strukt.json\n') },
        { when: (cmd, args) => cmd === 'gh' && args[0] === 'auth', result: ok('ok') },
        { when: (cmd, args) => cmd === 'gh' && args[0] === 'repo', result: ok('main\n') },
        { when: (cmd, args) => cmd === 'gh' && args[0] === 'pr', result: ok('https://github.com/x/y/pull/3\n') },
        { when: () => true, result: ok() },
      ],
    });
    expect(await gitPublish(runner, { dir, title: 'Cache', body: 'x' })).toEqual({ ok: true, url: 'https://github.com/x/y/pull/3', branch: expect.stringContaining('strukt/cache-') });
  });

  it('reports the PR status', async () => {
    const dir = await tempRepo(nodeJson('API'));
    const runner = fakeRunner({
      responses: [
        { when: (cmd, args) => cmd === 'gh' && args[0] === 'pr', result: ok(JSON.stringify({ url: 'https://github.com/x/y/pull/3', state: 'OPEN', isDraft: false, reviewDecision: null, mergeable: 'MERGEABLE' })) },
      ],
    });
    const result = await gitPrStatus(runner, dir, '3');
    expect(result.ok && result.text).toContain('review: pendente');
  });
});
