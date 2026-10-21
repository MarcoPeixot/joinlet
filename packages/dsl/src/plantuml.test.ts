import { applyOps, emptyModel } from '@strukt/core';
import type { Connector, DiagramModel, DiagramOp, Shape } from '@strukt/core';
import { CONNECTORS, SHAPES } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { printPlantUml } from './plantuml';

function build(ops: DiagramOp[]): DiagramModel {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}
const named = (label: string) => build([{ op: 'add_node', id: 'A', label }]);

describe('printPlantUml', () => {
  it('prints labeled edges with aliases', () => {
    const m = build([
      { op: 'add_node', id: 'API' }, { op: 'add_node', id: 'DB', shape: 'cylinder' },
      { op: 'connect', from: 'API', to: 'DB', label: 'lê' },
    ]);
    expect(printPlantUml(m)).toBe([
      '@startuml', 'left to right direction', 'rectangle "API" as n0', 'database "DB" as n1', 'n0 --> n1 : lê', '@enduml', '',
    ].join('\n'));
  });

  it('prints an empty diagram', () => {
    expect(printPlantUml(emptyModel())).toBe('@startuml\nleft to right direction\n@enduml\n');
    expect(printPlantUml(build([{ op: 'set_style', set: { direction: 'down' } }]))).toBe('@startuml\n@enduml\n');
  });

  it('prints nested groups as packages', () => {
    const m = build([
      { op: 'add_group', id: 'VPC', label: 'Rede' }, { op: 'add_group', id: 'Sub', parentId: 'VPC' },
      { op: 'add_node', id: 'API', parentId: 'Sub' }, { op: 'add_node', id: 'DB' },
      { op: 'connect', from: 'API', to: 'DB' },
    ]);
    expect(printPlantUml(m)).toBe([
      '@startuml', 'left to right direction',
      'package "Rede" as n0 {', '  package "Sub" as n1 {', '    rectangle "API" as n2', '  }', '}',
      'rectangle "DB" as n3', 'n2 --> n3', '@enduml', '',
    ].join('\n'));
  });

  it('maps every connector', () => {
    const expected: Record<Connector, string> = { '>': 'n0 --> n1', '<': 'n0 <-- n1', '<>': 'n0 <--> n1', '-': 'n0 -- n1', '--': 'n0 .. n1', '-->': 'n0 ..> n1' };
    for (const connector of CONNECTORS) {
      const m = build([{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }, { op: 'connect', from: 'A', to: 'B', connector }]);
      expect(printPlantUml(m).split('\n')).toContain(expected[connector]);
    }
  });

  it('maps every shape to a valid element keyword', () => {
    for (const shape of SHAPES) {
      const line = printPlantUml(build([{ op: 'add_node', id: 'A', shape: shape as Shape }])).split('\n')[2]!;
      expect(line).toMatch(/^(rectangle|database|hexagon|file|usecase|queue|artifact|storage|node|cloud|actor|component) "A" as n0$/);
    }
  });

  it('cannot be broken out of by hostile labels', () => {
    for (const label of ['a"\n@enduml', '" as x\n!include /etc/passwd', '%date()%', '<b>x</b>', 'a\\nb', 'x\r\ny\u2028z']) {
      const lines = printPlantUml(named(label)).split('\n');
      expect(lines).toHaveLength(5);
      expect(lines[2]).toMatch(/^rectangle "[^"]*" as n0$/);
      expect(lines.filter((l) => l.startsWith('@'))).toEqual(['@startuml', '@enduml']);
      expect(lines[2]).not.toMatch(/%|<(?!U\+)/);
    }
    expect(printPlantUml(named('a"b\nc'))).toContain('rectangle "a<U+0022>b\\nc" as n0');
  });

  it('does not let [[...]] in a label become a clickable link', () => {
    const out = printPlantUml(named('[[http://evil.example click]]'));
    expect(out).not.toContain('[[');
    expect(out).toContain('rectangle "<U+005B><U+005B>http://evil.example click]]" as n0');
    const m = build([{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }, { op: 'connect', from: 'A', to: 'B', label: '[[http://x]]' }]);
    expect(printPlantUml(m)).not.toContain('[[');
  });

  it('escapes edge labels and handles hostile ids', () => {
    const m = build([
      { op: 'add_node', id: 'constructor' }, { op: 'add_node', id: 'toString' },
      { op: 'connect', from: 'constructor', to: 'toString', label: 'a\n@enduml' },
    ]);
    const lines = printPlantUml(m).split('\n');
    expect(lines).toContain('rectangle "constructor" as n0');
    expect(lines).toContain('n0 --> n1 : a\\n@enduml');
    expect(lines.filter((l) => l === '@enduml')).toHaveLength(1);
  });

  it('skips edges with missing endpoints and is deterministic', () => {
    const m = build([{ op: 'add_node', id: 'A' }]);
    const broken: DiagramModel = { ...m, edges: [{ id: 'x', from: 'A', to: 'ghost', connector: '>' }] };
    expect(printPlantUml(broken)).toBe('@startuml\nleft to right direction\nrectangle "A" as n0\n@enduml\n');
    expect(printPlantUml(m)).toBe(printPlantUml(structuredClone(m)));
  });
});
