import { emptyModel } from '@strukt/core';
import type { DiagramElement, DiagramModel } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { buildTree } from './diagramTree';
import { printMermaid } from './mermaid';
import { printPlantUml } from './plantuml';

/** A model straight from pointers, as an untrusted file can describe it. */
function pointers(list: Array<[string, 'group' | 'node', string | undefined]>): DiagramModel {
  const model = emptyModel();
  for (const [id, kind, parentId] of list) {
    model.elements[id] = { kind, id, ...(parentId === undefined ? {} : { parentId }) } as DiagramElement;
    model.order.push(id);
  }
  return model;
}

const names = (roots: ReturnType<typeof buildTree>['roots']): string[] => roots.flatMap((entry) => [entry.element.id, ...names(entry.children)]);

describe('buildTree with parent cycles', () => {
  it('keeps every element: an unreachable cycle is broken at its first member', () => {
    const model = pointers([['a', 'group', 'b'], ['b', 'group', 'c'], ['c', 'group', 'a'], ['leaf', 'node', 'b'], ['free', 'node', undefined]]);
    const { roots } = buildTree(model);
    expect(names(roots).sort()).toEqual(['a', 'b', 'c', 'free', 'leaf']);
    expect(roots.map((r) => r.element.id)).toEqual(['free', 'a']);
  });

  it('a group that is its own parent stays visible', () => {
    expect(names(buildTree(pointers([['g', 'group', 'g']])).roots)).toEqual(['g']);
  });

  it('Mermaid and PlantUML still print every node of a cycle', () => {
    const model = pointers([['a', 'group', 'b'], ['b', 'group', 'a'], ['n', 'node', 'a']]);
    for (const text of [printMermaid(model), printPlantUml(model)]) expect(text.match(/\bn[012]\b/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
