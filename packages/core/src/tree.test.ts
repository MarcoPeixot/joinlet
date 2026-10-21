import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { emptyModel } from './model';
import type { DiagramModel, ID } from './model';
import { depthOf, depthsOf, validParents } from './tree';

/** A model built straight from parent pointers, the way an untrusted file can describe one (cycles, ghosts, endless chains). */
function withParents(parents: Array<[ID, ID | undefined]>): DiagramModel {
  const model = emptyModel();
  for (const [id, parentId] of parents) {
    model.elements[id] = { kind: 'group', id, ...(parentId === undefined ? {} : { parentId }) } as DiagramModel['elements'][string];
    model.order.push(id);
  }
  return model;
}

const agree = (model: DiagramModel) => {
  const all = depthsOf(model);
  for (const id of model.order) expect(all.get(id), id).toBe(depthOf(model, id));
};

describe('depthsOf matches depthOf', () => {
  it('on plain trees, orphans (parent missing) and roots', () => {
    agree(withParents([['a', undefined], ['b', 'a'], ['c', 'b'], ['o', 'ghost'], ['p', 'o']]));
  });

  it('on parent cycles and the elements leading into them', () => {
    const model = withParents([['a', 'b'], ['b', 'c'], ['c', 'a'], ['tail', 'a'], ['self', 'self']]);
    agree(model);
    expect(depthsOf(model).get('a')).toBe(64);
  });

  it('on chains longer than 64 levels', () => {
    const chain: Array<[ID, ID | undefined]> = [['n0', undefined]];
    for (let i = 1; i < 200; i += 1) chain.push([`n${i}`, `n${i - 1}`]);
    const model = withParents(chain);
    agree(model);
    expect(depthsOf(model).get('n63')).toBe(63);
    expect(depthsOf(model).get('n199')).toBe(64);
  });

  it('does not invent entries for parents that are not elements', () => {
    expect([...depthsOf(withParents([['o', 'ghost']])).keys()]).toEqual(['o']);
  });

  it('for arbitrary pointer graphs, in any order', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    fc.assert(
      fc.property(fc.array(fc.option(fc.constantFrom(...ids, 'ghost'), { nil: undefined }), { minLength: 8, maxLength: 8 }), fc.shuffledSubarray(ids, { minLength: 8 }), (parents, order) => {
        const model = withParents(ids.map((id, i) => [id, parents[i]] as [ID, ID | undefined]));
        model.order = order;
        agree(model);
      }),
    );
  });
});

describe('validParents', () => {
  const parentsOf = (model: DiagramModel) => Object.fromEntries(validParents(model));
  const node = (model: DiagramModel, id: ID, parentId?: ID) => {
    model.elements[id] = { kind: 'node', id, ...(parentId === undefined ? {} : { parentId }) };
    model.order.push(id);
    return model;
  };

  it('keeps the parents of a valid tree', () => {
    const model = node(withParents([['VPC', undefined], ['Sub', 'VPC']]), 'API', 'Sub');
    expect(parentsOf(model)).toEqual({ VPC: undefined, Sub: 'VPC', API: 'Sub' });
  });

  it('moves an element whose parent is missing, empty or not a group to the top level, keeping the element', () => {
    const model = node(node(withParents([['G', 'ghost'], ['H', '']]), 'API'), 'Cache', 'API');
    expect(parentsOf(model)).toEqual({ G: undefined, H: undefined, API: undefined, Cache: undefined });
  });

  it('breaks each parent cycle at its member with the greatest id, whatever the order', () => {
    const two = withParents([['G1', 'G2'], ['G2', 'G1']]);
    expect(parentsOf(two)).toEqual({ G1: 'G2', G2: undefined });
    expect(parentsOf({ ...two, order: ['G2', 'G1'] })).toEqual({ G1: 'G2', G2: undefined });
    const three = withParents([['b', 'c'], ['c', 'a'], ['a', 'b'], ['tail', 'a'], ['self', 'self']]);
    expect(parentsOf(three)).toEqual({ a: 'b', b: 'c', c: undefined, tail: 'a', self: undefined });
  });

  it('reads ids through own(): prototype names are ordinary groups', () => {
    expect(parentsOf(withParents([['constructor', 'toString'], ['toString', 'constructor']]))).toEqual({ constructor: 'toString', toString: undefined });
  });

  it('for arbitrary pointer graphs, returns an acyclic forest that does not depend on the visiting order', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    fc.assert(
      fc.property(fc.array(fc.option(fc.constantFrom(...ids, 'ghost'), { nil: undefined }), { minLength: 8, maxLength: 8 }), fc.shuffledSubarray(ids, { minLength: 8 }), (parents, shuffled) => {
        const model = withParents(ids.map((id, i) => [id, parents[i]] as [ID, ID | undefined]));
        const reordered = withParents(shuffled.map((id) => [id, parents[ids.indexOf(id)]] as [ID, ID | undefined]));
        const result = validParents(model);
        expect(Object.fromEntries(validParents(reordered))).toEqual(Object.fromEntries(result));
        for (const id of ids) {
          const seen = new Set<ID>();
          for (let cur: ID | undefined = id; cur !== undefined; cur = result.get(cur)) {
            expect(seen.has(cur)).toBe(false);
            seen.add(cur);
          }
        }
      }),
    );
  });
});
