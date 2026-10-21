import { stableStringify } from './json';

/** `snippet` = `fingerprintLines` of the referenced line (±1), recorded when the file was readable at creation time. */
export interface Evidence { path: string; line?: number; contains?: string; snippet?: string }
export type EvidenceIndex = Record<string, Record<string, Evidence[]>>;
export const EVIDENCE_PATH = 'evidence.json';

export function validEvidencePath(path: string): boolean {
  return !!path && !path.startsWith('/') && !/^[A-Za-z]:/.test(path) && !path.includes('\\') && !path.includes('\0') && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

export function parseEvidence(text: string | null): EvidenceIndex {
  if (!text) return {};
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return {}; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: EvidenceIndex = {};
  for (const [diagram, elements] of Object.entries(raw)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(diagram) || !elements || typeof elements !== 'object' || Array.isArray(elements)) continue;
    out[diagram] = {};
    for (const [id, list] of Object.entries(elements)) {
      if (id === '__proto__' || !Array.isArray(list)) continue;
      out[diagram]![id] = list.flatMap((item): Evidence[] => {
        if (!item || typeof item !== 'object') return [];
        const ref = item as Record<string, unknown>;
        if (typeof ref.path !== 'string' || !validEvidencePath(ref.path)) return [];
        return [{ path: ref.path, ...(Number.isInteger(ref.line) && (ref.line as number) > 0 ? { line: ref.line as number } : {}), ...(typeof ref.contains === 'string' && ref.contains ? { contains: ref.contains } : {}), ...(typeof ref.snippet === 'string' && /^[0-9a-f]{8}$/.test(ref.snippet) ? { snippet: ref.snippet } : {}) }];
      });
    }
  }
  return out;
}

export const printEvidence = (index: EvidenceIndex) => stableStringify(index);

/** Line endings are normalised and each line trimmed, so CRLF/LF and re-indentation do not count as drift. */
export function fingerprintLines(lines: readonly string[], line: number): string {
  const text = [line - 1, line, line + 1].map((n) => (lines[n - 1] ?? '').trim()).join('\n');
  let hash = 0x811c9dc5; // FNV-1a 32-bit: small and deterministic, no crypto dependency
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

/** Lines of a file as evidence lines are numbered: CRLF/LF, and the empty piece after a final newline is not a line. */
export function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Copy of `ref` with `snippet` filled from the file text (no-op without a line or when the line does not exist). */
export function withSnippet(ref: Evidence, content: string): Evidence {
  if (!ref.line) return ref;
  const lines = splitLines(content);
  return ref.line > lines.length ? ref : { ...ref, snippet: fingerprintLines(lines, ref.line) };
}

/**
 * `snippet-changed`: the recorded snippet is nowhere in the file (code rewritten), as opposed to `snippet-moved`
 * (found on another line, `suggestedLine` says where). `truncated` is only the neutral "more findings were omitted" summary.
 */
export type DriftKind = 'missing-file' | 'line-out-of-range' | 'snippet-moved' | 'snippet-changed' | 'truncated';
export interface DriftFinding {
  /** `<diagram>/<element id>` (edges use `edge:<id>`). */
  evidenceId: string;
  diagram: string;
  element: string;
  path: string;
  kind: DriftKind;
  message: string;
  suggestedLine?: number;
}

export const MAX_DRIFT_BYTES = 2 * 1024 * 1024;
/** True when `text` is longer than `MAX_DRIFT_BYTES` in UTF-8 bytes (the cap is on disk size, not UTF-16 units). */
export function exceedsDriftBytes(text: string): boolean {
  if (text.length > MAX_DRIFT_BYTES) return true;
  return text.length * 3 > MAX_DRIFT_BYTES && new TextEncoder().encode(text).length > MAX_DRIFT_BYTES;
}

export const MAX_DRIFT_FINDINGS = 500;
/** Total lines the `contains` fallback may scan across all references in one run. */
export const MAX_CONTAINS_SCAN_LINES = 5_000_000;

interface FileLines { lines: string[]; truncated: boolean; index?: Map<string, number[]> }

/** Closest value of the sorted `list` to `target`. */
function nearest(list: readonly number[], target: number): number {
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]! < target) lo = mid + 1; else hi = mid;
  }
  const after = list[lo]!;
  const before = lo > 0 ? list[lo - 1]! : after;
  return Math.abs(before - target) <= Math.abs(after - target) ? before : after;
}

/**
 * Compares evidence with the repository. `read` gets a repo-relative path already validated (never `..`, absolute,
 * drive letters or NUL) and returns the text or null; only the first 2 MB of each file is considered. Each file is
 * split and fingerprinted at most once, however many references point at it. With `skipMissingFile`, missing files
 * produce no finding (the caller already reports them), so the finding cap only counts real drift. The `contains`
 * fallback scans each (file, text) pair once and at most `scanBudget` lines in total; past that it stops and adds a
 * single neutral `truncated` finding.
 */
export function checkEvidenceDrift(evidence: EvidenceIndex, read: (repoRelativePath: string) => string | null, options: { skipMissingFile?: boolean; scanBudget?: number } = {}): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const files = new Map<string, FileLines | null>();
  let dropped = 0;
  let budget = options.scanBudget ?? MAX_CONTAINS_SCAN_LINES;
  let scanExhausted = false;
  const containsCache = new Map<string, number[]>();
  const push = (finding: DriftFinding) => {
    if (finding.kind === 'missing-file' && options.skipMissingFile) return;
    if (findings.length < MAX_DRIFT_FINDINGS) findings.push(finding); else dropped++;
  };
  const load = (path: string): FileLines | null => {
    if (files.has(path)) return files.get(path)!;
    const raw = read(path);
    const big = raw !== null && exceedsDriftBytes(raw);
    const file = raw === null ? null : { lines: splitLines(big ? raw.slice(0, MAX_DRIFT_BYTES) : raw), truncated: big };
    files.set(path, file);
    return file;
  };
  const lineOf = (file: FileLines, snippet: string): number[] | undefined => {
    if (!file.index) {
      file.index = new Map();
      for (let n = 1; n <= file.lines.length; n++) {
        const key = fingerprintLines(file.lines, n);
        const list = file.index.get(key);
        if (list) list.push(n); else file.index.set(key, [n]);
      }
    }
    return file.index.get(snippet);
  };
  for (const [diagram, elements] of Object.entries(evidence)) {
    for (const [element, refs] of Object.entries(elements)) {
      for (const ref of refs) {
        const base = { evidenceId: `${diagram}/${element}`, diagram, element, path: ref.path };
        if (!validEvidencePath(ref.path)) { push({ ...base, kind: 'missing-file', message: 'Caminho inválido.' }); continue; }
        const file = load(ref.path);
        if (!file) { push({ ...base, kind: 'missing-file', message: 'Arquivo não encontrado.' }); continue; }
        if (!ref.line) continue;
        const { lines, truncated } = file;
        if (ref.line > lines.length) {
          if (!truncated) push({ ...base, kind: 'line-out-of-range', message: `Linha ${ref.line} não existe (o arquivo tem ${lines.length}).` });
          continue;
        }
        if (truncated) continue;
        if (ref.snippet) {
          if (fingerprintLines(lines, ref.line) === ref.snippet) continue;
          const candidates = lineOf(file, ref.snippet);
          if (candidates) { const best = nearest(candidates, ref.line); push({ ...base, kind: 'snippet-moved', suggestedLine: best, message: `O trecho mudou da linha ${ref.line} para a ${best}.` }); }
          else push({ ...base, kind: 'snippet-changed', message: `O trecho da linha ${ref.line} não foi encontrado; o código pode ter sido reescrito.` });
        } else if (ref.contains && !lines[ref.line - 1]!.includes(ref.contains)) {
          // `check` already errors on the recorded line; here we only suggest where the text went.
          const key = `${ref.path}\0${ref.contains}`;
          let matches = containsCache.get(key);
          if (!matches) {
            if (scanExhausted || lines.length > budget) { scanExhausted = true; continue; }
            budget -= lines.length;
            matches = [];
            for (let n = 1; n <= lines.length; n++) if (lines[n - 1]!.includes(ref.contains)) matches.push(n);
            containsCache.set(key, matches);
          }
          const best = matches.length ? nearest(matches, ref.line) : 0;
          if (best) push({ ...base, kind: 'snippet-moved', suggestedLine: best, message: `O trecho mudou da linha ${ref.line} para a ${best}.` });
        }
      }
    }
  }
  if (dropped) findings.push({ evidenceId: '', diagram: '', element: '', path: '', kind: 'truncated', message: `Mais ${dropped} achado(s) omitido(s) (limite de ${MAX_DRIFT_FINDINGS}).` });
  if (scanExhausted) findings.push({ evidenceId: '', diagram: '', element: '', path: '', kind: 'truncated', message: 'busca por trecho interrompida por limite' });
  return findings;
}
