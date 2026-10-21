import { describe, expect, it } from 'vitest';
import { nodeExec } from './nodeExec';

const opts = { cwd: process.cwd(), timeoutMs: 10_000, maxBuffer: 1024 * 1024 };

describe('nodeExec (real child process, no shell)', () => {
  it('captures stdout and exit code 0', async () => {
    expect(await nodeExec(process.execPath, ['-e', 'console.log("oi")'], opts)).toMatchObject({ code: 0, stdout: 'oi\n' });
  });

  it('returns a non-zero exit code with stderr instead of throwing', async () => {
    expect(await nodeExec(process.execPath, ['-e', 'console.error("ruim"); process.exit(1)'], opts)).toMatchObject({ code: 1, stderr: 'ruim\n' });
  });

  it('does not interpret shell metacharacters in arguments', async () => {
    const result = await nodeExec(process.execPath, ['-e', 'console.log(process.argv[1])', '$(echo hacked); `id`'], opts);
    expect(result.stdout).toBe('$(echo hacked); `id`\n');
  });

  it('reports a missing binary as ENOENT', async () => {
    expect((await nodeExec('strukt-binary-that-does-not-exist', [], opts)).failure?.code).toBe('ENOENT');
  });

  it('kills a slow process at the timeout', async () => {
    const result = await nodeExec(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { ...opts, timeoutMs: 200 });
    expect(result.failure?.timedOut).toBe(true);
  });

  it('reports output over the buffer', async () => {
    const result = await nodeExec(process.execPath, ['-e', 'console.log("x".repeat(5000))'], { ...opts, maxBuffer: 100 });
    expect(result.failure?.code).toBe('ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
  });
});
