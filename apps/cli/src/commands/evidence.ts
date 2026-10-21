import { EVIDENCE_PATH, printEvidence } from '@strukt/workspace';
import { snapWorkspaceEvidence } from '@strukt/workspace/health';
import { openWorkspaceAt } from '@strukt/workspace/fs';
import type { CliArgs } from '../args';
import type { CliIo } from '../io';

/** `evidence snap`: records the `snippet` of every anchored evidence reference that lacks one. Only `.arch/evidence.json` is written. */
export async function runEvidence(args: CliArgs, io: CliIo): Promise<number> {
  const opened = await openWorkspaceAt(args.dir);
  if (!opened) {
    io.err(`Nenhum workspace do Joinlet encontrado a partir de "${args.dir}" (procurei .arch/strukt.json).`);
    return 2;
  }
  const { evidence, snapped, skipped } = await snapWorkspaceEvidence(opened.data, opened.root);
  for (const item of skipped) io.out(`ignorada: ${item.path}:${item.line}: ${item.reason}.`);
  if (snapped) await opened.adapter.write(EVIDENCE_PATH, printEvidence(evidence));
  io.out(`${snapped} referências fixadas, ${skipped.length} ignoradas.`);
  return 0;
}
