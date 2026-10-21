import { afterEach, describe, expect, it } from 'vitest';
import { cleanupDirs, connectClient, fakeRunner, isErrorOf, openTestWorkspace, textOf } from './testing';

afterEach(cleanupDirs);

const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
const isGit = (first: string, includes?: string) => (cmd: string, args: readonly string[]) =>
  cmd === 'git' && args[0] === first && (includes === undefined || args.includes(includes));

function publishRunner() {
  return fakeRunner({
    files: { main: { 'strukt.json': '{"version":1,"name":"Loja","diagrams":[],"docs":[],"sketches":[]}' } },
    responses: [
      { when: isGit('rev-parse', '--is-inside-work-tree'), result: ok('true\n') },
      { when: isGit('rev-parse'), result: { code: 128, stdout: '', stderr: 'not found' } },
      { when: isGit('status'), result: ok(' M .arch/diagrams/a.strukt.json\n') },
      { when: (cmd, args) => cmd === 'gh' && args[0] === 'auth', result: ok('ok') },
      { when: (cmd, args) => cmd === 'gh' && args[0] === 'repo', result: ok('main\n') },
      { when: (cmd, args) => cmd === 'gh' && args[0] === 'pr', result: ok('https://github.com/x/y/pull/9\n') },
      { when: () => true, result: ok() },
    ],
  });
}

describe('MCP GitHub tools', () => {
  it('publishes through the injected runner', async () => {
    const ws = await openTestWorkspace();
    const { client, close } = await connectClient(ws, { runner: publishRunner() });
    const result = await client.callTool({ name: 'publish', arguments: { title: 'Fila de pedidos', body: 'Adiciona a fila.' } });
    expect(isErrorOf(result)).toBe(false);
    expect(textOf(result)).toContain('PR aberto: https://github.com/x/y/pull/9');
    await close();
  });

  it('reports the opened PR to the server hook, and not a failed one', async () => {
    const ws = await openTestWorkspace();
    const events: unknown[] = [];
    ws.notify = (event) => void events.push(event);
    const { client, close } = await connectClient(ws, { runner: publishRunner() });
    await client.callTool({ name: 'publish', arguments: { title: 'Fila de pedidos' } });
    expect(events).toEqual([{ event: 'pr', title: 'Fila de pedidos', url: 'https://github.com/x/y/pull/9', branch: expect.stringContaining('strukt/fila-de-pedidos-') }]);
    await close();
    const failing = await openTestWorkspace();
    failing.notify = (event) => void events.push(event);
    const other = await connectClient(failing, { runner: fakeRunner({ responses: [{ when: () => true, result: { code: 1, stdout: '', stderr: 'no' } }] }) });
    await other.client.callTool({ name: 'publish', arguments: { title: 'x' } });
    expect(events).toHaveLength(1);
    await other.close();
  });

  it('explains a missing gh instead of failing silently', async () => {
    const ws = await openTestWorkspace();
    const runner = fakeRunner({
      responses: [
        { when: isGit('rev-parse', '--is-inside-work-tree'), result: ok('true\n') },
        { when: (cmd, args) => cmd === 'gh' && args[0] === 'auth', result: { code: 1, stdout: '', stderr: 'not logged in' } },
      ],
    });
    const { client, close } = await connectClient(ws, { runner });
    const result = await client.callTool({ name: 'publish', arguments: { title: 'x' } });
    expect(isErrorOf(result)).toBe(true);
    expect(textOf(result)).toContain('gh auth login');
    await close();
  });

  it('reports the PR status', async () => {
    const ws = await openTestWorkspace();
    const runner = fakeRunner({
      responses: [
        {
          when: (cmd, args) => cmd === 'gh' && args[0] === 'pr',
          result: ok(JSON.stringify({ url: 'https://github.com/x/y/pull/9', state: 'OPEN', isDraft: false, reviewDecision: 'APPROVED', mergeable: 'MERGEABLE', statusCheckRollup: [{ name: 'strukt', conclusion: 'SUCCESS' }] })),
        },
      ],
    });
    const { client, close } = await connectClient(ws, { runner });
    const result = await client.callTool({ name: 'pr_status', arguments: {} });
    expect(textOf(result)).toContain('review: APPROVED');
    expect(textOf(result)).toContain('strukt: SUCCESS');
    await close();
  });
});
