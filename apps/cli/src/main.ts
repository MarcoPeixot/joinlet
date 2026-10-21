#!/usr/bin/env bun
import { ADMIN_PLAN, SELF_HOSTED_PLAN } from '@strukt/workspace';
import { withAccessPlan } from '@strukt/workspace/access-context';
import { parseArgs, USAGE } from './args';
import { runVerify } from './commands/verify';
import { runCheck } from './commands/check';
import { runContext } from './commands/context';
import { runDiff } from './commands/diff';
import { runEvidence } from './commands/evidence';
import { runExport } from './commands/export';
import { runList } from './commands/list';
import { createProcessRunner } from '@strukt/git';
import { runPrComment } from './commands/pr-comment';
import { runSite } from './commands/site';
import { runSources } from './commands/sources';
import { runSync } from './commands/sync';
import { runImportCloud } from './commands/importCloud';
import { runPublish } from './commands/publish';
import { consoleIo } from './io';
import type { CliIo } from './io';

/** Runs one parsed command; the returned code is the process exit code. */
export async function run(argv: readonly string[], io: CliIo = consoleIo): Promise<number> {
  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    io.err(`${parsed.error}\n\n${USAGE}`);
    return 2;
  }
  if (parsed.command === 'help') {
    io.out(USAGE);
    return 0;
  }
  if (parsed.help) {
    io.out(USAGE);
    return 0;
  }
  const args = parsed;
  try {
    switch (args.command) {
      case 'verify':
        return await runVerify(args, io);
      case 'check':
        return await runCheck(args, io, createProcessRunner());
      case 'import':
        return await runImportCloud(args, io, createProcessRunner());
      case 'context':
        return await runContext(args, io);
      case 'diff':
        return await runDiff(args, io, createProcessRunner());
      case 'evidence':
        return await runEvidence(args, io);
      case 'export':
        return await runExport(args, io);
      case 'list':
        return await runList(args, io);
      case 'site':
        return await runSite(args, io);
      case 'publish':
        return await runPublish(args, io, createProcessRunner());
      case 'pr-comment':
        return await runPrComment(args, io, createProcessRunner());
      case 'sync':
        return await runSync(args, io);
      case 'sources':
        return await runSources(args, io);
      default:
        io.err(`Comando desconhecido: "${args.command}".`);
        return 2;
    }
  } catch (err) {
    io.err(`Erro: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

if (import.meta.main) process.exit(await withAccessPlan(process.env.JOINLET_LOCAL_ADMIN === '1' ? ADMIN_PLAN : SELF_HOSTED_PLAN, () => run(process.argv.slice(2))));
