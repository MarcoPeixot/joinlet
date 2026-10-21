import { prComment } from '@strukt/git';
import type { CommandRunner } from '@strukt/git';
import type { CliArgs } from '../args';
import type { CliIo } from '../io';

/** `joinlet pr-comment`: comenta (ou atualiza) o diff semântico no PR. */
export async function runPrComment(args: CliArgs, io: CliIo, runner: CommandRunner): Promise<number> {
  const result = await prComment({ runner, cwd: args.dir, base: args.base!, head: args.head ?? 'HEAD', pr: args.pr, artifactUrl: args.artifactUrl });
  if (!result.ok) {
    io.err(result.error);
    return 2;
  }
  io.out(`Comentário do diff ${result.action === 'created' ? 'criado' : 'atualizado'}: ${result.url}`);
  return 0;
}
