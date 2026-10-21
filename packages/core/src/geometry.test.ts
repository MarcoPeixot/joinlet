import { describe, expect, it } from 'vitest';
import { applyOps } from './applyOps';
import {
  GROUP_PADDING, ICON_LABEL, ICON_NODE_SIZE, computeRects, defaultSize, iconCaption, iconLabelSize, innermostGroupAt, nodeVariant, translateSubtree,
} from './geometry';
import { SHAPES, emptyLayout, emptyModel } from './model';
import type { DiagramModel, DiagramOp, LayoutState } from './model';
import { syncLayout } from './syncLayout';

function build(ops: DiagramOp[]): DiagramModel {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

const layoutOf = (nodes: LayoutState['nodes']): LayoutState => ({ nodes, edges: {} });

describe('sizes', () => {
  it('expands a table when fields are added, even with a previously persisted box', () => {
    const m = build([{ op: 'add_node', id: 'Users', presentation: 'table', fields: [{ name: 'id', type: 'uuid', key: 'PK' }, { name: 'email', type: 'text' }, { name: 'created_at', type: 'timestamp' }] }]);
    const r = computeRects(m, layoutOf({ Users: { x: 0, y: 0, w: 220, h: 80 } })).Users!;
    expect(r.w).toBeGreaterThanOrEqual(220);
    expect(r.h).toBe(160);
    expect(nodeVariant(m.elements.Users as never)).toBe('table');
  });
  it('renders rejected legacy component shapes as icons and reserves technology captions', () => {
    const m = build([{ op: 'add_node', id: 'API', shape: 'component', icon: 'nestjs', tech: 'NestJS · Node.js · Express' }]);
    const el = m.elements.API;
    if (el.kind !== 'node') throw new Error('Expected node');
    expect(nodeVariant(el)).toBe('icon');
    expect(defaultSize(el)).toEqual(ICON_NODE_SIZE);
    expect(iconLabelSize(el).h).toBeGreaterThan(ICON_LABEL.height);
    expect(iconCaption(el, 140)).toMatchObject({ technology: ['NestJS · Node.js'] });
    expect(el.shape).toBe('component');
    expect(el.tech).toBe('NestJS · Node.js · Express');
  });
  it.each(SHAPES)('%s reserves finite dimensions for a multiline component title', (shape) => {
    const m = build([{ op: 'add_node', id: 'A', label: 'Processamento assíncrono de arquivos\ne resultados do projeto', shape, icon: 'layers' }]);
    const size = defaultSize(m.elements.A);
    expect(size.w).toBeGreaterThan(0);
    expect(size.h).toBeGreaterThan(0);
    expect([size.w, size.h].every(Number.isFinite)).toBe(true);
  });
  it('reserves enough caption space for long identifiers and multiple lines', () => {
    const m = build([{ op: 'add_group', id: 'G' }, { op: 'add_node', id: 'QueueConsumersModule', icon: 'layers', parentId: 'G', label: 'Fila de resultados e processamento assíncrono dos workers' }]);
    const rects = computeRects(m, layoutOf({ QueueConsumersModule: { x: 0, y: 0 } }));
    expect(rects.G!.h - GROUP_PADDING.top - GROUP_PADDING.bottom - ICON_NODE_SIZE.h).toBeGreaterThan(40);
    const long = build([{ op: 'add_group', id: 'G' }, { op: 'add_node', id: 'QueueConsumersModule', icon: 'layers', parentId: 'G' }]);
    expect(computeRects(long, layoutOf({ QueueConsumersModule: { x: 0, y: 0 } })).G!.w).toBeGreaterThan(ICON_LABEL.width + GROUP_PADDING.left + GROUP_PADDING.right);
  });
  it('fits a readable title beside an icon in a cylinder', () => {
    const m = build([{ op: 'add_node', id: 'PostgreSQL e pgvector', shape: 'cylinder', icon: 'postgres' }]);
    expect(defaultSize(m.elements['PostgreSQL e pgvector']).w).toBeGreaterThan(120);
  });
  it('uses the icon variant only for icon nodes without shape', () => {
    const m = build([{ op: 'add_node', id: 'A', icon: 'redis' }, { op: 'add_node', id: 'B', icon: 'redis', shape: 'diamond' }]);
    expect(nodeVariant(m.elements.A as never)).toBe('icon');
    expect(nodeVariant(m.elements.B as never)).toBe('shape');
    expect(defaultSize(m.elements.A)).toEqual(ICON_NODE_SIZE);
  });
});

describe('computeRects', () => {
  it('uses layout boxes with default sizes for nodes', () => {
    const m = build([{ op: 'add_node', id: 'A' }]);
    expect(computeRects(m, layoutOf({ A: { x: 10, y: 20 } })).A).toEqual({ x: 10, y: 20, w: 160, h: 64 });
  });

  it('wraps group children with padding, including nested groups', () => {
    const m = build([
      { op: 'add_group', id: 'Outer' },
      { op: 'add_group', id: 'Inner', parentId: 'Outer' },
      { op: 'add_node', id: 'A', parentId: 'Inner' },
    ]);
    const rects = computeRects(m, layoutOf({ A: { x: 100, y: 100, w: 100, h: 50 } }));
    expect(rects.Inner).toEqual({
      x: 100 - GROUP_PADDING.left, y: 100 - GROUP_PADDING.top,
      w: 100 + GROUP_PADDING.left + GROUP_PADDING.right, h: 50 + GROUP_PADDING.top + GROUP_PADDING.bottom,
    });
    expect(rects.Outer?.x).toBe(rects.Inner!.x - GROUP_PADDING.left);
  });

  it('reserves room for the label under icon nodes', () => {
    const m = build([{ op: 'add_group', id: 'G' }, { op: 'add_node', id: 'R', icon: 'redis', parentId: 'G' }]);
    const rects = computeRects(m, layoutOf({ R: { x: 0, y: 0 } }));
    expect(rects.G!.h).toBe(ICON_NODE_SIZE.h + ICON_LABEL.height + GROUP_PADDING.top + GROUP_PADDING.bottom);
    expect(rects.G!.w).toBe(ICON_LABEL.width + GROUP_PADDING.left + GROUP_PADDING.right);
  });

  it('uses the stored box for empty groups and frozen rects when given', () => {
    const m = build([{ op: 'add_group', id: 'G' }, { op: 'add_group', id: 'H' }, { op: 'add_node', id: 'A', parentId: 'H' }]);
    const frozen = { H: { x: 0, y: 0, w: 999, h: 999 } };
    const rects = computeRects(m, layoutOf({ G: { x: 5, y: 6, w: 70, h: 80 }, A: { x: 500, y: 500 } }), frozen);
    expect(rects.G).toEqual({ x: 5, y: 6, w: 70, h: 80 });
    expect(rects.H).toEqual(frozen.H);
  });
});

describe('hit testing and moves', () => {
  const m = build([
    { op: 'add_group', id: 'Outer' },
    { op: 'add_group', id: 'Inner', parentId: 'Outer' },
    { op: 'add_node', id: 'A', parentId: 'Inner' },
    { op: 'add_node', id: 'B' },
  ]);
  const layout = layoutOf({ A: { x: 100, y: 100 }, B: { x: 600, y: 100 } });
  const rects = computeRects(m, layout);

  it('finds the deepest group under a point', () => {
    expect(innermostGroupAt(m, rects, { x: 120, y: 120 }, new Set())).toBe('Inner');
    expect(innermostGroupAt(m, rects, { x: 120, y: 120 }, new Set(['Inner']))).toBe('Outer');
    expect(innermostGroupAt(m, rects, { x: 650, y: 120 }, new Set())).toBeUndefined();
  });

  it('translates leaf nodes of a subtree, not derived groups', () => {
    expect(translateSubtree(m, rects, 'Outer', 10, -5)).toEqual({ A: { x: 110, y: 95 } });
  });

  it('never freezes computed sizes into the layout', () => {
    const icons = build([{ op: 'add_group', id: 'G' }, { op: 'add_node', id: 'R', parentId: 'G', icon: 'redis' }]);
    const before = layoutOf({ R: { x: 0, y: 0 } });
    const moved = syncLayout(before, icons, [], translateSubtree(icons, computeRects(icons, before), 'G', 10, 10));
    const ops: DiagramOp[] = [{ op: 'update', id: 'R', set: { shape: 'rectangle' } }];
    const reshaped = applyOps(icons, ops);
    if (!reshaped.ok) throw new Error(reshaped.error.message);
    expect(computeRects(reshaped.model, syncLayout(moved, reshaped.model, ops)).R).toEqual({ x: 10, y: 10, w: 160, h: 64 });
  });

  it('keeps the stored box of a moved empty group', () => {
    const empty = build([{ op: 'add_group', id: 'G' }]);
    const before = layoutOf({ G: { x: 5, y: 6, w: 70, h: 80 } });
    const moves = translateSubtree(empty, computeRects(empty, before), 'G', 10, 10);
    expect(moves).toEqual({ G: { x: 15, y: 16 } });
    expect(syncLayout(before, empty, [], moves).nodes.G).toEqual({ x: 15, y: 16, w: 70, h: 80 });
  });
});

describe('syncLayout', () => {
  it('moves renamed keys, prunes removed elements and merges positions', () => {
    const before = build([{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }]);
    const ops: DiagramOp[] = [{ op: 'rename', id: 'A', to: 'API' }, { op: 'remove', id: 'B' }, { op: 'add_node', id: 'C' }];
    const result = applyOps(before, ops);
    if (!result.ok) throw new Error(result.error.message);
    const next = syncLayout(layoutOf({ A: { x: 1, y: 2, w: 200 }, B: { x: 3, y: 4 } }), result.model, ops, { C: { x: 9, y: 9 } });
    expect(next.nodes).toEqual({ API: { x: 1, y: 2, w: 200 }, C: { x: 9, y: 9 } });
  });

  it('keeps sizes when merging a position', () => {
    const m = build([{ op: 'add_node', id: 'A' }]);
    expect(syncLayout(layoutOf({ A: { x: 0, y: 0, w: 300, h: 90 } }), m, [], { A: { x: 5, y: 5 } }).nodes.A)
      .toEqual({ x: 5, y: 5, w: 300, h: 90 });
    expect(emptyLayout()).toEqual({ nodes: {}, edges: {} });
  });
});

describe('names that collide with Object.prototype', () => {
  it('syncLayout only follows own keys', () => {
    const before = build([{ op: 'add_node', id: 'constructor' }, { op: 'add_node', id: 'toString' }]);
    const ops: DiagramOp[] = [{ op: 'rename', id: 'constructor', to: 'C' }, { op: 'remove', id: 'toString' }];
    const result = applyOps(before, ops);
    if (!result.ok) throw new Error(result.error.message);
    const next = syncLayout(layoutOf({ toString: { x: 1, y: 1 } }), result.model, ops, { valueOf: { x: 2, y: 2 } });
    expect(next.nodes).toEqual({});
  });
});

describe('names that are Object.prototype members', () => {
  it('never takes a pinned rect from Object.prototype', () => {
    const m = build([{ op: 'add_group', id: 'toString' }, { op: 'add_node', id: 'valueOf', parentId: 'toString' }, { op: 'add_group', id: 'constructor' }]);
    const rects = computeRects(m, { nodes: { valueOf: { x: 10, y: 10 } }, edges: {} });
    for (const r of Object.values(rects)) expect([r.x, r.y, r.w, r.h].every(Number.isFinite)).toBe(true);
    expect(rects.constructor).toEqual({ x: 0, y: 0, w: 320, h: 200 });
  });
});
