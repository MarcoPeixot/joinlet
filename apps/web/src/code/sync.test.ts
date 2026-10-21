import * as core from '@strukt/core';
import { applyOps, computeRects, emptyLayout, emptyModel, intersects, syncLayout } from '@strukt/core';
import type { DiagramModel, DiagramOp } from '@strukt/core';
import { printDiagramJson } from '@strukt/json';
import type { JsonDiagnostic } from '@strukt/json';
import * as layoutEngine from '@strukt/layout';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exampleSnapshot } from '../samples/example';
import { createDiagramStore } from '../state/diagramStore';
import { createCodeSync, planTextEdit, textMatchesModel } from './sync';
import type { CodeEditorPort } from './sync';

// Only `diffModels` is wrapped (delegating to the real implementation by default): every other test
// gets genuine core behavior, and this one spy lets a single test force the "should never happen"
// throw inside `diffModels` without touching any other test's behavior.
vi.mock('@strukt/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@strukt/core')>();
  return { ...actual, diffModels: vi.fn(actual.diffModels) };
});
// Same for ELK: real by default, so one test can change the diagram while it "runs".
vi.mock('@strukt/layout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@strukt/layout')>();
  return { ...actual, autoLayout: vi.fn(actual.autoLayout) };
});

function model(ops: DiagramOp[]) {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

const base = model([{ op: 'add_node', id: 'API' }, { op: 'add_node', id: 'DB', shape: 'cylinder' }, { op: 'connect', from: 'API', to: 'DB' }]);
const placed = { nodes: { API: { x: 0, y: 0 }, DB: { x: 300, y: 0 } }, edges: {} };
const baseJson = printDiagramJson(base);
/** The same diagram with another node, so a text edit has something to add. */
const withCache = model([
  { op: 'add_node', id: 'API' },
  { op: 'add_node', id: 'DB', shape: 'cylinder' },
  { op: 'connect', from: 'API', to: 'DB' },
  { op: 'add_node', id: 'Cache' },
  { op: 'connect', from: 'DB', to: 'Cache' },
]);
/** One node further, for a second edit in the queue-alive test. */
const withLog = model([
  { op: 'add_node', id: 'API' },
  { op: 'add_node', id: 'DB', shape: 'cylinder' },
  { op: 'connect', from: 'API', to: 'DB' },
  { op: 'add_node', id: 'Cache' },
  { op: 'connect', from: 'DB', to: 'Cache' },
  { op: 'add_node', id: 'Log' },
  { op: 'connect', from: 'Cache', to: 'Log' },
]);

describe('planTextEdit', () => {
  it('refuses text with errors', () => {
    const plan = planTextEdit(base, placed, '{\n  "version": 1,\n  "nodes": [}\n}');
    expect(plan.kind).toBe('invalid');
    expect(plan.diagnostics[0]?.message).toContain('JSON inválido');
    expect(plan.diagnostics[0]?.line).toBe(3);
  });

  it('ignores formatting and key order', () => {
    const compact = JSON.stringify(JSON.parse(baseJson));
    expect(planTextEdit(base, placed, compact).kind).toBe('unchanged');
  });

  it('turns a rename into a rename op, so the position survives', () => {
    const plan = planTextEdit(base, placed, baseJson.replaceAll('"API"', '"Gateway"'));
    expect(plan).toMatchObject({ kind: 'apply', ops: [{ op: 'rename', id: 'API', to: 'Gateway' }], positions: {}, autoLayout: false });
  });

  it('keeps a node inserted in the middle where the user typed it', () => {
    const plan = planTextEdit(base, placed, printDiagramJson(withCache));
    expect(plan.kind === 'apply' && plan.next.order).toEqual(['API', 'DB', 'Cache']);
  });

  it('places new nodes next to a connected neighbor', () => {
    const plan = planTextEdit(base, placed, printDiagramJson(withCache));
    expect(plan).toMatchObject({ kind: 'apply', positions: { Cache: { x: 500, y: 12 } }, autoLayout: false });
  });

  it('re-places a node moved into another group instead of stretching that group over its neighbors', () => {
    const { model: example, layout } = exampleSnapshot();
    const moved = applyOps(example, [{ op: 'move_to_group', id: 'Web App', parentId: 'Dados' }]);
    if (!moved.ok) throw new Error(moved.error.message);
    const plan = planTextEdit(example, layout, printDiagramJson(moved.model));
    if (plan.kind !== 'apply') throw new Error(plan.kind);
    expect(Object.keys(plan.positions)).toEqual(['Web App']);
    const rects = computeRects(plan.next, syncLayout(layout, plan.next, plan.ops, plan.positions));
    // Before the fix Dados kept Web App's old box and grew from 196 to 1036 px wide.
    expect(rects.Dados!.w).toBeLessThan(2 * computeRects(example, layout).Dados!.w);
    for (const group of ['Frontend', 'Serviços']) expect(intersects(rects.Dados!, rects[group]!), group).toBe(false);
  });

  it('asks for auto-layout when nothing has a position yet', () => {
    expect(planTextEdit(emptyModel(), emptyLayout(), printDiagramJson(withCache))).toMatchObject({ kind: 'apply', autoLayout: true });
  });

  it('asks for auto-layout when the whole text is replaced by another diagram', () => {
    const other = model([{ op: 'add_node', id: 'Web' }, { op: 'add_node', id: 'Mobile' }, { op: 'connect', from: 'Web', to: 'Mobile' }]);
    expect(planTextEdit(base, placed, printDiagramJson(other))).toMatchObject({ kind: 'apply', autoLayout: true });
    // "DB" survives by name but turns into a group: its old box does not count.
    const regrouped = model([{ op: 'add_group', id: 'DB' }, { op: 'add_node', id: 'Tabela', parentId: 'DB' }]);
    expect(planTextEdit(base, placed, printDiagramJson(regrouped))).toMatchObject({ kind: 'apply', autoLayout: true });
  });

  it('logs and hides the `diffModels:` identifier when diffModels throws', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(core.diffModels).mockImplementationOnce(() => {
      throw new Error('diffModels: nome duplicado em Grupo');
    });
    const plan = planTextEdit(base, placed, printDiagramJson(withCache));
    expect(plan.kind).toBe('invalid');
    const message = plan.kind === 'invalid' ? plan.diagnostics.at(-1)?.message : undefined;
    expect(message).toContain('nome duplicado em Grupo');
    expect(message).not.toContain('diffModels:');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});

describe('textMatchesModel', () => {
  it('compares meaning and order, not formatting', () => {
    expect(textMatchesModel(baseJson, base)).toBe(true);
    expect(textMatchesModel(JSON.stringify(JSON.parse(baseJson)), base)).toBe(true);
    expect(textMatchesModel(printDiagramJson(model([{ op: 'add_node', id: 'DB' }, { op: 'add_node', id: 'API' }])), base)).toBe(false);
    expect(textMatchesModel('{"version": 1, "nodes": [}', base)).toBe(false);
  });
});

function fakeEditor(initial = '') {
  let text = initial;
  const editor = {
    setText: vi.fn((next: string) => void (text = next)),
    showDiagnostics: vi.fn<(d: readonly JsonDiagnostic[]) => void>(),
    getText: () => text,
    type(next: string) {
      text = next;
    },
  };
  return editor satisfies CodeEditorPort;
}

describe('createCodeSync', () => {
  afterEach(() => vi.useRealTimers());

  it('prints the model when it starts and reprints on changes made elsewhere', () => {
    const store = createDiagramStore({ model: base, layout: placed });
    const editor = fakeEditor();
    createCodeSync(store, editor);
    expect(editor.getText()).toBe(baseJson);
    store.getState().apply([{ op: 'update', id: 'API', set: { icon: 'server' } }]);
    expect(editor.getText()).toContain('"icon": "server"');
  });

  it('does not rewrite an editor created with the printed model', () => {
    const store = createDiagramStore({ model: base, layout: placed });
    const editor = fakeEditor(baseJson);
    createCodeSync(store, editor);
    expect(editor.setText).not.toHaveBeenCalled();
  });

  it('debounces typing into a single undo step and keeps the user text', async () => {
    vi.useFakeTimers();
    const store = createDiagramStore({ model: base, layout: placed });
    const editor = fakeEditor();
    const sync = createCodeSync(store, editor);
    editor.type(baseJson.replace('"connections"', '"x-note": "meu",\n  "connections"'));
    sync.edited();
    await vi.advanceTimersByTimeAsync(100);
    editor.type(printDiagramJson(withCache));
    sync.edited();
    await vi.advanceTimersByTimeAsync(300);
    expect(store.getState().past).toHaveLength(1);
    expect(store.getState().model.order).toEqual(['API', 'DB', 'Cache']);
    expect(store.getState().layout.nodes.Cache).toEqual({ x: 500, y: 12 });
    expect(editor.setText).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite uncommitted edits, and the text wins when it commits', async () => {
    const store = createDiagramStore({ model: base, layout: placed });
    const editor = fakeEditor();
    const sync = createCodeSync(store, editor);
    editor.type(printDiagramJson(withCache));
    sync.edited();
    store.getState().apply([{ op: 'update', id: 'DB', set: { color: 'red' } }]);
    expect(editor.setText).toHaveBeenCalledTimes(1);
    await sync.flush();
    expect(store.getState().model.elements.Cache).toBeDefined();
    expect(store.getState().model.elements.DB?.color).toBeUndefined();
  });

  it('shows diagnostics and leaves the diagram alone on errors', async () => {
    const store = createDiagramStore({ model: base, layout: placed });
    const editor = fakeEditor();
    const sync = createCodeSync(store, editor);
    editor.type('{"version": 1, "nodes": [}');
    sync.edited();
    await sync.flush();
    expect(editor.showDiagnostics).toHaveBeenLastCalledWith([expect.objectContaining({ severity: 'error', line: 1 })]);
    expect(store.getState().model).toBe(base);
  });

  it('lays out pasted code with ELK when the diagram has no positions', async () => {
    const store = createDiagramStore();
    const editor = fakeEditor();
    const onAutoLayout = vi.fn();
    const sync = createCodeSync(store, editor, { onAutoLayout });
    editor.type(printDiagramJson(withCache));
    sync.edited();
    await sync.flush();
    const { nodes } = store.getState().layout;
    expect(nodes.API!.x).toBeLessThan(nodes.DB!.x);
    expect(nodes.DB!.x).toBeLessThan(nodes.Cache!.x);
    expect(store.getState().past).toHaveLength(1);
    expect(onAutoLayout).toHaveBeenCalledOnce();
  });

  it('says so instead of dropping the edit when the diagram keeps changing while ELK runs', async () => {
    const store = createDiagramStore();
    const editor = fakeEditor();
    const sync = createCodeSync(store, editor);
    for (const id of ['Outro 1', 'Outro 2', 'Outro 3']) {
      vi.mocked(layoutEngine.autoLayout).mockImplementationOnce(async () => {
        store.getState().apply([{ op: 'add_node', id }]);
        return {};
      });
    }
    editor.type(printDiagramJson(withCache));
    sync.edited();
    await sync.flush();
    expect(layoutEngine.autoLayout).toHaveBeenCalledTimes(3);
    expect(store.getState().model.order).toEqual(['Outro 1', 'Outro 2', 'Outro 3']);
    expect(editor.showDiagnostics).toHaveBeenLastCalledWith([
      expect.objectContaining({
        severity: 'error',
        message: 'Não foi possível aplicar o código: o diagrama mudou durante o layout automático. Edite o código para tentar de novo.',
      }),
    ]);
  });

  it('keeps the commit queue alive after a failure, so a later edit still commits', async () => {
    const store = createDiagramStore();
    const editor = fakeEditor();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    const onAutoLayout = vi.fn(() => {
      calls += 1;
      if (calls === 1) throw new Error('layout panel blew up');
    });
    const sync = createCodeSync(store, editor, { onAutoLayout });

    editor.type(printDiagramJson(withCache));
    sync.edited();
    await sync.flush();
    // The commit itself succeeded before onAutoLayout threw: the queue rejecting must not lose it.
    expect(store.getState().past).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(editor.showDiagnostics).toHaveBeenLastCalledWith([expect.objectContaining({ severity: 'error' })]);

    editor.type(printDiagramJson(withLog));
    sync.edited();
    await sync.flush();
    // The queue was not left permanently rejected: a later edit still commits.
    expect(store.getState().past).toHaveLength(2);
    expect(store.getState().model.elements.Log).toBeDefined();

    errorSpy.mockRestore();
  });

  it('captures the pending text at flush time, so a synchronous external change right after does not lose it', async () => {
    const store = createDiagramStore({ model: base, layout: placed });
    const editor = fakeEditor();
    const sync = createCodeSync(store, editor);
    editor.type(printDiagramJson(withCache));
    sync.edited();
    const flushed = sync.flush();
    // Synchronous, right after flush() captured dirty=false but before the queued commit runs:
    // this used to reprint the editor from the model, clobbering the just-captured user text.
    store.getState().apply([{ op: 'update', id: 'DB', set: { color: 'red' } }]);
    await flushed;
    expect(store.getState().model.elements.Cache).toBeDefined();
    expect(store.getState().model.elements.DB?.color).toBeUndefined();
  });
});
