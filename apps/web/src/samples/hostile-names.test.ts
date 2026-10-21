import { applyOps, emptyLayout, emptyModel } from '@strukt/core';
import type { DiagramModel, DiagramOp } from '@strukt/core';
import { printDiagramJson } from '@strukt/json';
import { createMemoryAdapter, newWorkspace } from '@strukt/workspace';
import { describe, expect, it, vi } from 'vitest';
import { planTextEdit } from '../code/sync';
import { toFlow } from '../diagram/toFlow';
import { renderDiagramSvg } from '../export/svg';
import { readThrough } from '../perspectives/project';
import { evidenceFor, flowsFor, perspectivesFor, refsFor } from '../workspace/lookup';

/**
 * Valid element names that are also Object.prototype members (only `__proto__` is refused): a plain
 * `map[id]` lookup "finds" a function for them. Any id-keyed map read without `own()` shows up here as NaN.
 * A few also carry a hostile *color value* (`constructor`/`__proto__`): `PALETTE[t] ?? EXTENDED_COLORS[t]`
 * resolves those to `Object`/`Object.prototype`, which crashes hexToHsl in nodeColors/groupColors/edgeColor.
 */
const OPS: DiagramOp[] = [
  { op: 'add_group', id: 'constructor', color: '__proto__' },
  { op: 'add_node', id: 'toString', parentId: 'constructor' },
  { op: 'add_node', id: 'valueOf', parentId: 'constructor' },
  { op: 'add_node', id: 'hasOwnProperty' },
  { op: 'add_node', id: 'isPrototypeOf' },
  { op: 'add_node', id: 'toLocaleString' },
  { op: 'connect', from: 'hasOwnProperty', to: 'isPrototypeOf', label: 'x', color: 'constructor' },
  { op: 'connect', from: 'toString', to: 'hasOwnProperty' },
  { op: 'add_node', id: 'propertyIsEnumerable', color: 'constructor' },
  { op: 'add_node', id: '__defineGetter__' },
  { op: 'connect', from: 'toLocaleString', to: '__defineGetter__' },
];

function build(ops: DiagramOp[]): DiagramModel {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

const TEXT = printDiagramJson(build(OPS));
const EXTENDED = printDiagramJson(build([...OPS, { op: 'add_node', id: '__lookupGetter__' }, { op: 'connect', from: 'valueOf', to: '__lookupGetter__' }]));

const finite = (...values: (number | undefined)[]) => values.every((v) => Number.isFinite(v));

describe('names that are Object.prototype members', () => {
  it('flow through text edits, placement, the canvas projection and the SVG export without NaN', () => {
    const first = planTextEdit(emptyModel(), emptyLayout(), TEXT);
    if (first.kind !== 'apply') throw new Error(first.diagnostics.map((d) => d.message).join('; '));
    for (const box of Object.values(first.positions)) expect(finite(box.x, box.y)).toBe(true);
    const layout = { nodes: first.positions, edges: {} };

    const second = planTextEdit(first.next, layout, EXTENDED);
    if (second.kind !== 'apply') throw new Error(second.diagnostics.map((d) => d.message).join('; '));
    expect(Object.keys(second.positions)).toEqual(['__lookupGetter__']);
    expect(finite(second.positions.__lookupGetter__!.x, second.positions.__lookupGetter__!.y)).toBe(true);

    const { nodes } = toFlow(first.next, layout, { nodes: [], edges: [] }, 'light');
    for (const node of nodes) expect(finite(node.position.x, node.position.y, node.width, node.height), node.id).toBe(true);
    for (const theme of ['light', 'dark'] as const) {
      const svg = renderDiagramSvg(first.next, layout, { theme });
      expect(svg).not.toContain('NaN');
    }
  });
});

describe('workspace maps keyed by hostile names', () => {
  const data = { flows: {}, evidence: { a: { API: [{ path: 'src/a.ts', line: 1 }] } } };

  it('lookup helpers never answer with Object.prototype members', () => {
    for (const key of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(flowsFor(data, key)).toBeUndefined();
      expect(evidenceFor(data, key)).toBeUndefined();
      expect(refsFor(data, 'a', key)).toBeUndefined();
    }
    expect(refsFor(data, 'a', 'API')).toHaveLength(1);
  });

  it('perspectives answer nothing for prototype-named slugs and read a prototype-named diagram without NaN', () => {
    const model = build(OPS);
    const layout = planLayout(model);
    const saved = [{ id: 'constructor', name: 'c', hide: ['hasOwnProperty'], collapsed: ['constructor'], include: ['toString', 'valueOf'] }];
    const withSaved = { perspectives: { constructor: saved } };
    for (const key of ['toString', 'hasOwnProperty', 'valueOf']) expect(perspectivesFor(withSaved, key)).toBeUndefined();
    expect(perspectivesFor(withSaved, 'constructor')).toBe(saved);
    const shared = { version: 1 as const, entities: { toString: { id: 'toString', tags: ['nivel:container'] } }, views: { constructor: { toString: 'toString', constructor: 'toString' } } };
    const read = readThrough({ model, layout, slug: 'constructor', id: 'constructor', saved, shared })!;
    expect(read.model.order).not.toContain('hasOwnProperty');
    expect(read.view.boxes.has('constructor')).toBe(true);
    const { nodes } = toFlow(read.model, read.layout, { nodes: [], edges: [] }, 'light');
    for (const node of nodes) expect(finite(node.position.x, node.position.y, node.width, node.height), node.id).toBe(true);
    expect(renderDiagramSvg(read.model, read.layout, { theme: 'light' })).not.toContain('NaN');
  });

  it('toFlow shows no evidence badge for a node named like a prototype member', () => {
    const model = build(OPS);
    const layout = planLayout(model);
    const evidence = { API: [{ path: 'x.ts' }] } as Record<string, { path: string }[]>;
    const { nodes } = toFlow(model, layout, { nodes: [], edges: [] }, 'light', undefined, undefined, evidence);
    for (const node of nodes) expect(JSON.stringify(node.data), node.id).not.toMatch(/"evidenceCount":[1-9]/);
  });

  it('the diagram link to a prototype-named slug is refused without a breadcrumb', async () => {
    vi.resetModules();
    vi.stubGlobal('window', { confirm: vi.fn(() => true) });
    const appStore = await import('../state/appStore');
    const { workspace } = await import('../workspace/appWorkspace');
    const actions = await import('../workspace/actions');
    const ui = await import('../ui/uiStore');
    await workspace.open(createMemoryAdapter({}), () => newWorkspace('W', { title: 'Um', snapshot: appStore.diagramStore.getState() }));
    ui.uiStore.setState({ diagramTrail: [] });
    await actions.openDiagramLink('diagram:constructor');
    expect(ui.uiStore.getState().diagramTrail).toEqual([]);
    expect(ui.uiStore.getState().toast).toBe('Diagrama não encontrado no workspace.');
  });
});

function planLayout(model: DiagramModel) {
  const planned = planTextEdit(emptyModel(), emptyLayout(), printDiagramJson(model));
  if (planned.kind !== 'apply') throw new Error('layout');
  return { nodes: planned.positions, edges: {} };
}
