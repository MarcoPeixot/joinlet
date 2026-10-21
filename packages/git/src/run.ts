import { execFile } from 'node:child_process';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** The only impure seam of the git integration: tests inject a fake instead of spawning. */
export type CommandRunner = (cmd: string, args: readonly string[], opts?: { cwd?: string; env?: Record<string, string> }) => Promise<CommandResult>;

const MAX_BUFFER = 64 * 1024 * 1024;

export function createProcessRunner(): CommandRunner {
  const runtime = (globalThis as { Bun?: {
    spawn(command: string[], options: { cwd?: string; env: Record<string, string | undefined>; stdin: 'ignore'; stdout: 'pipe'; stderr: 'pipe' }): {
      stdout: ReadableStream<Uint8Array>; stderr: ReadableStream<Uint8Array>; exited: Promise<number>;
    };
  } }).Bun;
  if (runtime) {
    return async (cmd, args, opts = {}) => {
      try {
        const process = runtime.spawn([cmd, ...args], {
          cwd: opts.cwd,
          env: opts.env ? { ...globalThis.process.env, ...opts.env } : globalThis.process.env,
          stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
        });
        const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > MAX_BUFFER) return { code: 1, stdout: '', stderr: 'Saída do comando grande demais.' };
        return { code, stdout, stderr };
      } catch (error) {
        return { code: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
      }
    };
  }
  return (cmd, args, opts = {}) =>
    new Promise((resolve) => {
        execFile(cmd, [...args], { cwd: opts.cwd, env: opts.env ? { ...process.env, ...opts.env } : process.env, encoding: 'utf8', maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
        const code = error && typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : error ? 1 : 0;
        resolve({ code, stdout, stderr });
      });
    });
}

/** The `.arch/` files of a ref, keyed by their path inside it; `null` when the ref has no `.arch/`. */
export async function readArchAtRef(runner: CommandRunner, cwd: string, ref: string): Promise<Record<string, string> | null> {
  const listed = await runner('git', ['ls-tree', '-r', '--name-only', ref, '--', '.arch'], { cwd });
  if (listed.code !== 0) return null;
  const files: Record<string, string> = {};
  for (const full of listed.stdout.split('\n').filter(Boolean)) {
    const shown = await runner('git', ['show', `${ref}:${full}`], { cwd });
    if (shown.code !== 0) continue;
    files[full.replace(/^\.arch\//, '')] = shown.stdout;
  }
  return files;
}
