import { relative, resolve, sep } from 'node:path';
import { inspectContext, writeGeneratedContext } from '@strukt/workspace/context-storage';
import { openWorkspaceAt } from '@strukt/workspace/fs';
import type { CliArgs } from '../args';
import type { CliIo } from '../io';
import { syncAgentInstructions } from '@strukt/workspace/repository-agents';

/** `--out` (default `.arch/context`) resolved to a path inside `.arch/`, as the adapter expects. */
export function contextOutDir(root: string, archDir: string, out: string | undefined): string | { error: string } {
  const rel = relative(archDir, resolve(root, out ?? '.arch/context')).split(sep).join('/');
  if (!rel || rel.startsWith('..')) return { error: `A saída precisa ficar dentro de .arch/: "${out ?? '.arch/context'}".` };
  return rel;
}

/** Writes (or checks) the generated context for agents; never creates it when `--check` is given. */
export async function runContext(args: CliArgs, io: CliIo): Promise<number> {
  const opened = await openWorkspaceAt(args.dir);
  if (!opened) {
    io.err(`Nenhum workspace do Joinlet encontrado a partir de "${args.dir}" (procurei .arch/strukt.json).`);
    return 2;
  }
  const out = contextOutDir(opened.root, opened.archDir, args.out);
  if (typeof out === 'object') {
    io.err(out.error);
    return 2;
  }
  if (args.check) {
    const status = await inspectContext(opened.adapter, opened.data, out);
    if (status.stale) {
      io.err(`O contexto está ausente ou desatualizado: ${[...status.missingInputs, ...status.missing, ...status.changed, ...status.obsolete].join(', ')}. Rode "joinlet context" e commite o resultado.`);
      return 1;
    }
    io.out('O contexto está atualizado.');
    return 0;
  }
  const touched = await writeGeneratedContext(opened.adapter, opened.data, out);
  const instructions=await syncAgentInstructions(opened.root);
  if(instructions.conflicts.length){io.err('Agent instructions need review: '+instructions.conflicts.join(', '));return 1;}
  io.out(touched.length ? `Contexto atualizado: ${touched.join(', ')}.` : 'O contexto já estava atualizado.');
  return 0;
}
