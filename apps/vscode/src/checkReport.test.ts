import { describe, expect, it } from 'vitest';
import { parseCheckReport, reportToFileDiagnostics, summarizeReport } from './checkReport';

const report = (extra: Record<string, unknown> = {}) => ({
  ok: false,
  diagrams: [{ slug: 'a', path: 'diagrams/a.strukt.json', diagnostics: [{ severity: 'error', message: 'nodes[0].color: deve ser texto.', line: 3, column: 35, span: { from: 40, to: 41 } }] }],
  evidence: [{ diagram: 'a', id: 'API', path: 'src/api.ts', message: 'Arquivo não encontrado.' }],
  drift: [{ evidenceId: 'a/API', diagram: 'a', element: 'API', path: 'src/api.ts', kind: 'moved', message: 'A linha mudou.' }],
  anchored: 1,
  warnings: ['aviso solto'],
  errors: 2,
  ...extra,
});

describe('parseCheckReport', () => {
  it('reads the CLI report', () => {
    const parsed = parseCheckReport(JSON.stringify(report()));
    expect(parsed).toMatchObject({ ok: true });
  });

  it('refuses text that is not JSON, with a pt-BR reason', () => {
    expect(parseCheckReport('Nenhum workspace')).toEqual({ ok: false, error: expect.stringContaining('JSON') });
    expect(parseCheckReport('')).toEqual({ ok: false, error: expect.stringContaining('vazia') });
  });

  it('refuses a JSON of the wrong shape instead of crashing later', () => {
    expect(parseCheckReport('[]').ok).toBe(false);
    expect(parseCheckReport(JSON.stringify({ diagrams: 'x', errors: 1 })).ok).toBe(false);
    expect(parseCheckReport(JSON.stringify({ ...report(), diagrams: [{ slug: 1 }] })).ok).toBe(false);
  });

  it('tolerates missing optional lists', () => {
    const parsed = parseCheckReport(JSON.stringify({ ok: true, diagrams: [], errors: 0 }));
    expect(parsed).toMatchObject({ ok: true, report: { evidence: [], drift: [], warnings: [] } });
  });

  it('drops malformed diagnostics rather than trusting them', () => {
    const bad = report({ diagrams: [{ slug: 'a', path: 'diagrams/a.strukt.json', diagnostics: [{ severity: 'info', message: 1, line: 'x' }, { severity: 'warning', message: 'ok', line: 2, column: 1 }] }] });
    const parsed = parseCheckReport(JSON.stringify(bad));
    expect(parsed.ok && parsed.report.diagrams[0]!.diagnostics).toEqual([{ severity: 'warning', message: 'ok', line: 2, column: 1 }]);
  });
});

describe('reportToFileDiagnostics', () => {
  const parsed = parseCheckReport(JSON.stringify(report()));
  if (!parsed.ok) throw new Error('fixture');

  it('keys diagnostics by file path inside .arch/ with 0-based positions', () => {
    const files = reportToFileDiagnostics(parsed.report, { strict: false });
    expect(files.get('diagrams/a.strukt.json')).toEqual([{ severity: 'error', message: 'nodes[0].color: deve ser texto.', startLine: 2, startCharacter: 34, endLine: 2, endCharacter: 34 }]);
  });

  it('files evidence issues as errors and drift as warnings on evidence.json line 1', () => {
    const files = reportToFileDiagnostics(parsed.report, { strict: false });
    const evidence = files.get('evidence.json')!;
    expect(evidence.map((d) => d.severity)).toEqual(['error', 'warning']);
    expect(evidence[0]!.message).toContain('a/API');
    expect(evidence[1]!.message).toContain('src/api.ts');
    expect(evidence.every((d) => d.startLine === 0)).toBe(true);
  });

  it('turns drift into errors with strict, but keeps truncation as a warning (same rule as the CLI)', () => {
    const withTruncated = parseCheckReport(JSON.stringify(report({ drift: [{ evidenceId: 'a/API', path: 'x', kind: 'moved', message: 'm' }, { evidenceId: 'a/DB', path: 'y', kind: 'truncated', message: 't' }] })));
    if (!withTruncated.ok) throw new Error('fixture');
    const evidence = reportToFileDiagnostics(withTruncated.report, { strict: true }).get('evidence.json')!;
    expect(evidence.map((d) => d.severity)).toEqual(['error', 'error', 'warning']);
  });

  it('ignores diagram paths that would leave .arch/ (the report is untrusted)', () => {
    const hostile = parseCheckReport(JSON.stringify(report({ diagrams: [{ slug: 'x', path: '../../etc/passwd', diagnostics: [{ severity: 'error', message: 'm', line: 1, column: 1 }] }, { slug: 'y', path: '/abs', diagnostics: [{ severity: 'error', message: 'm', line: 1, column: 1 }] }] })));
    if (!hostile.ok) throw new Error('fixture');
    const files = reportToFileDiagnostics(hostile.report, { strict: false });
    expect([...files.keys()]).toEqual(['evidence.json']);
  });

  it('does not use __proto__ as a key', () => {
    const proto = parseCheckReport(JSON.stringify(report({ diagrams: [{ slug: '__proto__', path: '__proto__', diagnostics: [{ severity: 'error', message: 'm', line: 1, column: 1 }] }] })));
    if (!proto.ok) throw new Error('fixture');
    const files = reportToFileDiagnostics(proto.report, { strict: false });
    expect(files).toBeInstanceOf(Map);
    expect(({} as Record<string, unknown>)['message']).toBeUndefined();
  });
});

describe('summarizeReport', () => {
  it('counts like the CLI (singular/plural, warnings = warnings + drift)', () => {
    const parsed = parseCheckReport(JSON.stringify(report()));
    if (!parsed.ok) throw new Error('fixture');
    expect(summarizeReport(parsed.report, { strict: false })).toBe('1 diagrama, 2 avisos, 2 erros.');
  });

  it('says when everything is fine', () => {
    const parsed = parseCheckReport(JSON.stringify({ ok: true, diagrams: [{ slug: 'a', path: 'diagrams/a.strukt.json', diagnostics: [] }, { slug: 'b', path: 'diagrams/b.strukt.json', diagnostics: [] }], errors: 0 }));
    if (!parsed.ok) throw new Error('fixture');
    expect(summarizeReport(parsed.report, { strict: false })).toBe('2 diagramas, 0 avisos, 0 erros.');
  });
});
