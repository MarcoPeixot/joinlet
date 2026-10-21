import { applyOps, emptyModel } from '@strukt/core';
import type { DiagramOp } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import type { DiagramSnapshot } from './diagram';
import { docLink, docSlugOf, referencesTo, webHref } from './links';

function snapshot(ops: DiagramOp[]): DiagramSnapshot {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return { model: result.model, layout: { nodes: {}, edges: {} } };
}

describe('doc links', () => {
  it('reads and writes the doc:<slug> convention', () => {
    expect(docLink('api')).toBe('doc:api');
    expect(docSlugOf('doc:api')).toBe('api');
    expect(docSlugOf('https://example.com')).toBeNull();
    expect(docSlugOf('doc:')).toBeNull();
    expect(docSlugOf(undefined)).toBeNull();
  });

  it('accepts only http(s) as web links', () => {
    expect(webHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(webHref(' http://x.io ')).toBe('http://x.io');
    expect(webHref('javascript:alert(1)')).toBeNull();
    expect(webHref('data:text/html,<b>')).toBeNull();
    expect(webHref('doc:api')).toBeNull();
    expect(webHref(undefined)).toBeNull();
  });

  it('lists every element linked to a doc, in sidebar then declaration order', () => {
    const diagrams = {
      checkout: snapshot([
        { op: 'add_node', id: 'API' },
        { op: 'update', id: 'API', set: { link: 'doc:api', label: 'API pública' } },
        { op: 'add_node', id: 'Outro' },
      ]),
      loja: snapshot([
        { op: 'add_group', id: 'Backend' },
        { op: 'update', id: 'Backend', set: { link: 'doc:api' } },
        { op: 'add_node', id: 'Web', parentId: 'Backend' },
        { op: 'update', id: 'Web', set: { link: 'doc:web' } },
      ]),
    };
    const order = [
      { slug: 'loja', title: 'Loja' },
      { slug: 'checkout', title: 'Checkout' },
      { slug: 'sumiu', title: 'Sumiu' },
      { slug: 'constructor', title: 'Herdado' },
    ];
    expect(referencesTo('api', diagrams, order)).toEqual([
      { diagram: 'loja', diagramTitle: 'Loja', id: 'Backend', label: 'Backend' },
      { diagram: 'checkout', diagramTitle: 'Checkout', id: 'API', label: 'API pública' },
    ]);
    expect(referencesTo('nada', diagrams, order)).toEqual([]);
  });
});
