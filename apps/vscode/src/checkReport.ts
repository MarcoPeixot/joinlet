import type { EditorDiagnostic } from './diagnostics';
import { archRelative } from './workspaceRoots';

export interface ReportDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  /** 1-based, as printed by the CLI. */
  line: number;
  column: number;
}

export interface CheckReport {
  diagrams: { slug: string; path: string; diagnostics: ReportDiagnostic[] }[];
  evidence: { diagram: string; id: string; path: string; message: string }[];
  drift: { evidenceId: string; path: string; kind: string; message: string }[];
  warnings: string[];
  errors: number;
}

export type ParsedReport = { ok: true; report: CheckReport } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function reportDiagnostic(value: unknown): ReportDiagnostic | null {
  if (!isRecord(value)) return null;
  const { severity, message, line, column } = value;
  if ((severity !== 'error' && severity !== 'warning') || !isString(message) || typeof line !== 'number' || typeof column !== 'number') return null;
  return { severity, message, line, column };
}

/** Reads the stdout of `joinlet check --json`. It crosses a process boundary, so every field is checked. */
export function parseCheckReport(stdout: string): ParsedReport {
  if (!stdout.trim()) return { ok: false, error: 'A CLI devolveu uma resposta vazia.' };
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return { ok: false, error: 'A resposta da CLI não é um JSON válido (a versão da CLI pode ser antiga demais para --json).' };
  }
  if (!isRecord(raw) || !Array.isArray(raw['diagrams']) || typeof raw['errors'] !== 'number') {
    return { ok: false, error: 'A resposta da CLI não tem o formato esperado do relatório do joinlet check.' };
  }
  const diagrams: CheckReport['diagrams'] = [];
  for (const item of raw['diagrams']) {
    if (!isRecord(item) || !isString(item['slug']) || !isString(item['path']) || !Array.isArray(item['diagnostics'])) {
      return { ok: false, error: 'A resposta da CLI traz um diagrama fora do formato esperado.' };
    }
    const diagnostics = item['diagnostics'].map(reportDiagnostic).filter((d): d is ReportDiagnostic => d !== null);
    diagrams.push({ slug: item['slug'], path: item['path'], diagnostics });
  }
  const evidence = list(raw['evidence']).flatMap((item) =>
    isRecord(item) && isString(item['diagram']) && isString(item['id']) && isString(item['path']) && isString(item['message'])
      ? [{ diagram: item['diagram'], id: item['id'], path: item['path'], message: item['message'] }]
      : [],
  );
  const drift = list(raw['drift']).flatMap((item) =>
    isRecord(item) && isString(item['evidenceId']) && isString(item['path']) && isString(item['kind']) && isString(item['message'])
      ? [{ evidenceId: item['evidenceId'], path: item['path'], kind: item['kind'], message: item['message'] }]
      : [],
  );
  return { ok: true, report: { diagrams, evidence, drift, warnings: list(raw['warnings']).filter(isString), errors: raw['errors'] } };
}

const whole = (diagnostic: ReportDiagnostic): EditorDiagnostic => ({
  severity: diagnostic.severity,
  message: diagnostic.message,
  startLine: Math.max(0, diagnostic.line - 1),
  startCharacter: Math.max(0, diagnostic.column - 1),
  endLine: Math.max(0, diagnostic.line - 1),
  endCharacter: Math.max(0, diagnostic.column - 1),
});

const atTop = (severity: 'error' | 'warning', message: string): EditorDiagnostic => ({ severity, message, startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 });

/**
 * Diagnostics per file, keyed by the path inside `.arch/` (a Map: no key from the report can hit `__proto__`).
 * Evidence and drift have no line of their own; the CLI prints them at `evidence.json:1:1` and so do we.
 * The CLI only has line/column (no text), so the range is a point; open files get exact ranges from the live parser.
 */
export function reportToFileDiagnostics(report: CheckReport, options: { strict: boolean }): Map<string, EditorDiagnostic[]> {
  const files = new Map<string, EditorDiagnostic[]>();
  const add = (path: string, diagnostics: EditorDiagnostic[]): void => {
    if (!diagnostics.length) return;
    files.set(path, [...(files.get(path) ?? []), ...diagnostics]);
  };
  for (const diagram of report.diagrams) {
    const path = archRelative(diagram.path);
    if (path !== null) add(path, diagram.diagnostics.map(whole));
  }
  add('evidence.json', report.evidence.map((issue) => atTop('error', `${issue.diagram}/${issue.id} (${issue.path}): ${issue.message}`)));
  add(
    'evidence.json',
    report.drift.map((finding) => atTop(options.strict && finding.kind !== 'truncated' ? 'error' : 'warning', `${finding.evidenceId || 'evidências'}${finding.path ? ` (${finding.path})` : ''}: ${finding.message}`)),
  );
  return files;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The same one-line summary `joinlet check` prints. */
export function summarizeReport(report: CheckReport, options: { strict: boolean }): string {
  const drift = options.strict ? report.drift.filter((finding) => finding.kind === 'truncated') : report.drift;
  return `${plural(report.diagrams.length, 'diagrama', 'diagramas')}, ${plural(report.warnings.length + drift.length, 'aviso', 'avisos')}, ${plural(report.errors, 'erro', 'erros')}.`;
}
