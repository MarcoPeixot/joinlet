import { describe, expect, it } from 'vitest';
import { diagnoseDiagramText, LIVE_MAX_CHARS, MAX_EDITOR_DIAGNOSTICS, toEditorDiagnostics } from './diagnostics';
import { parseDiagramJson } from '@strukt/json';

const GOOD = '{\n  "version": 1,\n  "nodes": [{ "id": "API" }, { "id": "DB" }],\n  "connections": [{ "from": "API", "to": "DB" }]\n}\n';

describe('toEditorDiagnostics', () => {
  it('turns the parser span into a 0-based range on the right line', () => {
    const text = '{\n  "version": 1,\n  "nodes": [{ "id": "A", "color": 5 }]\n}\n';
    const [diagnostic] = toEditorDiagnostics(text, parseDiagramJson(text).diagnostics);
    expect(diagnostic).toMatchObject({ severity: 'error', startLine: 2 });
    expect(diagnostic!.message).toContain('nodes[0].color');
    const line = text.split('\n')[2]!;
    expect(line.slice(diagnostic!.startCharacter, diagnostic!.endCharacter)).toBe('5');
  });

  it('spans several lines when the parser span does', () => {
    const text = '{\n  "version": 1,\n  "nodes": {\n    "a": 1\n  }\n}\n';
    const found = toEditorDiagnostics(text, parseDiagramJson(text).diagnostics);
    expect(found.length).toBeGreaterThan(0);
    const multi = found.find((d) => d.endLine > d.startLine);
    expect(multi).toMatchObject({ startLine: 2, endLine: 4 });
  });

  it('keeps severity and maps duplicate keys to warnings', () => {
    const text = '{\n  "version": 1,\n  "nodes": [],\n  "nodes": []\n}\n';
    const found = toEditorDiagnostics(text, parseDiagramJson(text).diagnostics);
    expect(found).toContainEqual(expect.objectContaining({ severity: 'warning' }));
  });

  it('puts an invalid JSON error at the offending character', () => {
    const text = '{\n  "version": 1,\n  "nodes": [\n';
    const [diagnostic] = toEditorDiagnostics(text, parseDiagramJson(text).diagnostics);
    expect(diagnostic!.message).toContain('JSON inválido');
    expect(diagnostic!.startLine).toBeGreaterThanOrEqual(2);
  });

  it('clamps spans that fall past the end of the text', () => {
    const [diagnostic] = toEditorDiagnostics('abc', [{ severity: 'error', message: 'x', line: 1, column: 1, span: { from: 1, to: 999 } }]);
    expect(diagnostic).toMatchObject({ startLine: 0, startCharacter: 1, endLine: 0, endCharacter: 3 });
  });

  it('never ends before it starts, even with an inverted span', () => {
    const [diagnostic] = toEditorDiagnostics('abcdef', [{ severity: 'error', message: 'x', line: 1, column: 1, span: { from: 4, to: 2 } }]);
    expect(diagnostic).toMatchObject({ startCharacter: 4, endCharacter: 4 });
  });

  it('handles CRLF line endings and astral characters like the editor does (UTF-16 columns)', () => {
    const text = '{\r\n  "version": 1,\r\n  "nodes": [{ "id": "😀", "color": 5 }]\r\n}\r\n';
    const [diagnostic] = toEditorDiagnostics(text, parseDiagramJson(text).diagnostics);
    const line = text.split('\r\n')[2]!;
    expect(diagnostic!.startLine).toBe(2);
    expect(line.slice(diagnostic!.startCharacter, diagnostic!.endCharacter)).toBe('5');
  });

  it('caps the list and says how many were left out', () => {
    const many = Array.from({ length: MAX_EDITOR_DIAGNOSTICS + 25 }, (_, i) => ({ severity: 'error' as const, message: `e${i}`, line: 1, column: 1, span: { from: 0, to: 1 } }));
    const found = toEditorDiagnostics('abc', many);
    expect(found).toHaveLength(MAX_EDITOR_DIAGNOSTICS + 1);
    expect(found.at(-1)).toMatchObject({ severity: 'warning', message: expect.stringContaining('25') });
  });
});

describe('diagnoseDiagramText', () => {
  it('is empty for a valid diagram', () => {
    expect(diagnoseDiagramText(GOOD)).toEqual([]);
  });

  it('reports semantic errors the schema alone cannot (unknown connection ends)', () => {
    const text = GOOD.replace('"to": "DB"', '"to": "Fantasma"');
    const found = diagnoseDiagramText(text);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]!.startLine).toBe(3);
  });

  it('does not parse a huge file on every keystroke', () => {
    const found = diagnoseDiagramText(' '.repeat(LIVE_MAX_CHARS + 1));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: 'warning', startLine: 0, message: expect.stringContaining('Joinlet: Validar workspace') });
  });
});
