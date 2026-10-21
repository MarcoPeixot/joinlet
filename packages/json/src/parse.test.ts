import { applyOps, emptyModel } from '@strukt/core';
import type { DiagramModel, DiagramOp } from '@strukt/core';
import { modelArb } from '@strukt/core/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { looksLikeJson, MAX_DIAGRAM_JSON, parseDiagramJson } from './parse';
import { printDiagramJson } from './print';

function build(ops: DiagramOp[]): DiagramModel {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

const clean = (m: DiagramModel) => ({ style: m.style, elements: m.elements, order: m.order, edges: m.edges, diagnostics: [] });

describe('parseDiagramJson', () => {
  it('reads the canonical example: groups, connections, style and defaults', () => {
    const text = printDiagramJson(
      build([
        { op: 'set_style', set: { direction: 'down' } },
        { op: 'add_group', id: 'Frontend' },
        { op: 'add_node', id: 'Web App', parentId: 'Frontend', icon: 'react' },
        { op: 'add_node', id: 'API Gateway', tech: 'Nginx' },
        { op: 'connect', from: 'Web App', to: 'API Gateway', label: 'HTTPS' },
      ]),
    );
    const { model, diagnostics } = parseDiagramJson(text);
    expect(diagnostics).toEqual([]);
    expect(model.style.direction).toBe('down');
    expect(model.style.colorMode).toBe('pastel');
    expect(model.order).toEqual(['Frontend', 'Web App', 'API Gateway']);
    expect(model.elements['Web App']).toMatchObject({ kind: 'node', parentId: 'Frontend', icon: 'react' });
    expect(model.edges).toMatchObject([{ id: 'Web App→API Gateway', from: 'Web App', to: 'API Gateway', connector: '>', label: 'HTTPS' }]);
  });

  it('is idempotent and round-trips canonical models', () => {
    fc.assert(
      fc.property(modelArb(), (m) => {
        const text = printDiagramJson(m);
        const parsed = parseDiagramJson(text);
        expect(parsed.diagnostics).toEqual([]);
        expect(printDiagramJson(parsed.model)).toBe(text);
      }),
    );
  });

  it('keeps prototype names as normal ids', () => {
    const { model, diagnostics } = parseDiagramJson('{"version": 1, "nodes": [{"id": "constructor"}, {"id": "toString"}]}');
    expect(diagnostics).toEqual([]);
    expect(Object.keys(model.elements)).toEqual(['constructor', 'toString']);
  });

  it('refuses __proto__ and duplicate ids with a warning', () => {
    const { model, diagnostics } = parseDiagramJson('{"version": 1, "nodes": [{"id": "__proto__"}, {"id": "A"}, {"id": "A"}]}');
    expect(Object.keys(model.elements)).toEqual(['A']);
    expect(diagnostics.map((d) => d.severity)).toEqual(['warning', 'warning']);
    expect(diagnostics[0]!.message).toContain('reservado');
    expect(diagnostics[1]!.message).toContain('mais de uma vez');
  });

  it('reports schema violations with the path and line', () => {
    const text = '{\n  "version": 1,\n  "nodes": [{ "id": "A", "color": 5, "nope": true }]\n}';
    const { model, diagnostics } = parseDiagramJson(text);
    expect(Object.keys(model.elements)).toEqual(['A']);
    expect(diagnostics.map((d) => d.message)).toEqual([
      'nodes[0].color: deve ser texto.',
      'nodes[0].nope: propriedade desconhecida "nope".',
    ]);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', line: 3 });
  });

  it('drops a node without id and a connection to a missing element', () => {
    const text = '{"version": 1, "nodes": [{ "label": "x" }, { "id": "A" }], "connections": [{ "from": "A", "to": "B" }]}';
    const { model, diagnostics } = parseDiagramJson(text);
    expect(Object.keys(model.elements)).toEqual(['A']);
    expect(model.edges).toEqual([]);
    expect(diagnostics.map((d) => d.message)).toEqual([
      'nodes[0]: falta "id".',
      'A conexão 1 ("A" → "B") aponta para um elemento que não existe; ela foi ignorada.',
    ]);
  });

  it('rejects children on a common node', () => {
    const { diagnostics } = parseDiagramJson('{"version": 1, "nodes": [{ "id": "A", "children": [] }]}');
    expect(diagnostics).toEqual([expect.objectContaining({ severity: 'error', message: 'nodes[0].children: propriedade desconhecida "children".' })]);
  });

  it('reports a syntax error with line/column and keeps an empty model', () => {
    const { model, diagnostics } = parseDiagramJson('{\n  "version": 1,\n  "nodes": [}\n}');
    expect(model.order).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', line: 3, column: 13 });
    expect(diagnostics[0]!.message).toContain('JSON inválido');
  });

  it('refuses documents over the size limit', () => {
    const { diagnostics } = parseDiagramJson(`{"version": 1, "nodes": [], "x": "${'a'.repeat(MAX_DIAGRAM_JSON + 1)}"}`);
    expect(diagnostics[0]!.message).toContain('grande demais');
  });
});

describe('looksLikeJson', () => {
  it('detects JSON documents and ignores DSL text', () => {
    expect(looksLikeJson('  {"a": 1}')).toBe(true);
    expect(looksLikeJson('[]')).toBe(true);
    expect(looksLikeJson('A > B')).toBe(false);
    expect(looksLikeJson('')).toBe(false);
  });
});

describe('parseDiagramJson size', () => {
  it('opens a 2000-node diagram', () => {
    const model = build(Array.from({ length: 2000 }, (_, i) => ({ op: 'add_node', id: `Service ${i}`, tech: 'PostgreSQL 16 with pgBouncer', icon: 'postgres' }) as DiagramOp));
    const text = printDiagramJson(model);
    expect(text.length).toBeGreaterThan(200_000);
    const { model: parsed, diagnostics } = parseDiagramJson(text);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(parsed.order).toHaveLength(2000);
  });
});
