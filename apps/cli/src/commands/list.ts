import { own } from '@strukt/core';
import { listVersions } from '@strukt/workspace';
import { openWorkspaceAt } from '@strukt/workspace/fs';
import type { CliArgs } from '../args';
import type { CliIo } from '../io';

const stats = (components: number, edges: number) =>
  `${components} componente${components === 1 ? '' : 's'}, ${edges} ${edges === 1 ? 'conexão' : 'conexões'}`;

/** Diagrams (with counts), docs and versions of the workspace. */
export async function runList(args: CliArgs, io: CliIo): Promise<number> {
  const opened = await openWorkspaceAt(args.dir);
  if (!opened) {
    io.err(`Nenhum workspace do Joinlet encontrado a partir de "${args.dir}" (procurei .arch/strukt.json).`);
    return 2;
  }
  const { manifest } = opened.data;
  const lines: string[] = [`Workspace "${manifest.name}" — .arch/`, ''];
  lines.push('Diagramas:');
  if (!manifest.diagrams.length) lines.push('  (nenhum)');
  for (const { slug, title } of manifest.diagrams) {
    const model = own(opened.data.diagrams, slug)?.model;
    lines.push(`  ${slug}  "${title}"  ${model ? stats(model.order.length, model.edges.length) : 'vazio'}`);
  }
  lines.push('', 'Documentos:');
  if (!manifest.docs.length) lines.push('  (nenhum)');
  for (const { slug, title } of manifest.docs) lines.push(`  ${slug}  "${title}"`);
  lines.push('', 'Versões:');
  if (!manifest.diagrams.length) lines.push('  (nenhuma)');
  for (const { slug } of manifest.diagrams) {
    const { entries } = await listVersions(opened.adapter, slug);
    if (!entries.length) continue;
    lines.push(`  ${slug}: ${entries.length} ${entries.length === 1 ? 'versão' : 'versões'} (mais recente em ${entries[0]!.version.createdAt})`);
  }
  io.out(lines.join('\n'));
  return 0;
}
