import { own } from '@strukt/core';
import { CLOUD_STATE_PATH, compareCloud, parseCloudState } from '@strukt/dsl/import';
import type { CloudDriftFinding, CloudGraph, CloudProvider, CloudSource } from '@strukt/dsl/import';
import type { CommandRunner } from '@strukt/git';
import type { OpenedWorkspace } from '@strukt/workspace/fs';
import type { CliArgs } from './args';
import { CloudCommandRefused } from './cloudAllowlist';
import { collectCloud } from './cloudCollect';
import type { CloudScopeArgs } from './cloudCollect';
import { readTerraformFile, scopeOf } from './commands/importCloud';

export interface CloudCheck {
  findings: CloudDriftFinding[];
  /** Things the person should know that are not drift: unreadable kinds, orphaned sources, a damaged cloud.json. */
  notes: string[];
}

const PROVIDERS = ['aws', 'azure', 'gcp'];

/** The scope a source was imported with, overridden by what the command line names (a profile only ever comes from the command line). */
function effectiveScope(source: CloudSource, args: CliArgs): CloudScopeArgs {
  return {
    ...scopeOf(args),
    ...(args.region ? {} : source.scope.region ? { region: source.scope.region } : {}),
    ...(args.subscription ? {} : source.scope.subscription ? { subscription: source.scope.subscription } : {}),
    ...(args.resourceGroup ? {} : source.scope.resourceGroup ? { resourceGroup: source.scope.resourceGroup } : {}),
    ...(args.project ? {} : source.scope.project ? { project: source.scope.project } : {}),
  };
}

/**
 * `check --cloud aws|azure|gcp|<terraform show -json file>`: compares the diagrams imported with `import cloud` against the live
 * cloud (the user's own CLI, read-only) or a state file. Returns `{ error }` when the comparison could not run at all
 * (no baseline, CLI missing, not signed in): that is an environment problem, not drift.
 */
export async function checkCloud(opened: OpenedWorkspace, args: CliArgs, runner: CommandRunner, env: Record<string, string | undefined> = process.env): Promise<CloudCheck | { error: string }> {
  const target = args.cloud ?? '';
  const live = PROVIDERS.includes(target);
  const parsed = parseCloudState(await opened.adapter.read(CLOUD_STATE_PATH));
  const notes = parsed.errors.map((message) => `${message} Importe de novo com "joinlet import cloud".`);
  const sources = parsed.state.sources.filter((source) => !live || source.origin === target);
  if (!sources.length) {
    return { error: live
      ? `Nenhum diagrama importado de ${target} em .arch/${CLOUD_STATE_PATH}. Rode "joinlet import cloud --provider ${target} …" primeiro.`
      : `Nenhum diagrama importado da nuvem em .arch/${CLOUD_STATE_PATH}. Rode "joinlet import cloud" primeiro.` };
  }

  const graphs = new Map<string, CloudGraph>();
  const graphFor = async (source: CloudSource): Promise<CloudGraph | { error: string }> => {
    if (!live) {
      const cached = graphs.get('file');
      if (cached) return cached;
      const read = await readTerraformFile(target);
      if ('error' in read) return read;
      graphs.set('file', read.graph);
      return read.graph;
    }
    const scope = effectiveScope(source, args);
    const key = JSON.stringify([source.origin, scope]);
    const cached = graphs.get(key);
    if (cached) return cached;
    try {
      const collected = await collectCloud(source.origin as CloudProvider, runner, scope, { env });
      if ('error' in collected) return collected;
      graphs.set(key, collected.graph);
      return collected.graph;
    } catch (error) {
      if (error instanceof CloudCommandRefused) return { error: error.message };
      throw error;
    }
  };

  const findings: CloudDriftFinding[] = [];
  const noted = new Set<string>();
  for (const source of sources) {
    const diagram = own(opened.data.diagrams, source.diagram);
    if (!diagram) {
      notes.push(`A fonte de nuvem aponta para o diagrama "${source.diagram}", que não existe mais; ignorada.`);
      continue;
    }
    const graph = await graphFor(source);
    if ('error' in graph) return graph;
    for (const diagnostic of graph.diagnostics) {
      if (!noted.has(diagnostic.message)) { noted.add(diagnostic.message); notes.push(diagnostic.message); }
    }
    if (graph.unreadable?.length) notes.push(`Não foi possível ler: ${graph.unreadable.join(', ')}. As diferenças desses tipos não foram avaliadas.`);
    const curated = new Set(source.resources.filter((resource) => resource.node !== undefined && !Object.hasOwn(diagram.model.elements, resource.node)).map((resource) => resource.id));
    findings.push(...compareCloud(source, graph, curated));
  }
  return { findings, notes };
}
