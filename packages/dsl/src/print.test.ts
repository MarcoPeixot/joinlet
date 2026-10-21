import { applyOps, emptyModel, semanticView } from '@strukt/core';
import type { DiagramModel, DiagramOp } from '@strukt/core';
import { modelArb } from '@strukt/core/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseDsl } from './parse';
import { isBareName, printDsl } from './print';

function build(ops: DiagramOp[]): DiagramModel {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

describe('printDsl', () => {
  it('prints an empty diagram as empty text', () => {
    expect(printDsl(emptyModel())).toBe('');
  });

  it('prints style changes, nested elements and connections in canonical order', () => {
    const m = build([
      { op: 'set_style', set: { direction: 'down', typeface: 'mono' } },
      { op: 'add_group', id: 'VPC', color: 'blue' },
      { op: 'add_node', id: 'API', parentId: 'VPC', icon: 'server', shape: 'rectangle', tech: 'Go 1.23' },
      { op: 'add_group', id: 'Vazio', parentId: 'VPC' },
      { op: 'add_node', id: 'DB', shape: 'cylinder' },
      { op: 'connect', from: 'API', to: 'DB', label: 'SQL', color: '#30a050' },
      { op: 'connect', from: 'DB', to: 'VPC', connector: '-->', color: 'red' },
    ]);
    expect(printDsl(m)).toBe(
      [
        'direction down',
        'typeface mono',
        '',
        'VPC [color: blue] {',
        '  API [shape: rectangle, icon: server, tech: "Go 1.23"]',
        '  Vazio {}',
        '}',
        'DB [shape: cylinder]',
        '',
        'API > DB: SQL [color: "#30a050"]',
        'DB --> VPC: [color: red]',
        '',
      ].join('\n'),
    );
  });

  it('quotes names and values only when needed', () => {
    expect(['API Gateway', 'k8s-api', 'Pub/Sub', 'Serviços'].every(isBareName)).toBe(true);
    expect(['a:b', 'a - b', 'x--y', '-a', 'a-', 'a // b', ' a', 'direction down', 'say "hi"', '[x]'].some(isBareName)).toBe(false);
    const m = build([{ op: 'add_node', id: 'say "hi"' }, { op: 'update', id: 'say "hi"', set: { description: 'a\nb', label: 'Main Server' } }]);
    expect(printDsl(m)).toBe('"say \\"hi\\"" [label: "Main Server", description: "a\\nb"]\n');
  });

  it('parseDsl(printDsl(m)) ≡ m and printing is idempotent', () => {
    fc.assert(
      fc.property(modelArb(), (m) => {
        const text = printDsl(m);
        const parsed = parseDsl(text);
        expect(parsed.diagnostics).toEqual([]);
        expect(semanticView(parsed.model)).toEqual(semanticView(m));
        expect(parsed.model.edges.map((e) => e.id)).toEqual(m.edges.map((e) => e.id));
        expect(printDsl(parsed.model)).toBe(text);
      }),
      { numRuns: 500 },
    );
  });
});

it('round-trips card roles and connection faces',()=>{
 const m=build([{op:'add_node',id:'API',presentation:'card',layoutRole:'entry'},{op:'add_node',id:'Infra',presentation:'card',layoutRole:'shared'},{op:'connect',from:'API',to:'Infra',fromPort:'right',toPort:'top'}]);
 const text=printDsl(m),parsed=parseDsl(text);
 expect(parsed.diagnostics).toEqual([]);expect(semanticView(parsed.model)).toEqual(semanticView(m));
});

it('round-trips table fields with escaped text, cardinalities and participants', () => {
 const m=build([{op:'add_node',id:'Users',presentation:'table',fields:[{name:'user"id',type:'varchar(255)',key:'PK'},{name:'team_id',key:'FK'}]},{op:'add_node',id:'Client',presentation:'participant'},{op:'connect',from:'Users',to:'Client',connector:'-->',fromCardinality:'one',toCardinality:'zero-many'}]);
 const text=printDsl(m),parsed=parseDsl(text);
 expect(parsed.diagnostics).toEqual([]);expect(semanticView(parsed.model)).toEqual(semanticView(m));expect(printDsl(parsed.model)).toBe(text);
 expect(parseDsl('Users [presentation: table, fields: "broken"]').diagnostics.some(diagnostic=>diagnostic.severity==='error')).toBe(true);
});
