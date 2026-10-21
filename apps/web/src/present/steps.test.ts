import { applyOps, emptyModel } from '@strukt/core';
import type { DiagramModel, DiagramOp } from '@strukt/core';
import type { Flow } from '@strukt/workspace';
import { describe, expect, it } from 'vitest';
import { MAX_STEPS, buildPresentationSteps } from './steps';

function build(ops: DiagramOp[]): DiagramModel {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

const grouped = build([
  { op: 'add_group', id: 'Backend', label: 'Backend' },
  { op: 'add_node', id: 'API', label: 'API', parentId: 'Backend' },
  { op: 'add_node', id: 'DB', label: 'Banco', parentId: 'Backend' },
  { op: 'add_group', id: 'Front', label: 'Front' },
  { op: 'add_node', id: 'Web', label: 'Web', parentId: 'Front' },
  { op: 'add_node', id: 'Solo', label: 'Solo' },
  { op: 'connect', from: 'Web', to: 'API', label: 'HTTPS' },
  { op: 'connect', from: 'API', to: 'DB' },
]);

describe('buildPresentationSteps without flows', () => {
  it('starts with an overview, then one step per root group, then "Outros"', () => {
    const steps = buildPresentationSteps(grouped);
    expect(steps.map((s) => s.title)).toEqual(['Visão geral', 'Backend', 'Front', 'Outros']);
    expect(steps[0]!.focus).toEqual(grouped.order);
    expect(steps[1]!.focus).toEqual(['Backend', 'API', 'DB']);
    expect(steps[3]!.focus).toEqual(['Solo']);
  });

  it('lights the edges between the focused elements', () => {
    const steps = buildPresentationSteps(grouped);
    expect(steps[1]!.edges).toHaveLength(1);
    expect(steps[0]!.edges).toHaveLength(2);
  });

  it('is deterministic', () => {
    expect(buildPresentationSteps(grouped)).toEqual(buildPresentationSteps(grouped));
  });

  it('an empty diagram is a single overview step', () => {
    const steps = buildPresentationSteps(emptyModel());
    expect(steps).toHaveLength(1);
    expect(steps[0]!.focus).toEqual([]);
  });

  it('a diagram without groups is just the overview', () => {
    const steps = buildPresentationSteps(build([{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }]));
    expect(steps.map((s) => s.title)).toEqual(['Visão geral']);
  });

  it('handles hostile ids', () => {
    const model = build([
      { op: 'add_group', id: 'constructor', label: 'constructor' },
      { op: 'add_node', id: 'toString', label: 'toString', parentId: 'constructor' },
    ]);
    const steps = buildPresentationSteps(model, [
      { id: 'f', title: 'F', steps: [{ kind: 'process', node: 'hasOwnProperty' }, { kind: 'process', node: 'toString' }] },
    ]);
    expect(steps.map((s) => s.focus)).toEqual([['toString']]);
    expect(buildPresentationSteps(model).map((s) => s.title)).toEqual(['Visão geral', 'constructor']);
  });

  it('caps the number of steps', () => {
    const ops: DiagramOp[] = [];
    for (let i = 0; i < MAX_STEPS + 50; i++) ops.push({ op: 'add_group', id: `G${i}`, label: `G${i}` });
    expect(buildPresentationSteps(build(ops))).toHaveLength(MAX_STEPS);
  });
});

describe('buildPresentationSteps with flows', () => {
  const flows: Flow[] = [
    {
      id: 'f1',
      title: 'Pedido',
      steps: [
        { from: 'Web', to: 'API', note: 'O cliente envia o pedido' },
        { from: 'API', to: 'Ghost' },
        { kind: 'process', node: 'DB', note: 'Grava' },
        { kind: 'goto', diagram: 'x', flowId: 'y' },
      ],
    },
  ];

  it('makes one step per flow step and skips the broken ones', () => {
    const steps = buildPresentationSteps(grouped, flows);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ title: 'Web → API', focus: ['Web', 'API'], note: 'O cliente envia o pedido' });
    expect(steps[0]!.edges).toHaveLength(1);
    expect(steps[1]).toMatchObject({ title: 'Processo em Banco', focus: ['DB'], note: 'Grava' });
  });

  it('falls back to the group walk when every flow step is broken or there are no flows', () => {
    const broken: Flow[] = [{ id: 'b', title: 'B', steps: [{ from: 'A', to: 'Z' }] }];
    expect(buildPresentationSteps(grouped, broken)[0]!.title).toBe('Visão geral');
    expect(buildPresentationSteps(grouped, [])[0]!.title).toBe('Visão geral');
  });

  it('expands parallel steps into frames', () => {
    const parallel: Flow[] = [
      { id: 'p', title: 'P', steps: [{ kind: 'parallel', branches: [{ title: 'A', steps: [{ kind: 'process', node: 'API' }] }, { title: 'B', steps: [{ kind: 'process', node: 'DB' }] }] }] },
    ];
    const steps = buildPresentationSteps(grouped, parallel);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.focus).toEqual(['API', 'DB']);
  });
});
