import { readFile } from 'node:fs/promises';
import { publish } from '@strukt/git';
import type { CommandRunner } from '@strukt/git';
import type { CliArgs } from '../args';
import type { CliIo } from '../io';

/** `joinlet publish`: branch + commit (só `.arch/`) + PR com o diff semântico no corpo. */
export async function runPublish(args: CliArgs, io: CliIo, runner: CommandRunner): Promise<number> {
  let body = '';
  if (args.bodyFile) {
    try {
      body = await readFile(args.bodyFile, 'utf8');
    } catch (err) {
      io.err(`Não foi possível ler ${args.bodyFile}: ${err instanceof Error ? err.message : String(err)}`);
      return 2;
    }
  }
  const result = await publish({
    runner,
    cwd: args.dir,
    title: args.title!,
    body,
    branch: args.branch,
    base: args.base,
    draft: args.draft,
  });
  if (!result.ok) {
    io.err(result.error);
    return 2;
  }
  io.out(`PR aberto: ${result.url}\nBranch: ${result.branch}`);
  return 0;
}
