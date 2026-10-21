import { applyOps, emptyModel } from '@strukt/core';
import type { Connector, DiagramModel, DiagramOp, Shape } from '@strukt/core';
import { CONNECTORS, SHAPES } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { importArchitecture } from './import';
import { printMermaid } from './mermaid';

function build(ops: DiagramOp[]): DiagramModel {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}
const named = (label: string) => build([{ op: 'add_node', id: 'A', label }]);

describe('printMermaid', () => {
  it('prints labeled edges with synthetic ids', () => {
    const m = build([
      { op: 'add_node', id: 'API' }, { op: 'add_node', id: 'DB' },
      { op: 'connect', from: 'API', to: 'DB', label: 'lê' },
    ]);
    expect(printMermaid(m)).toBe(['flowchart LR', '  n0["API"]', '  n1["DB"]', '  n0 -->|"lê"| n1', ''].join('\n'));
  });

  it('prints an empty diagram as a bare header', () => {
    expect(printMermaid(emptyModel())).toBe('flowchart LR\n');
  });

  it('maps the diagram direction', () => {
    expect(printMermaid(build([{ op: 'set_style', set: { direction: 'down' } }]))).toBe('flowchart TB\n');
    expect(printMermaid(build([{ op: 'set_style', set: { direction: 'left' } }]))).toBe('flowchart RL\n');
    expect(printMermaid(build([{ op: 'set_style', set: { direction: 'up' } }]))).toBe('flowchart BT\n');
  });

  it('prints nested groups as subgraphs', () => {
    const m = build([
      { op: 'add_group', id: 'VPC', label: 'Rede' },
      { op: 'add_group', id: 'Sub', parentId: 'VPC' },
      { op: 'add_node', id: 'API', parentId: 'Sub' },
      { op: 'add_node', id: 'Web', parentId: 'VPC' },
      { op: 'add_node', id: 'DB' },
      { op: 'connect', from: 'API', to: 'DB' },
    ]);
    expect(printMermaid(m)).toBe([
      'flowchart LR',
      '  subgraph n0["Rede"]',
      '    subgraph n1["Sub"]',
      '      n2["API"]',
      '    end',
      '    n3["Web"]',
      '  end',
      '  n4["DB"]',
      '  n2 --> n4',
      '',
    ].join('\n'));
  });

  it('maps every connector to valid syntax', () => {
    const expected: Record<Connector, string> = {
      '>': 'n0 --> n1', '<': 'n1 --> n0', '<>': 'n0 <--> n1', '-': 'n0 --- n1', '--': 'n0 -.- n1', '-->': 'n0 -.-> n1',
    };
    for (const connector of CONNECTORS) {
      const m = build([{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }, { op: 'connect', from: 'A', to: 'B', connector }]);
      expect(printMermaid(m)).toContain(`  ${expected[connector]}\n`);
    }
  });

  it('maps every shape to a distinct bracket family with a default', () => {
    const seen = new Set<string>();
    for (const shape of SHAPES) {
      const line = printMermaid(build([{ op: 'add_node', id: 'A', shape: shape as Shape }])).split('\n')[1]!;
      expect(line).toMatch(/^ {2}n0\S+"A"\S+$/);
      seen.add(line);
    }
    expect(seen.size).toBeGreaterThan(6);
    expect(printMermaid(build([{ op: 'add_node', id: 'A', shape: 'diamond' }]))).toContain('n0{"A"}');
    expect(printMermaid(build([{ op: 'add_node', id: 'A', shape: 'cylinder' }]))).toContain('n0[("A")]');
    expect(printMermaid(build([{ op: 'add_node', id: 'A' }]))).toContain('n0["A"]');
  });

  it('cannot be broken out of by hostile labels', () => {
    const hostile = ['a"]\nb', '"] --> x', 'end', '%% comment', '`md`', 'a --> b', '<script>&amp;', 'x\r\ny\u2028z', '|]|', '#quot;'];
    for (const label of hostile) {
      const text = printMermaid(named(label));
      const lines = text.split('\n');
      expect(lines).toEqual(['flowchart LR', expect.stringMatching(/^ {2}n0\["[^"\n]*"\]$/), '']);
      expect(lines[1]!.slice(6, -2).replaceAll('<br/>', '')).not.toMatch(/[`<>&%|]/);
      expect(lines[1]).not.toMatch(/%%/);
    }
    expect(printMermaid(named('a"b\nc'))).toContain('["a#quot;b<br/>c"]');
  });

  it('escapes hostile edge and group labels too', () => {
    const m = build([
      { op: 'add_group', id: 'G', label: 'g"\nend' }, { op: 'add_node', id: 'A', parentId: 'G' }, { op: 'add_node', id: 'B' },
      { op: 'connect', from: 'A', to: 'B', label: '"|\n--> x' },
    ]);
    const lines = printMermaid(m).split('\n');
    expect(lines).toContain('  subgraph n0["g#quot;<br/>end"]');
    expect(lines.filter((l) => l.includes('-->'))).toEqual(['  n1 -->|"#quot;#124;<br/>--#gt; x"| n2']);
  });

  it('handles hostile ids', () => {
    const m = build([
      { op: 'add_node', id: 'constructor' }, { op: 'add_node', id: 'toString' },
      { op: 'connect', from: 'constructor', to: 'toString' },
    ]);
    expect(printMermaid(m)).toBe(['flowchart LR', '  n0["constructor"]', '  n1["toString"]', '  n0 --> n1', ''].join('\n'));
  });

  it('skips edges whose endpoints are missing', () => {
    const m = build([{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }, { op: 'connect', from: 'A', to: 'B' }]);
    const broken: DiagramModel = { ...m, edges: [...m.edges, { id: 'x', from: 'A', to: 'ghost', connector: '>' }, { id: 'y', from: 'constructor', to: 'B', connector: '>' }] };
    expect(printMermaid(broken)).toBe(['flowchart LR', '  n0["A"]', '  n1["B"]', '  n0 --> n1', ''].join('\n'));
  });

  it('is deterministic', () => {
    const m = build([{ op: 'add_node', id: 'A' }, { op: 'add_group', id: 'G' }, { op: 'add_node', id: 'B', parentId: 'G' }, { op: 'connect', from: 'A', to: 'B', label: 'x' }]);
    expect(printMermaid(m)).toBe(printMermaid(structuredClone(m)));
  });

  it('round-trips through the Mermaid importer (structure, ignoring ids)', () => {
    const m = build([
      { op: 'add_group', id: 'VPC', label: 'Rede' },
      { op: 'add_node', id: 'API', label: 'Gateway', parentId: 'VPC' },
      { op: 'add_node', id: 'Q', label: 'Decide?', shape: 'diamond' },
      { op: 'add_node', id: 'DB', label: 'Banco' },
      { op: 'connect', from: 'API', to: 'Q', label: 'lê' },
      { op: 'connect', from: 'Q', to: 'DB', connector: '-' },
      { op: 'connect', from: 'API', to: 'DB', connector: '-->' },
    ]);
    const back = importArchitecture(printMermaid(m), 'mermaid');
    expect(back.diagnostics).toEqual([]);
    const shape = (model: DiagramModel) => {
      const label = (id: string) => model.elements[id]!.label ?? id;
      return {
        nodes: model.order.map((id) => ({ kind: model.elements[id]!.kind, label: label(id), parent: model.elements[id]!.parentId ? label(model.elements[id]!.parentId!) : null })),
        edges: model.edges.map((e) => ({ from: label(e.from), to: label(e.to), connector: e.connector, label: e.label ?? null })),
      };
    };
    expect(shape(back.model)).toEqual(shape(m));
  });

  it('keeps click / init directives inert inside labels', () => {
    const hostile = ['x"\nclick n0 call alert()', '%%{init: {"securityLevel":"loose"}}%%', 'click n0 href "javascript:alert(1)"', 'a\r\n%%{init: {}}%%'];
    for (const label of hostile) {
      const m = named(label);
      const lines = printMermaid(m).split('\n');
      expect(lines).toHaveLength(3);
      expect(lines.some((l) => /^\s*click\b/.test(l) || l.includes('%%'))).toBe(false);
      expect(lines[1]).toMatch(/^ {0,2}n0\["[^"]*"\]$/);
    }
  });
});
