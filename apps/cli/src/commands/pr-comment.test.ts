import { afterEach, describe, expect, it } from 'vitest';
import { argsOf, cleanupDirs, diagramJson, fakeIo, fakeRunner, manifestOf, tempDir, when } from '../testing';
import { runPrComment } from './pr-comment';

afterEach(cleanupDirs);

const tree = (...ids: string[]) => ({ 'strukt.json': manifestOf('Loja', [{ slug: 'a', title: 'A' }]), 'diagrams/a.strukt.json': diagramJson(...ids) });

describe('runPrComment', () => {
  const setup = async (extra: string[]) => {
    const calls: { cmd: string; args: readonly string[] }[] = [];
    const runner = fakeRunner({
      calls,
      files: { main: tree('API'), feature: tree('API', 'Cache') },
      responses: [
        { when: when('gh', 'repo'), result: { code: 0, stdout: 'x/y\n', stderr: '' } },
        { when: when('gh', 'api'), result: { code: 0, stdout: '\n', stderr: '' } },
      ],
    });
    const io = fakeIo();
    const code = await runPrComment(argsOf('pr-comment', '--dir', await tempDir(), '--base', 'main', '--head', 'feature', '--pr', '7', ...extra), io, runner);
    return { code, io, post: calls.filter((c) => c.args[0] === 'api').at(-1)?.args.join(' ') ?? '' };
  };

  it('passes --artifact-url to the comment', async () => {
    const { code, post } = await setup(['--artifact-url', 'https://github.com/x/y/actions/runs/5']);
    expect(code).toBe(0);
    expect(post).toContain('strukt-diff');
    expect(post).toContain('https://github.com/x/y/actions/runs/5');
    expect(post).toContain('<!-- strukt:diff -->');
  });

  it('rejects a malformed --artifact-url with exit 2', async () => {
    const { code, io } = await setup(['--artifact-url', 'javascript:alert(1)']);
    expect(code).toBe(2);
    expect(io.errText).toContain('--artifact-url');
  });
});
