import { createMemoryAdapter, newWorkspace } from '@strukt/workspace';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exampleSnapshot } from '../samples/example';
import { createDiagramStore } from '../state/diagramStore';
import { createWorkspace } from '../workspace/workspace';
import { createContextSync } from './contextSync';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function setup(adapter = createMemoryAdapter()) {
  const diagram = createDiagramStore();
  const workspace = createWorkspace(diagram, { saveDelay: 50 });
  const sync = createContextSync(workspace);
  await workspace.open(adapter, () => newWorkspace('Loja', { title: 'Visão geral', snapshot: exampleSnapshot() }));
  await sync.ready();
  return { diagram, workspace, sync, adapter };
}

const contextOf = (files: Map<string, string>) => [...files.keys()].filter((path) => path.startsWith('context/')).sort();

describe('context sync', () => {
  it('generates context automatically and follows every change of meaning', async () => {
    const { diagram, workspace, sync, adapter } = await setup();
    diagram.getState().apply([{ op: 'add_node', id: 'Fila' }], { Fila: { x: 0, y: 600 } });
    await workspace.flush();
    expect(contextOf(adapter.files)).toContain('context/ARCHITECTURE.md');

    const files = await sync.generate();
    expect(sync.enabled()).toBe(true);
    expect(contextOf(adapter.files)).toEqual(['context/ARCHITECTURE.md', 'context/diagrams/visao-geral.md', 'context/llms.txt']);
    expect(adapter.files.get('context/ARCHITECTURE.md')).toBe(files['context/ARCHITECTURE.md']);
    expect(files['context/ARCHITECTURE.md']).toContain('| `Fila` | nó |');

    diagram.getState().apply([{ op: 'rename', id: 'Fila', to: 'Fila de pedidos' }]);
    await vi.advanceTimersByTimeAsync(50);
    expect(adapter.files.get('context/ARCHITECTURE.md')).toContain('| `Fila de pedidos` | nó |');
  });

  it('rewrites nothing in context/ when only positions change', async () => {
    const { diagram, workspace, sync, adapter } = await setup();
    await sync.generate();
    const write = vi.spyOn(adapter, 'write');
    diagram.getState().moveLive({ Kafka: { x: 10, y: 900 } });
    await workspace.flush();
    expect(write.mock.calls.map(([path]) => path)).toEqual(['diagrams/visao-geral.layout.json']);
  });

  it('turns itself on for a workspace that already has context/, and removes the file of a deleted diagram', async () => {
    const first = await setup();
    await first.workspace.create('diagram', 'Pagamentos');
    await first.sync.generate();
    first.adapter.files.set('context/notas.md', 'minhas notas');
    await first.workspace.close();
    first.sync.dispose();

    const { workspace, sync, adapter } = await setup(first.adapter);
    expect(sync.enabled()).toBe(true);
    await workspace.remove('diagram', 'pagamentos');
    await workspace.flush();
    expect(contextOf(adapter.files)).toEqual(['context/ARCHITECTURE.md', 'context/diagrams/visao-geral.md', 'context/llms.txt', 'context/notas.md']);
    expect(adapter.files.get('context/llms.txt')).not.toContain('Pagamentos');
  });

  it('dispose() also cancels a check still reading storage: nothing under context/ is written afterwards', async () => {
    const adapter = createMemoryAdapter();
    const diagram = createDiagramStore();
    const workspace = createWorkspace(diagram, { saveDelay: 50 });
    await workspace.open(adapter, () => newWorkspace('Loja', { title: 'Visão geral', snapshot: exampleSnapshot() }));
    await workspace.flush();
    let release: (paths: string[]) => void = () => {};
    adapter.list = () => new Promise<string[]>((resolve) => void (release = resolve));
    const write = vi.spyOn(adapter, 'write');

    const sync = createContextSync(workspace);
    sync.dispose();
    release(['context/ARCHITECTURE.md']);
    await sync.ready();
    diagram.getState().apply([{ op: 'rename', id: 'Kafka', to: 'Barramento' }]);
    await workspace.flush();

    expect(write.mock.calls.map(([path]) => path).filter((path) => path.startsWith('context/'))).toEqual([]);
    expect(contextOf(adapter.files)).toEqual([]);
    expect(sync.enabled()).toBe(false);
  });

  it('binds a pending context write to the workspace that queued it, never the one opened afterwards', async () => {
    const { diagram, workspace, sync, adapter } = await setup();
    await sync.generate();
    // A meaningful change queues new context/ content on the current (A) saver, still inside the debounce.
    diagram.getState().apply([{ op: 'rename', id: 'Kafka', to: 'Barramento' }]);

    const second = createMemoryAdapter();
    // Opens workspace B before A's debounce fires: A's saver (with the queued context write bound to
    // A's data) is flushed as part of open(), while sync re-checks and follows B from here on.
    await workspace.open(second, () => newWorkspace('Outra loja', { title: 'Visão geral', snapshot: exampleSnapshot() }));

    expect(adapter.files.get('context/ARCHITECTURE.md')).toContain('Barramento');
    expect(adapter.files.get('context/ARCHITECTURE.md')).not.toContain('Outra loja');
    await sync.ready();await workspace.flush();
    expect(second.files.get('context/ARCHITECTURE.md')).toContain('Outra loja');
    expect(second.files.get('context/ARCHITECTURE.md')).not.toContain('Barramento');
  });

  it('does not schedule any context write for position-only changes', async () => {
    const { diagram, workspace, sync } = await setup();
    await sync.generate();
    await workspace.flush();
    const schedule = vi.spyOn(workspace, 'schedule');
    diagram.getState().moveLive({ Kafka: { x: 10, y: 900 } });
    expect(schedule.mock.calls.filter(([path]) => path.startsWith('context/'))).toEqual([]);
    diagram.getState().apply([{ op: 'rename', id: 'Kafka', to: 'Barramento 2' }]);
    expect(schedule.mock.calls.filter(([path]) => path.startsWith('context/')).length).toBeGreaterThan(0);
  });

  it('never enables itself for a LAN guest, whose context/ writes the host refuses', async () => {
    const adapter = createMemoryAdapter({ 'context/ARCHITECTURE.md': '# x' });
    Object.assign(adapter, { label: 'Rede local: projeto' });
    const { sync } = await setup(adapter);
    expect(sync.enabled()).toBe(false);
  });
});
