import { applyOps, emptyModel } from '@strukt/core';
import type { DiagramModel, DiagramOp } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { parseDiagramJson } from './parse';
import { printDiagramJson } from './print';

function build(ops: DiagramOp[]): DiagramModel {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

describe('printDiagramJson', () => {
  it('prints an empty diagram with the fixed key order and a trailing newline', () => {
    expect(printDiagramJson(emptyModel())).toBe(
      ['{', '  "$schema": "./strukt.schema.json",', '  "version": 1,', '  "nodes": [],', '  "connections": []', '}', ''].join('\n'),
    );
  });

  it('nests children in groups, omits defaults and keeps the canonical key order', () => {
    const m = build([
      { op: 'set_style', set: { direction: 'down', typeface: 'mono' } },
      { op: 'add_group', id: 'VPC', color: 'blue' },
      { op: 'add_node', id: 'API', parentId: 'VPC', icon: 'server', shape: 'rectangle', tech: 'Go 1.23' },
      { op: 'add_group', id: 'Vazio', parentId: 'VPC' },
      { op: 'add_node', id: 'DB', shape: 'cylinder', label: 'Main Server' },
      { op: 'update', id: 'DB', set: { description: 'a\nb' } },
      { op: 'connect', from: 'API', to: 'DB', label: 'SQL', color: '#30a050' },
      { op: 'connect', from: 'DB', to: 'VPC', connector: '-->', color: 'red' },
    ]);
    expect(printDiagramJson(m)).toBe(
      [
        '{',
        '  "$schema": "./strukt.schema.json",',
        '  "version": 1,',
        '  "style": {',
        '    "direction": "down",',
        '    "typeface": "mono"',
        '  },',
        '  "nodes": [',
        '    {',
        '      "id": "VPC",',
        '      "type": "group",',
        '      "color": "blue",',
        '      "children": [',
        '        {',
        '          "id": "API",',
        '          "shape": "rectangle",',
        '          "icon": "server",',
        '          "tech": "Go 1.23"',
        '        },',
        '        {',
        '          "id": "Vazio",',
        '          "type": "group"',
        '        }',
        '      ]',
        '    },',
        '    {',
        '      "id": "DB",',
        '      "label": "Main Server",',
        '      "shape": "cylinder",',
        '      "description": "a\\nb"',
        '    }',
        '  ],',
        '  "connections": [',
        '    {',
        '      "from": "API",',
        '      "to": "DB",',
        '      "label": "SQL",',
        '      "color": "#30a050"',
        '    },',
        '    {',
        '      "from": "DB",',
        '      "to": "VPC",',
        '      "type": "-->",',
        '      "color": "red"',
        '    }',
        '  ]',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('omits style when it is the default and writes only the non-default keys', () => {
    expect(printDiagramJson(emptyModel())).not.toContain('"style"');
    const m = build([{ op: 'set_style', set: { direction: 'left' } }]);
    expect(printDiagramJson(m)).toContain('"style": {\n    "direction": "left"\n  }');
  });

  it('keeps unicode as-is and escapes only what JSON requires', () => {
    const m = build([{ op: 'add_node', id: 'Serviços' }, { op: 'update', id: 'Serviços', set: { label: 'say "hi"' } }]);
    expect(printDiagramJson(m)).toContain('"id": "Serviços"');
    expect(printDiagramJson(m)).toContain('"label": "say \\"hi\\""');
  });

  it('prints groups without children as a group node', () => {
    const m = build([{ op: 'add_group', id: 'G' }]);
    expect(printDiagramJson(m)).toContain('{\n      "id": "G",\n      "type": "group"\n    }');
  });
  describe('models that did not come out of applyOps (merged collaborative edits)', () => {
    /** Built straight from parent pointers, as a merged Yjs doc can describe it. */
    const raw = (entries: Array<[string, 'node' | 'group', string?]>): DiagramModel => {
      const model = emptyModel();
      for (const [id, kind, parentId] of entries) {
        model.elements[id] = { kind, id, ...(parentId === undefined ? {} : { parentId }) };
        model.order.push(id);
      }
      return model;
    };
    const ids = (text: string) => Object.keys(parseDiagramJson(text).model.elements).sort();

    it('prints an element whose parent is gone at the top level instead of dropping it', () => {
      const text = printDiagramJson(raw([['API', 'node'], ['Cache', 'node', 'G1']]));
      expect(ids(text)).toEqual(['API', 'Cache']);
      expect(parseDiagramJson(text).model.elements.Cache!.parentId).toBeUndefined();
    });

    it('prints an element whose parent is a node at the top level', () => {
      const text = printDiagramJson(raw([['API', 'node'], ['Cache', 'node', 'API']]));
      expect(ids(text)).toEqual(['API', 'Cache']);
      expect(parseDiagramJson(text).diagnostics).toEqual([]);
    });

    it('prints a parent cycle once, broken at the greatest id, without looping', () => {
      const text = printDiagramJson(raw([['G1', 'group', 'G2'], ['G2', 'group', 'G1'], ['N', 'node', 'G1'], ['self', 'group', 'self']]));
      const parsed = parseDiagramJson(text);
      expect(parsed.diagnostics).toEqual([]);
      expect(Object.keys(parsed.model.elements).sort()).toEqual(['G1', 'G2', 'N', 'self']);
      expect(parsed.model.elements.G2!.parentId).toBeUndefined();
      expect(parsed.model.elements.G1!.parentId).toBe('G2');
      expect(parsed.model.elements.N!.parentId).toBe('G1');
      expect(parsed.model.elements.self!.parentId).toBeUndefined();
    });

    it('skips order entries without an element and still prints elements missing from the order', () => {
      const model = raw([['A', 'node'], ['B', 'node']]);
      model.order = ['ghost', 'B', 'B'];
      expect(printDiagramJson(model)).toBe(printDiagramJson({ ...model, order: ['B', 'A'] }));
    });
  });
});
