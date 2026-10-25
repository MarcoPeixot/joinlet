import { own, syncLayout } from '@strukt/core';
import { autoLayout } from '@strukt/layout';
import { planSnapshot } from '@strukt/ops';
import { writeGeneratedContext } from '@strukt/workspace/context-storage';
import type { WorkspaceData } from '@strukt/workspace';
import { openWorkspaceAt, writeWorkspace, findArchDir, createFsAdapter } from '@strukt/workspace/fs';
import { SYNC_PATH, planSync, renderSyncReport } from '@strukt/workspace/sync';
import type { DiagramSyncPlan, SyncPlan } from '@strukt/workspace/sync';
import type { CliArgs } from '../args';
import type { CliIo } from '../io';

const ARCHITECTURE_PATH = 'context/ARCHITECTURE.md';

/** The diagram plus its positions: new nodes are placed near their neighbours, a diagram with no positions goes through ELK. */
async function applyToDiagram(data: WorkspaceData, plan: DiagramSyncPlan): Promise<WorkspaceData['diagrams'][string]> {
  const snapshot = own(data.diagrams, plan.slug)!;
  const planned = planSnapshot(snapshot.model, snapshot.layout, plan.ops);
  if (!planned.ok) throw new Error(`Não consegui aplicar a sincronização de "${plan.slug}": ${planned.error}`);
  let layout = planned.planned.layout;
  if (planned.planned.autoLayout) {
    try {
      layout = syncLayout(snapshot.layout, planned.planned.model, plan.ops, await autoLayout(planned.planned.model));
    } catch (error) {
      throw new Error(`Não foi possível organizar "${plan.slug}": ${error instanceof Error ? error.message : String(error)}. Nada foi gravado.`);
    }
  }
  return { model: planned.planned.model, layout };
}

/** Machine-readable form of a plan (`--json`). */
function jsonOf(plan: SyncPlan, written: string[]) {
  return {
    ok: plan.errors.length === 0 && plan.problems.length === 0,
    configured: plan.configured,
    stale: plan.stale,
    written,
    errors: plan.errors,
    problems: plan.problems,
    warnings: [...plan.stateWarnings, ...plan.sources.flatMap((source) => source.warnings.map((warning) => `${source.id}: ${warning}`))],
    sources: plan.sources.map(({ id, kind, diagram, mode, files, error }) => ({ id, kind, diagram, mode, files, ...(error ? { error } : {}) })),
    diagrams: plan.diagrams.map((diagram) => ({
      slug: diagram.slug,
      mode: diagram.mode,
      blocked: diagram.blocked,
      added: diagram.changes.elements.added,
      removed: diagram.changes.elements.removed,
      changed: diagram.changes.elements.changed,
      connections: { added: diagram.changes.edges.added.length, removed: diagram.changes.edges.removed.length, changed: diagram.changes.edges.changed.length },
      notes: diagram.notes,
    })),
  };
}

/**
 * `joinlet sync`: imports the repository files listed in `.arch/sources.json` and merges them into the target diagrams
 * (ids, positions and human annotations are kept), then records what it imported in `.arch/sync.json`. `--check` writes
 * nothing and exits 1 when something would change. Only `.arch/` is written (through the confined adapter).
 */
export async function runSync(args: CliArgs, io: CliIo): Promise<number> {
  if(!args.check){const location=await findArchDir(args.dir);if(location)await createFsAdapter(location.archDir).recover();}
  const opened = await openWorkspaceAt(args.dir);
  if (!opened) {
    io.err(`Nenhum workspace do Joinlet encontrado a partir de "${args.dir}" (procurei .arch/strukt.json).`);
    return 2;
  }
  if (await opened.adapter.read('repository.json')) {
    const { RepositoryEngine } = await import('@strukt/workspace/repository');
    const { localReader } = await import('@strukt/workspace/repository-reader');
    const { localRepositoryAi } = await import('../../../server/src/localRepositoryAi');
    const { analyzer } = await localRepositoryAi();
    const result = await new RepositoryEngine(await localReader(opened.root), opened.adapter, analyzer).run({ check: args.check });
    if (args.json) io.out(JSON.stringify({ ...result.status, changed: result.changed }));
    else { io.out(`Joinlet repository: ${result.status.phase}; ${result.changed.length} architecture files changed.`); for (const pending of result.status.pending) io.out(pending); }
    return args.check && (result.changed.length || result.status.pending.length || result.status.proposals.length) ? 1 : 0;
  }
  const plan = await planSync({ root: opened.root, adapter: opened.adapter, data: opened.data });
  const failed = plan.errors.length > 0 || plan.problems.length > 0;
  const written: string[] = [];

  if (plan.configured && plan.problems.length === 0 && !args.check) {
    let data = opened.data;
    for (const diagram of plan.diagrams) {
      if (diagram.blocked || !diagram.ops.length) continue;
      data = { ...data, diagrams: { ...data.diagrams, [diagram.slug]: await applyToDiagram(data, diagram) } };
    }
    written.push(...(await writeWorkspace(opened.adapter, data, opened.data)));
    if (plan.state.changed) {
      if (plan.state.text) await opened.adapter.write(SYNC_PATH, plan.state.text);
      else await opened.adapter.remove(SYNC_PATH);
      written.push(SYNC_PATH);
    }
    if (written.length && (await opened.adapter.read(ARCHITECTURE_PATH)) !== null) {
      written.push(...await writeGeneratedContext(opened.adapter, data));
    }
  }

  if (args.json) io.out(JSON.stringify(jsonOf(plan, written.sort()), null, 2));
  else {
    io.out(renderSyncReport(plan, args.markdown ? 'markdown' : 'text', { applied: !args.check }).trimEnd());
    if (written.length) io.out(`\nGravado em .arch/: ${written.sort().join(', ')}.`);
  }
  if (!plan.configured) return 0;
  if (failed) return 1;
  if (args.check && plan.stale) {
    io.err(`O diagrama está desatualizado em relação às fontes: ${plan.diagrams.filter((d) => d.ops.length).map((d) => d.slug).join(', ') || 'registro de sincronização'}. Rode "joinlet sync" e commite o resultado.`);
    return 1;
  }
  return 0;
}
