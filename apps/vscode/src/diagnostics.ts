import { parseDiagramJson } from '@strukt/json';
import type { JsonDiagnostic } from '@strukt/json';

/** A diagnostic with 0-based positions, the way the editor wants them (no `vscode` types, so it is testable). */
export interface EditorDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

/** More than this floods the Problems panel; the rest is summarised in one warning. */
export const MAX_EDITOR_DIAGNOSTICS = 200;

/** Above this size the file is not parsed on every keystroke (the explicit command still validates it). */
export const LIVE_MAX_CHARS = 1_000_000;

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

/** 0-based line/character (UTF-16, like the editor) of a character offset. */
function positionAt(starts: readonly number[], text: string, offset: number): { line: number; character: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= clamped) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, character: clamped - starts[lo]! };
}

/** Maps parser diagnostics (character spans) onto line/character ranges of `text`. */
export function toEditorDiagnostics(text: string, diagnostics: readonly JsonDiagnostic[]): EditorDiagnostic[] {
  const starts = lineStartsOf(text);
  const shown = diagnostics.slice(0, MAX_EDITOR_DIAGNOSTICS).map((diagnostic): EditorDiagnostic => {
    const from = positionAt(starts, text, diagnostic.span.from);
    const to = positionAt(starts, text, Math.max(diagnostic.span.from, diagnostic.span.to));
    return { severity: diagnostic.severity, message: diagnostic.message, startLine: from.line, startCharacter: from.character, endLine: to.line, endCharacter: to.character };
  });
  const hidden = diagnostics.length - shown.length;
  if (hidden > 0) shown.push({ severity: 'warning', message: `Mais ${hidden} problema${hidden === 1 ? '' : 's'} não mostrado${hidden === 1 ? '' : 's'}; corrija os primeiros e valide de novo.`, startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 });
  return shown;
}

/** Live validation of one open `*.strukt.json`: the same parser (and pt-BR messages) as the app and the CLI. */
export function diagnoseDiagramText(text: string): EditorDiagnostic[] {
  if (text.length > LIVE_MAX_CHARS) {
    return [{ severity: 'warning', message: 'Arquivo grande demais para validar enquanto você digita; use "Joinlet: Validar workspace".', startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 }];
  }
  return toEditorDiagnostics(text, parseDiagramJson(text).diagnostics);
}
