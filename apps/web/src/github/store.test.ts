import { describe, expect, it, vi } from 'vitest';
import type { GitRepo, GithubReply } from './client';
import { createGithubStore, REPO_KEY } from './store';

const repo: GitRepo = { root: '/repo', archDir: '/repo/.arch', nameWithOwner: 'x/y', branch: 'main', defaultBase: 'main', ghReady: true };
const change = { status: 'M', path: '.arch/diagrams/a.strukt.json' };

function setup(options: { status?: GithubReply<{ repo: GitRepo; changes: typeof change[] }>; path?: string } = {}) {
  const files = new Map<string, string>();
  if (options.path) files.set(REPO_KEY, options.path);
  const client = {
    status: vi.fn(async (): Promise<GithubReply<{ repo: GitRepo; changes: typeof change[] }>> => options.status ?? { kind: 'ok', repo, changes: [change] }),
    changes: vi.fn(async (): Promise<GithubReply<{ changes: typeof change[] }>> => ({ kind: 'ok', changes: [change, { status: '??', path: '.arch/docs/x.md' }] })),
    diff: vi.fn(async (): Promise<GithubReply<{ markdown: string }>> => ({ kind: 'ok', markdown: '## Arquitetura' })),
    publish: vi.fn(async (): Promise<GithubReply<{ url: string; branch: string }>> => ({ kind: 'ok', url: 'https://github.com/x/y/pull/1', branch: 'strukt/fila' })),
    pr: vi.fn(async (): Promise<GithubReply<{ text: string }>> => ({ kind: 'ok', text: 'PR x' })),
  };
  const notify = vi.fn();
  const storage = { get: (key: string) => files.get(key) ?? null, set: (key: string, value: string) => void files.set(key, value) };
  return { store: createGithubStore({ client, notify, storage }), client, notify, files };
}

describe('github store', () => {
  it('drops stale responses and publication fields when the project changes', async () => {
    const { store, client } = setup({ path: '/repo' });
    let resolve!: (value: GithubReply<{ repo: GitRepo; changes: typeof change[] }>) => void;
    client.status.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    store.getState().setTitle('PR de A');
    store.getState().setBody('Descrição de A');
    const request = store.getState().refresh();
    store.getState().setRepoPath('');
    resolve({ kind: 'ok', repo, changes: [change] });
    await request;
    expect(store.getState()).toMatchObject({ repoPath: '', repo: null, changes: [], body: '', publishedUrl: null, status: 'idle' });
    expect(store.getState().title).not.toBe('PR de A');
  });
  it('starts closed and remembers the repo path', () => {
    const { store, files } = setup();
    expect(store.getState()).toMatchObject({ open: false, repoPath: '', status: 'idle' });
    store.getState().setRepoPath('  /repo  ');
    expect(store.getState().repoPath).toBe('/repo');
    expect(files.get(REPO_KEY)).toBe('/repo');
  });

  it('refreshes on open and stores repo + changes', async () => {
    const { store, client } = setup({ path: '/repo' });
    store.getState().setOpen(true);
    await vi.waitFor(() => expect(store.getState().status).toBe('ready'));
    expect(client.status).toHaveBeenCalledWith('/repo');
    expect(store.getState()).toMatchObject({ open: true, repo, changes: [change] });
  });

  it('polls quietly with the light route while the panel is closed, the full status while open', async () => {
    const { store, client } = setup({ path: '/repo' });
    await store.getState().refresh();
    await store.getState().refresh({ quiet: true });
    expect(client.changes).toHaveBeenCalledWith('/repo');
    expect(client.status).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ repo, status: 'ready' });
    expect(store.getState().changes).toHaveLength(2);
    store.getState().setOpen(true);
    await vi.waitFor(() => expect(client.status).toHaveBeenCalledTimes(2));
    await store.getState().refresh({ quiet: true });
    expect(client.changes).toHaveBeenCalledTimes(1);
    expect(client.status).toHaveBeenCalledTimes(3);
  });

  it('loads the semantic diff and the PR status', async () => {
    const { store } = setup({ path: '/repo' });
    await store.getState().refresh();
    await store.getState().loadDiff();
    expect(store.getState()).toMatchObject({ diffStatus: 'ready', diff: '## Arquitetura' });
    await store.getState().loadPr();
    expect(store.getState()).toMatchObject({ prStatus: 'ready', prText: 'PR x' });
  });

  it('publishes, toasts the URL and refreshes the status', async () => {
    const { store, client, notify } = setup({ path: '/repo' });
    await store.getState().refresh();
    store.getState().setTitle('Fila de pedidos');
    await store.getState().publish();
    expect(client.publish).toHaveBeenCalledWith({ dir: '/repo', title: 'Fila de pedidos', body: '', branch: undefined, draft: false });
    expect(store.getState()).toMatchObject({ publishing: false, publishedUrl: 'https://github.com/x/y/pull/1' });
    expect(notify).toHaveBeenCalledWith('PR aberto: https://github.com/x/y/pull/1');
    expect(client.status).toHaveBeenCalledTimes(2);
  });

  it('does not publish without a title and keeps the error otherwise', async () => {
    const { store, client } = setup({ path: '/repo' });
    await store.getState().refresh();
    store.getState().setTitle('   ');
    await store.getState().publish();
    expect(client.publish).not.toHaveBeenCalled();

    client.publish.mockResolvedValueOnce({ kind: 'error', message: 'Nada para publicar: .arch/ não tem mudanças.' });
    store.getState().setTitle('Fila');
    await store.getState().publish();
    expect(store.getState().publishError).toBe('Nada para publicar: .arch/ não tem mudanças.');
  });

  it('a quiet refresh never toasts and keeps the last good state on failure', async () => {
    const { store, client, notify } = setup({ path: '/repo' });
    await store.getState().refresh();
    client.status.mockResolvedValue({ kind: 'offline', reason: 'Servidor fora.' });
    client.changes.mockResolvedValue({ kind: 'offline', reason: 'Servidor fora.' });
    await store.getState().refresh({ quiet: true });
    expect(notify).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({ status: 'error', error: 'Servidor fora.' });

    await store.getState().refresh();
    expect(notify).toHaveBeenCalledWith('Servidor fora.');
  });
});
