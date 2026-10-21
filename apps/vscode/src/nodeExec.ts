import { execFile } from 'node:child_process';
import type { ExecFn } from './run';

/** `execFile` without a shell: arguments are never interpreted, a failure is data, never a throw. */
export const nodeExec: ExecFn = (command, args, options) =>
  new Promise((resolve) => {
    execFile(command, [...args], { cwd: options.cwd, timeout: options.timeoutMs, maxBuffer: options.maxBuffer, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
      if (!error) return resolve({ code: 0, stdout, stderr });
      const failure = error as NodeJS.ErrnoException & { killed?: boolean; code?: string | number };
      if (typeof failure.code === 'number') return resolve({ code: failure.code, stdout, stderr });
      const timedOut = failure.killed === true && typeof failure.code !== 'string';
      resolve({ code: null, stdout, stderr, failure: { code: failure.code, message: failure.message, ...(timedOut ? { timedOut: true } : {}) } });
    });
  });
