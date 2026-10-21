import type { Diagnostic } from '@codemirror/lint';
import type { Span } from '@strukt/core';

/** Anything with a message, a severity and a span (the DSL and JSON diagnostics share this shape). */
export interface SpanDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  span: Span;
}

/** Diagnostics → CodeMirror lint diagnostics, clamped to the document. */
export function toCmDiagnostics(diagnostics: readonly SpanDiagnostic[], length: number): Diagnostic[] {
  return diagnostics.map((d) => {
    const from = Math.min(d.span.from, length);
    const to = Math.min(Math.max(d.span.to, from), length);
    return { from, to, severity: d.severity, message: d.message, source: 'strukt' };
  });
}
