import { SOURCES_PATH, diagramPath, openConcerns, parseSources, validateSourceTargets } from '@strukt/workspace';
import { checkEvidence, checkWorkspaceDrift } from '@strukt/workspace/health';
import type { EvidenceIssue } from '@strukt/workspace/health';
import type { DriftFinding, SourceDiagnostic } from '@strukt/workspace';
import { parseDiagramJson } from '@strukt/json';
import type { JsonDiagnostic } from '@strukt/json';
import { openWorkspaceAt } from '@strukt/workspace/fs';
import type { OpenedWorkspace } from '@strukt/workspace/fs';
import { createProcessRunner } from '@strukt/git';
import type { CommandRunner } from '@strukt/git';
import type { CliArgs } from '../args';
import { checkCloud } from '../cloudDrift';
import type { CloudCheck } from '../cloudDrift';
import type { CliIo } from '../io';

export interface DiagramReport {
  slug: string;
  path: string;
  diagnostics: JsonDiagnostic[];
}

export interface CheckReport {
  diagrams: DiagramReport[];
  evidence: EvidenceIssue[];
  /** Only with `--drift`. Findings are warnings, or errors with `--strict`. `missing-file` is left out: `evidence` already fails on it. */
  drift: DriftFinding[];
  /** Evidence references with a line and a snippet/contains to compare, counted for the `--drift` hint. */
  anchored: number;
  /** Problems in `.arch/sources.json` (invalid entries, missing target diagram); empty without the file. */
  sources: SourceDiagnostic[];
  warnings: string[];
  errors: number;
}

/** Validates the manifest and every diagram; no file is touched. */
export async function checkWorkspace(opened: OpenedWorkspace, options: { drift?: boolean; strict?: boolean } = {}): Promise<CheckReport> {
  const diagrams: DiagramReport[] = [];
  for (const { slug } of opened.data.manifest.diagrams) {
    const path = diagramPath(slug);
    const text = await opened.adapter.read(path);
    diagrams.push({
      slug,
      path,
      diagnostics: text === null
        ? [{ severity: 'error', line: 1, column: 1, span: { from: 0, to: 0 }, message: 'Arquivo do diagrama não encontrado.' }]
        : parseDiagramJson(text).diagnostics,
    });
  }
  const evidence = await checkEvidence(opened.data, opened.root);
  const drift = options.drift ? await checkWorkspaceDrift(opened.data, opened.root, { skipMissingFile: true }) : [];
  const anchored = Object.values(opened.data.evidence ?? {}).reduce((total, elements) => total + Object.values(elements).reduce((sum, refs) => sum + refs.filter((ref) => ref.line && (ref.snippet || ref.contains)).length, 0), 0);
  const sourcesText = await opened.adapter.read(SOURCES_PATH);
  const parsedSources = parseSources(sourcesText);
  const sources = parsedSources.diagnostics.length ? parsedSources.diagnostics : validateSourceTargets(parsedSources.sources, opened.data.manifest.diagrams.map((entry) => entry.slug));
  const errors = evidence.length + sources.length + (options.strict ? drift.filter((finding) => finding.kind !== 'truncated').length : 0) + diagrams.reduce((total, report) => total + report.diagnostics.filter((d) => d.severity === 'error').length, 0);
  const concerns = openConcerns(opened.data.concerns);
  const warnings = concerns.length ? [...opened.warnings, `${concerns.length} pendência(s) de precisão aberta(s) em .arch/concerns.json.`] : opened.warnings;
  return { diagrams, evidence, drift, anchored, sources, warnings, errors };
}

export async function runCheck(args: CliArgs, io: CliIo, runner: CommandRunner = createProcessRunner()): Promise<number> {
  const opened = await openWorkspaceAt(args.dir);
  if (!opened) {
    io.err(`Nenhum workspace do Joinlet encontrado a partir de "${args.dir}" (procurei .arch/strukt.json).`);
    return 2;
  }
  const report = await checkWorkspace(opened, { drift: args.drift, strict: args.strict });
  let cloud: CloudCheck | undefined;
  if (args.cloud !== undefined) {
    const checked = await checkCloud(opened, args, runner);
    if ('error' in checked) {
      io.err(checked.error);
      return 2;
    }
    cloud = checked;
    if (args.strict) report.errors += cloud.findings.filter((finding) => finding.kind !== 'truncated').length;
  }
  if (args.json) {
    io.out(JSON.stringify({ ok: report.errors === 0, ...report, ...(cloud ? { cloud: cloud.findings, cloudNotes: cloud.notes } : {}) }, null, 2));
    return report.errors ? 1 : 0;
  }
  for (const warning of report.warnings) io.err(`aviso: ${warning}`);
  for (const diagram of report.diagrams) {
    for (const diagnostic of diagram.diagnostics) {
      io.out(`${diagram.path}:${diagnostic.line}:${diagnostic.column}: ${diagnostic.severity === 'error' ? 'erro' : 'aviso'}: ${diagnostic.message}`);
    }
  }
  for (const problem of report.sources) io.out(`sources.json:1:1: erro: ${problem.path ? `${problem.path}: ` : ''}${problem.message}`);
  for (const issue of report.evidence) io.out(`evidence.json:1:1: erro: ${issue.diagram}/${issue.id} (${issue.path}): ${issue.message}`);
  for (const finding of report.drift) io.out(`evidence.json:1:1: ${args.strict && finding.kind !== 'truncated' ? 'erro' : 'aviso'}: ${finding.evidenceId || 'evidências'}${finding.path ? ` (${finding.path})` : ''}: ${finding.message}`);
  for (const note of cloud?.notes ?? []) io.err(`aviso: ${note}`);
  for (const finding of cloud?.findings ?? []) io.out(`cloud.json:1:1: ${args.strict && finding.kind !== 'truncated' ? 'erro' : 'aviso'}: ${finding.message}`);
  if (!args.drift && report.anchored) io.err(`aviso: ${report.anchored} evidência${report.anchored === 1 ? '' : 's'} com linha registrada podem estar desatualizadas — rode joinlet check --drift.`);
  const { diagrams } = report;
  const cloudFindings = cloud?.findings ?? [];
  const warnings = args.strict ? [...report.warnings, ...report.drift.filter((finding) => finding.kind === 'truncated'), ...cloudFindings.filter((finding) => finding.kind === 'truncated')] : [...report.warnings, ...report.drift, ...cloudFindings];
  io.out(
    `${diagrams.length} diagrama${diagrams.length === 1 ? '' : 's'}, ${warnings.length} aviso${warnings.length === 1 ? '' : 's'}, ${report.errors} erro${report.errors === 1 ? '' : 's'}.`,
  );
  return report.errors ? 1 : 0;
}
