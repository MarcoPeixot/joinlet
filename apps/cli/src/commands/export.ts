import { basename, dirname, join, resolve } from 'node:path';
import { own } from '@strukt/core';
import { printMermaid, printPlantUml } from '@strukt/dsl';
import { openWorkspaceAt } from '@strukt/workspace/fs';
import type { CliArgs } from '../args';
import type { CliIo } from '../io';
import { writeFilesSafely } from '../safeWrite';

const PRINTERS = { mermaid: printMermaid, plantuml: printPlantUml } as const;
const FORMATS = Object.keys(PRINTERS);

/** `joinlet export <slug> --format mermaid|plantuml [--out file]`: read-only; text goes to stdout unless `--out`. */
export async function runExport(args: CliArgs, io: CliIo): Promise<number> {
  const format = args.format ?? '';
  if (!Object.hasOwn(PRINTERS, format)) {
    io.err(`Formato inválido: "${format}". Use --format ${FORMATS.join(' ou --format ')}.`);
    return 1;
  }
  const opened = await openWorkspaceAt(args.dir);
  if (!opened) {
    io.err(`Nenhum workspace do Joinlet encontrado a partir de "${args.dir}" (procurei .arch/strukt.json).`);
    return 2;
  }
  const slug = args.refs[0]!;
  const diagram = own(opened.data.diagrams, slug);
  if (!diagram) {
    const known = opened.data.manifest.diagrams.map((d) => d.slug).join(', ') || 'nenhum';
    io.err(`Diagrama "${slug}" não encontrado. Diagramas: ${known}.`);
    return 1;
  }
  const text = PRINTERS[format as keyof typeof PRINTERS](diagram.model);
  if (args.out) {
    const target = resolve(args.out);
    const saved = await writeFilesSafely(dirname(target), [{ rel: basename(target), content: text }], { forbidInside: [opened.archDir, join(opened.root, '.git')] });
    if (!saved.ok) { io.err(saved.error); return 1; }
    io.err(`Exportado para ${target}`);
  } else io.out(text.replace(/\n$/, ''));
  return 0;
}
