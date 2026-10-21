import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CLOUD_ICONS } from '@strukt/core/cloud';
import { CLOUD_STATE_PATH, graphToModel, parseCloudState, parseTerraformShow, printCloudState, trackResources, withSource } from '@strukt/dsl/import';
import type { CloudGraph, CloudOrigin, CloudProvider } from '@strukt/dsl/import';
import { createProcessRunner } from '@strukt/git';
import type { CommandRunner } from '@strukt/git';
import { autoLayout } from '@strukt/layout';
import { addItem, contextFiles } from '@strukt/workspace';
import { openWorkspaceAt, writeWorkspace } from '@strukt/workspace/fs';
import type { CliArgs } from '../args';
import { CloudCommandRefused } from '../cloudAllowlist';
import { collectCloud } from '../cloudCollect';
import type { CloudScopeArgs } from '../cloudCollect';
import type { CliIo } from '../io';

/** A real `terraform show -json` of a big estate is large; anything beyond this is not a state file. */
export const MAX_TERRAFORM_FILE = 64_000_000;

const ICON_IDS = new Set(CLOUD_ICONS.map((icon) => icon.name));
const PROVIDER_NAME: Record<CloudOrigin, string> = { aws: 'AWS', azure: 'Azure', gcp: 'GCP', terraform: 'Terraform' };

export const scopeOf = (args: CliArgs): CloudScopeArgs => ({
  ...(args.profile ? { profile: args.profile } : {}),
  ...(args.region ? { region: args.region } : {}),
  ...(args.subscription ? { subscription: args.subscription } : {}),
  ...(args.resourceGroup ? { resourceGroup: args.resourceGroup } : {}),
  ...(args.project ? { project: args.project } : {}),
});

/** Reads and parses a `terraform show -json` file; the message is already pt-BR. */
export async function readTerraformFile(path: string): Promise<{ graph: CloudGraph } | { error: string }> {
  const full = resolve(path);
  let info;
  try { info = await stat(full); } catch { return { error: `Arquivo não encontrado: "${path}".` }; }
  if (!info.isFile()) return { error: `"${path}" não é um arquivo.` };
  if (info.size > MAX_TERRAFORM_FILE) return { error: `"${path}" é grande demais para ser um "terraform show -json" (limite de ${(MAX_TERRAFORM_FILE / 1_000_000).toFixed(0)} MB).` };
  return parseTerraformShow(await readFile(full, 'utf8'));
}

function defaultTitle(graph: CloudGraph): string {
  const { scope, origin } = graph;
  const detail = scope.project ?? scope.region ?? scope.resourceGroup ?? scope.subscription;
  return `${PROVIDER_NAME[origin]}${detail ? ` ${detail}` : ' (estado)'}`;
}

/**
 * `joinlet import cloud --provider aws|azure|gcp …` or `--file <terraform show -json>`: draws the live cloud as a new diagram
 * and records, in `.arch/cloud.json`, which resource each element stands for (the baseline `check --cloud` compares with).
 * Only `.arch/` is written; the cloud is only ever read, through the user's own CLI and a read-only allowlist.
 */
export async function runImportCloud(args: CliArgs, io: CliIo, runner: CommandRunner = createProcessRunner(), options: { env?: Record<string, string | undefined> } = {}): Promise<number> {
  const opened = await openWorkspaceAt(args.dir);
  if (!opened) {
    io.err(`Nenhum workspace do Joinlet encontrado a partir de "${args.dir}" (procurei .arch/strukt.json).`);
    return 2;
  }
  let graph: CloudGraph;
  try {
    const collected = args.file !== undefined
      ? await readTerraformFile(args.file)
      : await collectCloud(args.provider as CloudProvider, runner, scopeOf(args), { env: options.env ?? process.env });
    if ('error' in collected) {
      io.err(collected.error);
      return 2;
    }
    graph = collected.graph;
  } catch (error) {
    if (error instanceof CloudCommandRefused) {
      io.err(error.message);
      return 2;
    }
    throw error;
  }

  const drawn = graphToModel(graph, { hasIcon: (id) => ICON_IDS.has(id) });
  const { model } = drawn.result;
  if (!model.order.length) {
    io.err('Nada para importar: a consulta não devolveu recursos que entrem no diagrama.');
    for (const diagnostic of [...graph.diagnostics, ...drawn.result.diagnostics]) io.err(`aviso: ${diagnostic.message}`);
    return 1;
  }
  let nodes;
  try { nodes = await autoLayout(model); }
  catch (error) {
    io.err(`Não foi possível organizar o diagrama: ${error instanceof Error ? error.message : String(error)}. Nada foi gravado.`);
    return 2;
  }

  const before = opened.data;
  const { data, slug } = addItem(before, 'diagram', args.title ?? defaultTitle(graph), { model, layout: { nodes, edges: {} } });
  const hadContext = (await opened.adapter.read('context/ARCHITECTURE.md')) !== null;
  const state = parseCloudState(await opened.adapter.read(CLOUD_STATE_PATH));
  for (const problem of state.errors) io.err(`aviso: ${problem} O arquivo será reescrito.`);
  const origin = graph.origin;
  const next = withSource(state.state, { diagram: slug, origin, scope: graph.scope, resources: trackResources(graph, drawn.nodes) });
  await writeWorkspace(opened.adapter, data, before);
  await opened.adapter.write(CLOUD_STATE_PATH, printCloudState(next));
  if (hadContext) {
    for (const [path, text] of Object.entries(contextFiles(data))) if ((await opened.adapter.read(path)) !== text) await opened.adapter.write(path, text);
  }

  const seen = new Set<string>();
  for (const diagnostic of [...graph.diagnostics, ...drawn.result.diagnostics]) {
    if (seen.has(diagnostic.message)) continue;
    seen.add(diagnostic.message);
    io.err(`aviso: ${diagnostic.message}`);
  }
  const drawnNodes = model.order.filter((id) => model.elements[id]?.kind === 'node').length;
  io.out(`Diagrama "${slug}" criado a partir de ${PROVIDER_NAME[origin]}: ${drawnNodes} componente${drawnNodes === 1 ? '' : 's'}, ${model.edges.length} conexõe${model.edges.length === 1 ? '' : 's'}; ${graph.resources.length} recurso${graph.resources.length === 1 ? '' : 's'} registrado${graph.resources.length === 1 ? '' : 's'} em .arch/${CLOUD_STATE_PATH}.`);
  io.out(`Compare depois com o estado vivo: joinlet check --cloud ${origin === 'terraform' ? '<arquivo>' : origin}.`);
  return 0;
}
