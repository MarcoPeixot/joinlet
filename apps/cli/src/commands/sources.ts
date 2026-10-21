import { addItem, slugify } from '@strukt/workspace';
import type { Source } from '@strukt/workspace';
import { SOURCES_PATH, describeProblem, parseSources, printSources, validateSourceTargets } from '@strukt/workspace';
import { openWorkspaceAt, writeWorkspace } from '@strukt/workspace/fs';
import type { OpenedWorkspace } from '@strukt/workspace/fs';
import { SYNC_PATH, collectSourceFiles, emptySyncState, parseSyncState, printSyncState } from '@strukt/workspace/sync';
import type { CliArgs } from '../args';
import type { CliIo } from '../io';

const NO_WORKSPACE = (dir: string) => `Nenhum workspace do Joinlet encontrado a partir de "${dir}" (procurei .arch/strukt.json).`;

/** A diagram title whose slug is exactly `slug` (the sources file refers to diagrams by slug), or `null` when none exists. */
function titleForSlug(slug: string): string | null {
  const title = `${slug.charAt(0).toUpperCase()}${slug.slice(1).replace(/-/g, ' ')}`;
  return slugify(title) === slug ? title : null;
}

async function readSources(opened: OpenedWorkspace, io: CliIo): Promise<Source[] | null> {
  const parsed = parseSources(await opened.adapter.read(SOURCES_PATH));
  if (parsed.diagnostics.length) {
    for (const problem of parsed.diagnostics) io.err(describeProblem(problem));
    io.err('Corrija o .arch/sources.json antes de continuar.');
    return null;
  }
  return parsed.sources;
}

/** `joinlet sources list|add|remove`: edits `.arch/sources.json` (and, on add, may create the target diagram). */
export async function runSources(args: CliArgs, io: CliIo): Promise<number> {
  const opened = await openWorkspaceAt(args.dir);
  if (!opened) {
    io.err(NO_WORKSPACE(args.dir));
    return 2;
  }
  const [action, id] = args.refs as [string, string | undefined];
  const sources = await readSources(opened, io);
  if (!sources) return 1;

  if (action === 'list') {
    if (args.json) io.out(JSON.stringify({ sources }, null, 2));
    else if (!sources.length) io.out('Nenhuma fonte configurada. Use "joinlet sources add".');
    else for (const source of sources) io.out(`${source.id}  ${source.kind}  → ${source.diagram} (${source.mode})  ${source.include.join(' ')}`);
    return 0;
  }

  if (action === 'remove') {
    if (!sources.some((source) => source.id === id)) {
      io.err(`A fonte "${id}" não existe. Fontes: ${sources.map((source) => source.id).join(', ') || 'nenhuma'}.`);
      return 1;
    }
    await opened.adapter.write(SOURCES_PATH, printSources(sources.filter((source) => source.id !== id)));
    const { state } = parseSyncState(await opened.adapter.read(SYNC_PATH));
    if (Object.hasOwn(state.sources, id!)) {
      const { [id!]: _gone, ...rest } = state.sources;
      if (Object.keys(rest).length) await opened.adapter.write(SYNC_PATH, printSyncState({ ...emptySyncState(), sources: rest }));
      else await opened.adapter.remove(SYNC_PATH);
    }
    io.out(`Fonte "${id}" removida. Os elementos já importados continuam no diagrama e passam a ser só seus.`);
    return 0;
  }

  const candidate = { id: id!, kind: args.kind!, include: args.include, diagram: args.diagram!, mode: args.mode ?? 'merge' };
  const draft = parseSources(JSON.stringify({ version: 1, sources: [...sources, candidate] }));
  if (draft.diagnostics.length) {
    for (const problem of draft.diagnostics) io.err(describeProblem(problem));
    return 1;
  }
  const next = draft.sources;
  let data = opened.data;
  const exists = data.manifest.diagrams.some((entry) => entry.slug === candidate.diagram);
  let created = false;
  if (!exists) {
    const title = titleForSlug(candidate.diagram);
    if (!title) {
      io.err(`O diagrama "${candidate.diagram}" não existe e não dá para criá-lo com esse slug (use minúsculas e hífens, ou crie o diagrama no app antes).`);
      return 1;
    }
    data = addItem(data, 'diagram', title).data;
    created = true;
  }
  const targetProblems = validateSourceTargets(next, data.manifest.diagrams.map((entry) => entry.slug));
  if (targetProblems.length) {
    for (const problem of targetProblems) io.err(`${problem.path}: ${problem.message}`);
    return 1;
  }
  if (created) await writeWorkspace(opened.adapter, data, opened.data);
  await opened.adapter.write(SOURCES_PATH, printSources(next));
  io.out(`Fonte "${candidate.id}" adicionada${created ? ` (diagrama "${candidate.diagram}" criado)` : ''}.`);
  const found = await collectSourceFiles(opened.root, candidate.include);
  if ('error' in found) io.err(`aviso: ${found.error}`);
  else if (!found.files.length) io.err('aviso: nenhum arquivo casa com os padrões ainda; confira os globs (relativos à raiz do repositório).');
  else io.out(`${found.files.length} arquivo${found.files.length === 1 ? '' : 's'} casa${found.files.length === 1 ? '' : 'm'} com os padrões. Rode "joinlet sync" para importar.`);
  return 0;
}
