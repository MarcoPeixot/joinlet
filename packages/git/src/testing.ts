import type { CommandResult, CommandRunner } from './run';

export interface FakeCall {
  cmd: string;
  args: readonly string[];
}

export interface FakeRunnerOptions {
  /** Scripted responses, checked in order before the ref trees. */
  responses?: { when: (cmd: string, args: readonly string[]) => boolean; result: CommandResult }[];
  /** `files[ref]` is the `.arch/` tree of that ref (for `ls-tree`/`show`). */
  files?: Record<string, Record<string, string>>;
  calls?: FakeCall[];
}

const code0 = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '' });

/** A git/gh stand-in: records every call and answers from the script or the ref trees. */
export function fakeRunner({ responses = [], files = {}, calls = [] }: FakeRunnerOptions = {}): CommandRunner {
  return async (cmd, args) => {
    calls.push({ cmd, args: [...args] });
    for (const response of responses) if (response.when(cmd, args)) return response.result;
    if (cmd === 'git' && args[0] === 'ls-tree') {
      const tree = files[args[3]!];
      if (!tree) return { code: 128, stdout: '', stderr: 'unknown ref' };
      return code0(`${Object.keys(tree).map((path) => `.arch/${path}`).join('\n')}\n`);
    }
    if (cmd === 'git' && args[0] === 'show') {
      const [ref, path] = args[1]!.split(':') as [string, string];
      const text = files[ref]?.[path.replace(/^\.arch\//, '')];
      return text === undefined ? { code: 128, stdout: '', stderr: 'missing' } : code0(text);
    }
    return { code: 1, stdout: '', stderr: 'unexpected' };
  };
}

export const when = (cmd: string, first: string) => (actualCmd: string, args: readonly string[]) => actualCmd === cmd && args[0] === first;
