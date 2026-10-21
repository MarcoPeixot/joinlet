import { applyOps, emptyModel } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { componentFlow } from './componentFlow';

describe('presentation component flow', () => {
  const result = applyOps(emptyModel(), [{ op: 'add_group', id: 'Grupo' }, { op: 'add_node', id: 'A', parentId: 'Grupo' }, ...['B', 'C', 'D', 'Isolado'].map(id => ({ op: 'add_node' as const, id })), { op: 'connect', from: 'A', to: 'B' }, { op: 'connect', from: 'A', to: 'C' }, { op: 'connect', from: 'B', to: 'D' }, { op: 'connect', from: 'C', to: 'D' }, { op: 'connect', from: 'D', to: 'A' }]);
  if (!result.ok) throw new Error(result.error.message);
  it('runs branches together, shows the cycle once and excludes unrelated components', () => {
    const steps = componentFlow(result.model, 'A', 'downstream');
    expect(steps.map(step => step.edges?.length)).toEqual([0, 2, 2, 1]);
    expect(steps.flatMap(step => step.focus)).not.toContain('Isolado');
    expect(new Set(steps.flatMap(step => step.edges ?? [])).size).toBe(5);
  });
  it('walks backwards from the destination and starts a group from its contents', () => {
    expect(componentFlow(result.model, 'D', 'upstream')[1]!.edges).toEqual(['B→D', 'C→D']);
    expect(componentFlow(result.model, 'Grupo', 'downstream')[1]!.edges).toEqual(['A→B', 'A→C']);
    expect(componentFlow(result.model, 'Isolado', 'downstream')).toHaveLength(1);
  });
});
