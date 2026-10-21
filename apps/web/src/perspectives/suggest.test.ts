import { applyOps, emptyModel } from '@strukt/core';
import type { DiagramOp } from '@strukt/core';
import { emptyShared } from '@strukt/workspace';
import { describe, expect, it } from 'vitest';
import { levelCounts, proposeLevels } from './suggest';

const model = (() => {
  const ops: DiagramOp[] = [{ op: 'add_node', id: 'Usuário', label: 'Pessoa usuária' }, { op: 'add_group', id: 'Sistema' }, { op: 'add_node', id: 'API', parentId: 'Sistema', tech: 'Node' }];
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
})();
const shared = { ...emptyShared(), entities: { u: { id: 'u', tags: ['nivel:contexto', 'risco:alto'] } }, views: { d: { Usuário: 'u' } } };

describe('proposeLevels', () => {
  it('proposes for what has no level, with the label to show and everything accepted to start with', () => {
    expect(proposeLevels(model, shared, 'd')).toEqual([
      expect.objectContaining({ id: 'Sistema', label: 'Sistema', level: 'contexto', accepted: true }),
      expect.objectContaining({ id: 'API', label: 'API', level: 'container', accepted: true }),
    ]);
  });

  it('proposes for everything when the workspace has no shared model yet', () => {
    expect(proposeLevels(model, undefined, 'd').map((item) => item.id)).toEqual(['Usuário', 'Sistema', 'API']);
    expect(proposeLevels(model, undefined, 'd')[0]!.label).toBe('Pessoa usuária');
  });
});

describe('levelCounts', () => {
  it('counts the elements of each level and those without one', () => {
    expect(levelCounts(model, shared, 'd')).toEqual({ contexto: 1, container: 0, componente: 0, none: 2 });
  });
});
