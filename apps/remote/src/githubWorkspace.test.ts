import { addItem, newWorkspace, workspaceFiles } from '@strukt/workspace';
import { describe, expect, it } from 'vitest';
import { openGithubWorkspace } from './githubWorkspace';

const legacyPull = (id: number) => ({
  html_url: `https://github.com/org/repo/pull/${id}`,
  body: '<!-- strukt:remote -->',
  head: { ref: `strukt/agent-${id}`, repo: { full_name: 'org/repo' } },
});

function github(pulls: ReturnType<typeof legacyPull>[]) {
  const requests: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    requests.push(path);
    if (path === '/repos/org/repo') return Response.json({ default_branch: 'main', permissions: { push: true } });
    if (path === '/repos/org/repo/pulls?state=open&per_page=100') return Response.json(pulls);
    if (path.startsWith('/repos/org/repo/pulls?state=open&head=')) return Response.json([]);
    if (path === '/repos/org/repo/git/ref/heads/strukt%2Fshared') return Response.json({}, { status: 404 });
    if (path === '/repos/org/repo/git/ref/heads/strukt%2Fagent-42') return Response.json({ object: { sha: 'abcdef1234567890' } });
    if (path === '/repos/org/repo/git/commits/abcdef1234567890') return Response.json({ tree: { sha: 'tree' } });
    if (path === '/repos/org/repo/git/trees/tree') return Response.json({ tree: [] });
    throw new Error(`Unexpected GitHub request ${path}`);
  };
  return { requests, fetcher: fetcher as typeof fetch };
}

describe('shared remote branch', () => {
  it('commits regenerated context with a remote edit and enables it during agent setup', async () => {
    const api = github([legacyPull(42)]);
    const trees: Array<{ tree: Array<{ path: string }> }> = [];
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (init?.method && init.method !== 'GET') {
        if (path.endsWith('/git/trees')) trees.push(JSON.parse(String(init.body)));
        if (path.endsWith('/pulls')) return Response.json({ html_url: 'https://github.com/org/repo/pull/99' });
        return Response.json({ sha: 'abcdef1234567891' });
      }
      return api.fetcher(input, init);
    };
    const adapter = await openGithubWorkspace({ token: 'test', repo: 'org/repo', userId: 0, fetch: fetcher as typeof fetch });
    const data = addItem(newWorkspace('Remote'), 'diagram', 'API').data;
    for (const [path, text] of Object.entries(workspaceFiles(data))) await adapter.write(path, text);
    adapter.setupAgents('https://joinlet.example/mcp');
    await adapter.flush();
    expect(trees[0]!.tree.map(f => f.path)).toContain('.arch/context/ARCHITECTURE.md');
    await adapter.write('diagrams/api.strukt.json', JSON.stringify({ version: 1, nodes: [{ id: 'Notifications' }], connections: [] }));
    await adapter.flush();
    expect(await adapter.read('context/ARCHITECTURE.md')).toContain('Notifications');
    expect(trees[1]!.tree.map(f => f.path)).toEqual(expect.arrayContaining(['.arch/diagrams/api.strukt.json', '.arch/context/ARCHITECTURE.md', '.arch/context/diagrams/api.md']));
  });

  it('refuses a direct over-limit manifest write without changing the staged workspace', async () => {
    const api = github([legacyPull(42)]);
    const adapter = await openGithubWorkspace({ token: 'test', repo: 'org/repo', userId: 0, fetch: api.fetcher });
    const manifest = (count: number) => JSON.stringify({ version: 1, name: 'Beta', docs: [], sketches: [], diagrams: Array.from({ length: count }, (_, i) => ({ slug: `d-${i}`, title: `D ${i}` })) });
    await adapter.write('strukt.json', manifest(20));
    await expect(adapter.write('strukt.json', manifest(21))).rejects.toMatchObject({ code: 'DIAGRAM_LIMIT_REACHED' });
    expect(await adapter.read('strukt.json')).toBe(manifest(20));
    await adapter.write('docs/notes.md', '# Notes remain available');
    expect(await adapter.read('docs/notes.md')).toContain('Notes remain available');
  });

  it('starts from a single existing Joinlet PR instead of losing its work', async () => {
    const api = github([legacyPull(42)]);
    const adapter = await openGithubWorkspace({ token: 'test', repo: 'org/repo', userId: 0, fetch: api.fetcher });
    expect(adapter.branch).toBe('strukt/shared');
    expect(adapter.revision).toBe(Number.parseInt('abcdef123456', 16));
    expect(api.requests).toContain('/repos/org/repo/git/ref/heads/strukt%2Fagent-42');
  });

  it('refuses to choose between multiple legacy PRs', async () => {
    const api = github([legacyPull(42), legacyPull(43)]);
    await expect(openGithubWorkspace({ token: 'test', repo: 'org/repo', userId: 0, fetch: api.fetcher })).rejects.toThrow('vários PRs');
  });
});

function writableGithub() {
  const readApi = github([legacyPull(42)]);
  const commits: Array<{ parents: string[] }> = [];
  const trees: Array<{ tree: Array<{ path: string; sha: string | null }> }> = [];
  const blobs = new Map<string, string>();
  let pulls = 0;
  let failPull = false;
  let beforeTree: (() => Promise<void>) | undefined;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (!init?.method || init.method === 'GET') return readApi.fetcher(input, init);
    const body = JSON.parse(String(init.body));
    if (path.endsWith('/git/blobs')) {
      const sha = `blob-${blobs.size}`;
      blobs.set(sha, Buffer.from(body.content, 'base64').toString('utf8'));
      return Response.json({ sha });
    }
    if (path.endsWith('/git/trees')) {
      trees.push(body);
      await beforeTree?.();
      return Response.json({ sha: `tree-${trees.length}` });
    }
    if (path.endsWith('/git/commits')) { commits.push(body); return Response.json({ sha: `abcdef12345${commits.length}` }); }
    if (path.endsWith('/pulls')) {
      pulls++;
      if (failPull) { failPull = false; return Response.json({}, { status: 503 }); }
      return Response.json({ html_url: 'https://github.com/org/repo/pull/99' });
    }
    return Response.json({});
  }) as typeof fetch;
  return { fetcher, commits, trees, blobs, get pulls() { return pulls; }, failNextPull() { failPull = true; }, pauseTree(hook: () => Promise<void>) { beforeTree = hook; } };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('remote commit reliability', () => {
  it('retains writes and removals arriving while a commit is in flight', async () => {
    const api = writableGithub();
    const adapter = await openGithubWorkspace({ token: 'test', repo: 'org/repo', userId: 0, fetch: api.fetcher });
    await adapter.write('docs/a.md', 'first');
    await adapter.write('docs/b.md', 'remove me');
    const started = deferred(), release = deferred();
    api.pauseTree(async () => { started.resolve(); await release.promise; });
    const saving = adapter.flush();
    await started.promise;
    await adapter.write('docs/a.md', 'latest');
    await adapter.remove('docs/b.md');
    await adapter.write('docs/c.md', 'new');
    release.resolve();
    await saving;
    await adapter.flush();
    expect(api.trees).toHaveLength(2);
    const tree = api.trees[1]!.tree;
    expect(api.blobs.get(tree.find(f => f.path === '.arch/docs/a.md')!.sha!)).toBe('latest');
    expect(tree.find(f => f.path === '.arch/docs/b.md')!.sha).toBeNull();
    expect(api.blobs.get(tree.find(f => f.path === '.arch/docs/c.md')!.sha!)).toBe('new');
  });

  it('serializes simultaneous flushes onto the latest committed parent', async () => {
    const api = writableGithub();
    const adapter = await openGithubWorkspace({ token: 'test', repo: 'org/repo', userId: 0, fetch: api.fetcher });
    await adapter.write('docs/a.md', 'first');
    const started = deferred(), release = deferred();
    api.pauseTree(async () => { started.resolve(); await release.promise; });
    const first = adapter.flush();
    await started.promise;
    await adapter.write('docs/a.md', 'second');
    const second = adapter.flush();
    release.resolve();
    await Promise.all([first, second]);
    expect(api.commits.map(c => c.parents)).toEqual([['abcdef1234567890'], ['abcdef123451']]);
    expect(api.pulls).toBe(1);
  });

  it('retries PR creation after the commit succeeded without duplicating the commit', async () => {
    const api = writableGithub();
    const adapter = await openGithubWorkspace({ token: 'test', repo: 'org/repo', userId: 0, fetch: api.fetcher });
    await adapter.write('docs/a.md', 'saved');
    api.failNextPull();
    await expect(adapter.flush()).rejects.toMatchObject({ status: 503 });
    await expect(adapter.flush()).resolves.toBe('https://github.com/org/repo/pull/99');
    expect(api.commits).toHaveLength(1);
    expect(api.pulls).toBe(2);
  });
});

it('recovers a committed branch without a PR when a new request opens the workspace', async () => {
  const api = writableGithub();
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    if (path === '/repos/org/repo/pulls?state=open&per_page=100') return Response.json([]);
    if (path === '/repos/org/repo/git/ref/heads/strukt%2Fshared') return Response.json({ object: { sha: 'abcdef1234567890' } });
    if (path.startsWith('/repos/org/repo/pulls?state=all&head=')) return Response.json([]);
    return api.fetcher(input, init);
  }) as typeof fetch;
  const adapter = await openGithubWorkspace({ token: 'test', repo: 'org/repo', userId: 0, fetch: fetcher });
  expect(adapter.branch).toBe('strukt/shared');
  await expect(adapter.flush()).resolves.toBe('https://github.com/org/repo/pull/99');
  expect(api.commits).toHaveLength(0);
});

it('reuses a PR whose successful POST response was lost', async () => {
  const api = writableGithub();
  let created = false;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    if (created && path.startsWith('/repos/org/repo/pulls?state=open&head=')) return Response.json([{ ...legacyPull(99), head: { ref: 'strukt/shared', repo: { full_name: 'org/repo' } } }]);
    if (path === '/repos/org/repo/pulls' && init?.method === 'POST') { created = true; throw new TypeError('network connection lost'); }
    return api.fetcher(input, init);
  }) as typeof fetch;
  const adapter = await openGithubWorkspace({ token: 'test', repo: 'org/repo', userId: 0, fetch: fetcher });
  await adapter.write('docs/a.md', 'saved');
  await expect(adapter.flush()).rejects.toThrow('network connection lost');
  await expect(adapter.flush()).resolves.toBe('https://github.com/org/repo/pull/99');
  expect(api.commits).toHaveLength(1);
});

it.each(['write', 'remove'])('a slow blob read does not undo a newer %s', async mutation => {
  const api = github([legacyPull(42)]);
  const started = deferred(), release = deferred();
  let reads = 0;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/git/trees/tree')) return Response.json({ tree: [{ path: '.arch', type: 'tree', sha: 'arch' }] });
    if (path.endsWith('/git/trees/arch')) return Response.json({ tree: [{ path: 'docs/a.md', type: 'blob', sha: 'old' }] });
    if (path.endsWith('/git/blobs/old')) {
      if (++reads === 1) { started.resolve(); await release.promise; }
      return Response.json({ encoding: 'base64', content: Buffer.from('old').toString('base64') });
    }
    return api.fetcher(input, init);
  }) as typeof fetch;
  const adapter = await openGithubWorkspace({ token: 'test', repo: 'org/repo', userId: 0, fetch: fetcher });
  const pending = adapter.read('docs/a.md');
  await started.promise;
  if (mutation === 'write') await adapter.write('docs/a.md', 'new');
  else await adapter.remove('docs/a.md');
  release.resolve();
  expect(await pending).toBe(mutation === 'write' ? 'new' : null);
  expect(await adapter.read('docs/a.md')).toBe(mutation === 'write' ? 'new' : null);
});

it('does not reopen a branch whose PR was already closed or merged', async () => {
  const api = github([]);
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    if (path === '/repos/org/repo/git/ref/heads/strukt%2Fshared' || path === '/repos/org/repo/git/ref/heads/main') return Response.json({ object: { sha: 'abcdef1234567890' } });
    if (path.startsWith('/repos/org/repo/pulls?state=all&head=')) return Response.json([legacyPull(99)]);
    return api.fetcher(input, init);
  }) as typeof fetch;
  const adapter = await openGithubWorkspace({ token: 'test', repo: 'org/repo', userId: 0, fetch: fetcher });
  expect(adapter.branch).toMatch(/^strukt\/shared-[a-f0-9]+$/);
  await expect(adapter.flush()).resolves.toBeNull();
});
