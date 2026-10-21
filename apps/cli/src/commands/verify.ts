import { inspectContext } from '@strukt/workspace/context-storage';
import { openWorkspaceAt } from '@strukt/workspace/fs';
import { implementationPlan, planSync } from '@strukt/workspace/sync';
import { checkWorkspace } from './check';
import type { CliArgs } from '../args';
import type { CliIo } from '../io';

/** Read-only harness: schema, anchored code evidence, source drift and generated knowledge in one result. */
export async function runVerify(args: CliArgs, io: CliIo): Promise<number> {
  const opened = await openWorkspaceAt(args.dir);
  if (!opened) { io.err('Nenhum workspace do Joinlet encontrado.'); return 2; }
  const [validation, context, sync] = await Promise.all([
    checkWorkspace(opened, { drift: true, strict: true }),
    inspectContext(opened.adapter, opened.data),
    planSync({ root: opened.root, adapter: opened.adapter, data: opened.data }),
  ]);
  const handoff = implementationPlan(sync, opened.data);
  const coverage = sync.sources.length || validation.anchored ? 'partial' : 'none';
  const review = handoff.diagrams.filter(d => d.reviewRequired).map(d => d.diagram);
  const errors = [
    ...(validation.errors ? ['Workspace validation or anchored code evidence failed.'] : []),
    ...opened.warnings.map(w => `Workspace load: ${w}`),
    ...sync.errors, ...sync.stateWarnings,
    ...(sync.stale ? ['Source synchronization is pending. Run joinlet sync and review the result.'] : []),
    ...(context.stale ? ['Generated knowledge is missing, stale or contains obsolete files. Run joinlet context.'] : []),
    ...(args.strict && coverage === 'none' ? ['No source mappings or anchored code evidence: code consistency cannot be verified.'] : []),
    ...(args.strict && review.length ? [`Architecture and source models differ: ${review.join(', ')}. Review the implementation handoff.`] : []),
    ...(args.strict && validation.drift.some(d => d.kind === 'truncated') ? ['Evidence scan was truncated; verification is incomplete.'] : []),
  ];
  const report = {
    ok: !errors.length, coverage, errors,
    limitations: ['Checks cover configured source formats and anchored evidence only. They do not prove semantic equivalence of arbitrary code or authored documents.'],
    validation, context: { missingInputs: context.missingInputs, missing: context.missing, changed: context.changed, obsolete: context.obsolete },
    sync: { configured: sync.configured, stale: sync.stale, sources: sync.sources }, handoff,
  };
  if (args.json) io.out(JSON.stringify(report, null, 2));
  else {
    io.out(`Joinlet verify: ${report.ok ? 'checks passed' : 'action required'}; code coverage: ${coverage}.`);
    for (const error of errors) io.err(error);
    if (coverage === 'none') io.out('Configure sources.json or anchored evidence to check code changes.');
    if (review.length) io.out(`Implementation review: ${review.join(', ')} (get_implementation_plan).`);
    io.out(report.limitations[0]!);
  }
  return report.ok ? 0 : 1;
}
