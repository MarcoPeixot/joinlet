import { afterEach, describe, expect, it } from 'vitest';
import { argsOf, cleanupDirs, fakeIo, fakeRunner, tempDir } from '../testing';
import { runPrComment } from './pr-comment';
import { runPublish } from './publish';

afterEach(cleanupDirs);

const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });

/** A runner that walks through publish/pr-comment without git or gh. */
function githubRunner() {
  return fakeRunner({
    files: { main: { 'strukt.json': '{"version":1,"name":"Loja","diagrams":[],"docs":[],"sketches":[]}' } },
    responses: [
      { when: (cmd: string, args: readonly string[]) => cmd === 'git' && args[0] === 'rev-parse' && args.includes('--is-inside-work-tree'), result: ok('true\n') },
      { when: (cmd: string, args: readonly string[]) => cmd === 'git' && args[0] === 'rev-parse', result: { code: 128, stdout: '', stderr: 'not found' } },
      { when: (cmd: string, args: readonly string[]) => cmd === 'git' && args[0] === 'status', result: ok(' M .arch/strukt.json\n') },
      { when: (cmd: string, args: readonly string[]) => cmd === 'gh' && args[0] === 'auth', result: ok('ok') },
      { when: (cmd: string, args: readonly string[]) => cmd === 'gh' && args[0] === 'repo', result: ok('main\n') },
      { when: (cmd: string, args: readonly string[]) => cmd === 'gh' && args[0] === 'pr', result: ok('https://github.com/x/y/pull/1\n') },
      { when: () => true, result: ok() },
    ],
  });
}

describe('runPublish', () => {
  it('publishes and prints the PR URL', async () => {
    const dir = await tempDir();
    const out = fakeIo();
    expect(await runPublish(argsOf('publish', '--dir', dir, '--title', 'Fila', '--body-file', '/dev/null'), out, githubRunner())).toBe(0);
    expect(out.outText).toContain('PR aberto: https://github.com/x/y/pull/1');
  });

  it('reports a missing body file as a usage error', async () => {
    const dir = await tempDir();
    const out = fakeIo();
    expect(await runPublish(argsOf('publish', '--dir', dir, '--title', 'Fila', '--body-file', '/nao/existe.md'), out, githubRunner())).toBe(2);
    expect(out.errText).toContain('Não foi possível ler /nao/existe.md');
  });
});

describe('runPrComment', () => {
  it('comments the diff on the PR', async () => {
    const dir = await tempDir();
    const out = fakeIo();
    const runner = fakeRunner({
      files: { main: { 'strukt.json': '{"version":1,"name":"Loja","diagrams":[],"docs":[],"sketches":[]}' } },
      responses: [
        { when: (cmd: string, args: readonly string[]) => cmd === 'gh' && args[0] === 'repo', result: ok('x/y\n') },
        { when: (cmd: string, args: readonly string[]) => cmd === 'gh' && args[0] === 'api', result: ok('\n') },
      ],
    });
    expect(await runPrComment(argsOf('pr-comment', '--dir', dir, '--base', 'main', '--head', 'main', '--pr', '7'), out, runner)).toBe(0);
    expect(out.outText).toContain('Comentário do diff criado: https://github.com/x/y/pull/7');
  });
});
