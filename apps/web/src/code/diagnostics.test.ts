import { describe, expect, it } from 'vitest';
import { toCmDiagnostics } from './diagnostics';

describe('toCmDiagnostics', () => {
  it('maps severity, message and span, clamping to the document', () => {
    expect(toCmDiagnostics([{ severity: 'error', message: 'x', span: { from: 2, to: 99 } }], 10)).toEqual([
      { from: 2, to: 10, severity: 'error', message: 'x', source: 'strukt' },
    ]);
    expect(toCmDiagnostics([{ severity: 'warning', message: 'y', span: { from: 20, to: 30 } }], 10)).toEqual([
      { from: 10, to: 10, severity: 'warning', message: 'y', source: 'strukt' },
    ]);
  });

  it('keeps a zero-length span (a point) valid', () => {
    expect(toCmDiagnostics([{ severity: 'error', message: 'z', span: { from: 0, to: 0 } }], 5)).toEqual([
      { from: 0, to: 0, severity: 'error', message: 'z', source: 'strukt' },
    ]);
  });
});
