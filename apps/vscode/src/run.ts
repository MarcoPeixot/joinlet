import type { CliInvocation, CliSettings } from './cli';

export interface ExecOptions {
  cwd: string;
  timeoutMs: number;
  maxBuffer: number;
}

export interface ExecResult {
  /** Exit code; null when the process could not run to completion. */
  code: number | null;
  stdout: string;
  stderr: string;
  failure?: { code?: string; message: string; timedOut?: boolean };
}

/** Injectable process runner (`nodeExec` in production, a fake in the tests). */
export type ExecFn = (command: string, args: readonly string[], options: ExecOptions) => Promise<ExecResult>;

export type RunOutcome =
  | { kind: 'done'; code: number; stdout: string; stderr: string }
  | { kind: 'not-found' }
  | { kind: 'timeout' }
  | { kind: 'too-large' }
  | { kind: 'failed'; message: string };

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 20 * 1024 * 1024;

export async function runCli(exec: ExecFn, invocation: CliInvocation, options: { timeoutMs?: number } = {}): Promise<RunOutcome> {
  const result = await exec(invocation.command, invocation.args, { cwd: invocation.cwd, timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBuffer: MAX_BUFFER });
  const { failure } = result;
  if (failure?.timedOut) return { kind: 'timeout' };
  if (failure?.code === 'ENOENT') return { kind: 'not-found' };
  if (failure?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return { kind: 'too-large' };
  if (failure || result.code === null) return { kind: 'failed', message: failure?.message ?? 'O processo não terminou normalmente.' };
  return { kind: 'done', code: result.code, stdout: result.stdout, stderr: result.stderr };
}

/** A pt-BR message for an outcome the caller cannot use (exit code 2 carries the CLI's own explanation). */
export function describeRunFailure(outcome: RunOutcome, settings: CliSettings): string {
  switch (outcome.kind) {
    case 'not-found':
      return `Não encontrei o executável "${settings.path}". Instale a CLI do Joinlet no PATH ou aponte strukt.cli.path (e strukt.cli.args) nas configurações do usuário.`;
    case 'timeout':
      return 'A CLI do Joinlet passou do tempo limite e foi interrompida.';
    case 'too-large':
      return 'A saída da CLI do Joinlet ficou grande demais para mostrar.';
    case 'failed':
      return `Não foi possível executar a CLI do Joinlet: ${outcome.message}`;
    case 'done':
      return outcome.stderr.trim() || `A CLI do Joinlet terminou com o código ${outcome.code}.`;
  }
}
