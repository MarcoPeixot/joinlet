import { describe, expect, it, vi } from 'vitest';
import { requestGitChanges, requestGitDiff, requestGitPr, requestGitPublish, requestGitStatus } from './client';
import type { Fetch } from './client';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const answer = (res: Response | Error) => vi.fn<Fetch>(async () => {
  if (res instanceof Error) throw res;
  return res;
});

const repo = { root: '/repo', archDir: '/repo/.arch', nameWithOwner: 'x/y', branch: 'main', defaultBase: 'main', ghReady: true };

describe('github client', () => {
  it('reads the status with the encoded path', async () => {
    const fetchFn = answer(json(200, { ok: true, repo, changes: [{ status: 'M', path: '.arch/strukt.json' }] }));
    expect(await requestGitStatus('/repo com espaço', fetchFn)).toEqual({ kind: 'ok', repo, changes: [{ status: 'M', path: '.arch/strukt.json' }] });
    expect(fetchFn.mock.calls[0]![0]).toBe('/api/git/status?dir=%2Frepo%20com%20espa%C3%A7o');
  });

  it('reads only the pending changes from the light route', async () => {
    const fetchFn = answer(json(200, { ok: true, changes: [{ status: 'M', path: '.arch/strukt.json' }] }));
    expect(await requestGitChanges('/repo', fetchFn)).toEqual({ kind: 'ok', changes: [{ status: 'M', path: '.arch/strukt.json' }] });
    expect(fetchFn.mock.calls[0]![0]).toBe('/api/git/changes?dir=%2Frepo');
  });

  it('posts the diff, the publish and the PR status', async () => {
    expect(await requestGitDiff('/repo', 'main', answer(json(200, { ok: true, markdown: '## x' })))).toEqual({ kind: 'ok', markdown: '## x' });
    expect(await requestGitPublish({ dir: '/repo', title: 'Fila' }, answer(json(200, { ok: true, url: 'https://github.com/x/y/pull/1', branch: 'strukt/fila' })))).toEqual({
      kind: 'ok',
      url: 'https://github.com/x/y/pull/1',
      branch: 'strukt/fila',
    });
    expect(await requestGitPr('/repo', undefined, answer(json(200, { ok: true, text: 'PR x' })))).toEqual({ kind: 'ok', text: 'PR x' });
  });

  it('goes offline without the local server and surfaces errors in pt-BR', async () => {
    expect(await requestGitStatus('/repo', answer(new TypeError('Failed to fetch')))).toEqual({
      kind: 'offline',
      reason: 'O servidor local (bun run dev) precisa estar rodando para falar com o git e o gh.',
    });
    expect(await requestGitStatus('/repo', answer(new Response('', { status: 502, headers: { 'content-type': 'text/plain' } })))).toMatchObject({ kind: 'offline' });
    expect(await requestGitPublish({ dir: '/repo', title: 'x' }, answer(json(400, { error: 'Nada para publicar: .arch/ não tem mudanças.' })))).toEqual({
      kind: 'error',
      message: 'Nada para publicar: .arch/ não tem mudanças.',
    });
    expect(await requestGitStatus('/repo', answer(json(200, { ok: true })))).toEqual({ kind: 'error', message: 'Resposta inválida do servidor.' });
  });
});
