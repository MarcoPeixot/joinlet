import { describe, expect, it } from 'vitest';
import { describeRunFailure, runCli } from './run';
import type { ExecFn } from './run';

const inv = { command: 'strukt', args: ['check', '--json'], cwd: '/repo' };

describe('runCli', () => {
  it('returns stdout and the exit code', async () => {
    const exec: ExecFn = async () => ({ code: 1, stdout: '{"ok":false}', stderr: 'aviso' });
    expect(await runCli(exec, inv)).toEqual({ kind: 'done', code: 1, stdout: '{"ok":false}', stderr: 'aviso' });
  });

  it('passes the invocation and limits to the executor', async () => {
    let seen: unknown;
    const exec: ExecFn = async (command, args, options) => {
      seen = { command, args, options };
      return { code: 0, stdout: '', stderr: '' };
    };
    await runCli(exec, inv, { timeoutMs: 5000 });
    expect(seen).toEqual({ command: 'strukt', args: ['check', '--json'], options: { cwd: '/repo', timeoutMs: 5000, maxBuffer: 20 * 1024 * 1024 } });
  });

  it('classifies a missing binary', async () => {
    const exec: ExecFn = async () => ({ code: null, stdout: '', stderr: '', failure: { code: 'ENOENT', message: 'spawn strukt ENOENT' } });
    expect(await runCli(exec, inv)).toMatchObject({ kind: 'not-found' });
  });

  it('classifies a timeout', async () => {
    const exec: ExecFn = async () => ({ code: null, stdout: '', stderr: '', failure: { timedOut: true, message: 'x' } });
    expect(await runCli(exec, inv)).toMatchObject({ kind: 'timeout' });
  });

  it('classifies output over the buffer', async () => {
    const exec: ExecFn = async () => ({ code: null, stdout: '', stderr: '', failure: { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', message: 'x' } });
    expect(await runCli(exec, inv)).toMatchObject({ kind: 'too-large' });
  });

  it('keeps other failures with their message', async () => {
    const exec: ExecFn = async () => ({ code: null, stdout: '', stderr: '', failure: { code: 'EACCES', message: 'permission denied' } });
    expect(await runCli(exec, inv)).toEqual({ kind: 'failed', message: 'permission denied' });
  });
});

describe('describeRunFailure', () => {
  const s = { path: 'strukt', args: [] as string[] };

  it('explains how to install or configure a missing CLI', () => {
    const text = describeRunFailure({ kind: 'not-found' }, s);
    expect(text).toContain('"strukt"');
    expect(text).toContain('strukt.cli.path');
  });

  it('turns exit code 2 into the CLI message', () => {
    expect(describeRunFailure({ kind: 'done', code: 2, stdout: '', stderr: 'Nenhum workspace do Joinlet encontrado.\n' }, s)).toBe('Nenhum workspace do Joinlet encontrado.');
  });

  it('has a fallback for an unexplained exit code and for timeouts', () => {
    expect(describeRunFailure({ kind: 'done', code: 9, stdout: '', stderr: '' }, s)).toContain('9');
    expect(describeRunFailure({ kind: 'timeout' }, s)).toContain('tempo');
    expect(describeRunFailure({ kind: 'too-large' }, s)).toContain('grande');
    expect(describeRunFailure({ kind: 'failed', message: 'boom' }, s)).toContain('boom');
  });
});
