import { describe, expect, it } from 'vitest';
import { fingerprint, syntheticModels } from '@strukt/core/testing';
import { toFlow } from './toFlow';

describe.each(Object.entries(syntheticModels()))('toFlow ordering on %s', (_name, { model, layout }) => {
  it('keeps node order, parents and z-index', () => {
    const { nodes } = toFlow(model, layout, { nodes: [], edges: [] }, 'light');
    const summary = nodes.map((n) => [n.id, n.parentId, n.zIndex, n.position]);
    expect(fingerprint(JSON.stringify(summary))).toMatchSnapshot();
    expect(nodes.length).toBe(model.order.length);
  });
});
