import { applyOps, emptyModel, own } from '@strukt/core';
import type { DiagramOp } from '@strukt/core';
import { printDiagramJson } from '@strukt/json';
import type { EdgeRouter } from '@strukt/layout';
import { createMemoryAdapter, newWorkspace, parseBoard, parseManifest, printManifest, replaceFiles } from '@strukt/workspace';
import type { Manifest } from '@strukt/workspace';
import { readCollaborativeDiagram, seedCollaborativeDiagram } from '@strukt/workspace/collaboration';
import type { Saver } from '@strukt/workspace';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createCodeSync } from '../code/sync';
import { toFlow } from '../diagram/toFlow';
import { createDiagramStore } from '../state/diagramStore';
import { COLLAB_WAITING_LOCK } from '../state/locks';
import { computeRoutes, startRouting } from '../state/routing';
import { createWorkspace, flushAndDispose } from './workspace';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** The canonical JSON the workspace writes for a diagram with the given ops. */
function jsonOf(...ops: DiagramOp[]): string {
  const result = applyOps(emptyModel(), ops);
  if (!result.ok) throw new Error(result.error.message);
  return printDiagramJson(result.model);
}

async function setup(files: Record<string, string> = {}) {
  const diagram = createDiagramStore();
  const workspace = createWorkspace(diagram, { saveDelay: 50 });
  const adapter = createMemoryAdapter(files);
  const warnings = await workspace.open(adapter, () => newWorkspace('Loja', { title: 'Visão geral', snapshot: diagram.getState() }));
  return { diagram, workspace, adapter, warnings };
}

describe('chat workspace item creation', () => {
  it('creates complete files and folders in an empty workspace, persists and undoes the whole batch', async () => {
    const diagram = createDiagramStore(), workspace = createWorkspace(diagram), adapter = createMemoryAdapter();
    await workspace.open(adapter, () => newWorkspace('Vazio'));
    const snapshot = { model: emptyModel(), layout: { nodes: {}, edges: {} } };
    const applied = applyOps(snapshot.model, [{ op: 'add_node', id: 'API' }]); if (!applied.ok) throw new Error(applied.error.message);
    snapshot.model = applied.model;
    const result = await workspace.createItems([{ kind: 'doc', title: 'Requisitos', folder: 'Planejamento', content: '# Requisitos\n\nRetenção a definir.' }, { kind: 'diagram', title: 'Arquitetura', folder: 'Arquitetura', content: snapshot }, { kind: 'sketch', title: 'Fluxo', content: '{"elements":[],"files":{},"appState":{}}' }], workspace.store.getState().data!.manifest, new AbortController().signal);
    expect(result.created.map(item => item.slug)).toEqual(['requisitos', 'arquitetura', 'fluxo']);
    expect(workspace.store.getState().view).toEqual({ kind: 'board' });
    await workspace.flush();
    expect(adapter.files.get('docs/requisitos.md')).toContain('Retenção a definir');
    expect(adapter.files.get('diagrams/arquitetura.strukt.json')).toContain('API');
    expect(adapter.files.has('sketches/fluxo.excalidraw')).toBe(true);
    expect(parseManifest(adapter.files.get('strukt.json')!).manifest.docs[0]?.folder).toBe('Planejamento');
    await workspace.openDiagram('arquitetura');
    result.undo(); await workspace.flush();
    expect(workspace.store.getState()).toMatchObject({ diagram: null, view: { kind: 'board' } });
    expect(parseManifest(adapter.files.get('strukt.json')!).manifest).toMatchObject({ diagrams: [], docs: [], sketches: [] });
    expect(adapter.files.has('docs/requisitos.md')).toBe(false);
    expect(adapter.files.has('diagrams/arquitetura.strukt.json')).toBe(false);
  });
  it('reserves orphan files, versions and duplicate titles without overwriting them, and preserves unrelated edits on undo', async () => {
    const { workspace, adapter } = await setup({ 'docs/requisitos.md': 'externo', 'versions/arquitetura/antiga.json': 'versão preservada' });
    await workspace.create('doc', 'Existente', 'antes');
    const result = await workspace.createItems([{ kind: 'doc', title: 'Requisitos', content: 'novo' }, { kind: 'doc', title: 'Requisitos', content: 'segundo' }, { kind: 'diagram', title: 'Arquitetura', content: { model: emptyModel(), layout: { nodes: {}, edges: {} } } }], workspace.store.getState().data!.manifest, new AbortController().signal);
    expect(result.created.map(item => item.slug)).toEqual(['requisitos-2', 'requisitos-3', 'arquitetura-2']);
    workspace.setDoc('existente', 'edição posterior');
    result.undo(); await workspace.flush();
    expect(adapter.files.get('docs/requisitos.md')).toBe('externo');
    expect(adapter.files.get('versions/arquitetura/antiga.json')).toBe('versão preservada');
    expect(adapter.files.get('docs/existente.md')).toBe('edição posterior');
  });
  it('does not partially create on invalid folders, cancellation or a concurrent workspace change', async () => {
    const { workspace, adapter } = await setup();
    const items = [{ kind: 'doc' as const, title: 'Novo', content: '# Novo' }];
    const before = workspace.store.getState().data!;
    await expect(workspace.createItems([...items, { ...items[0]!, folder: '../Inválido' }], before.manifest, new AbortController().signal)).rejects.toThrow('inválida');
    const controller = new AbortController(); controller.abort();
    await expect(workspace.createItems(items, before.manifest, controller.signal)).rejects.toThrow();
    expect(workspace.store.getState().data).toBe(before);
    let release!: (paths: string[]) => void;
    vi.spyOn(adapter, 'list').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = workspace.createItems(items, before.manifest, new AbortController().signal);
    workspace.setName('Renomeado durante preparação'); release([]);
    await expect(pending).rejects.toThrow('mudou');
    expect(workspace.store.getState().data?.manifest.docs).toEqual([]);
  });
  it('protects content edited after creation and rejects read-only creation', async () => {
    const { workspace, diagram } = await setup();
    const result = await workspace.createItems([{ kind: 'doc', title: 'Novo', content: 'original' }], workspace.store.getState().data!.manifest, new AbortController().signal);
    workspace.setDoc('novo', 'texto alterado');
    expect(() => result.undo()).toThrow('alterações posteriores');
    expect(workspace.store.getState().data?.docs.novo).toBe('texto alterado');
    diagram.getState().setReadOnly('Somente leitura');
    await expect(workspace.createItems([{ kind: 'doc', title: 'Outro', content: '' }], workspace.store.getState().data!.manifest, new AbortController().signal)).rejects.toThrow('somente leitura');
  });
});

describe('workspace', () => {
  it('initializes an empty adapter and opens its first diagram', async () => {
    const { workspace, adapter, warnings } = await setup();
    expect(warnings).toEqual([]);
    expect([...adapter.files.keys()].sort()).toEqual(['board.json', 'diagrams/visao-geral.layout.json', 'diagrams/visao-geral.strukt.json', 'strukt.json', 'strukt.schema.json']);
    expect(workspace.store.getState()).toMatchObject({ diagram: 'visao-geral', view: { kind: 'diagram' }, source: { kind: 'memory' } });
  });

  it('autosaves canvas edits of the current diagram (DSL + sidecar) after the debounce', async () => {
    const { diagram, adapter } = await setup();
    diagram.getState().apply([{ op: 'add_node', id: 'API' }], { API: { x: 10, y: 20 } });
    expect(adapter.files.get('diagrams/visao-geral.strukt.json')).toBe(jsonOf());
    await vi.advanceTimersByTimeAsync(50);
    expect(adapter.files.get('diagrams/visao-geral.strukt.json')).toBe(jsonOf({ op: 'add_node', id: 'API' }));
    expect(JSON.parse(adapter.files.get('diagrams/visao-geral.layout.json')!).nodes).toEqual({ API: { x: 10, y: 20 } });
  });

  it('creating a diagram clears orphan versions left under its slug, never those of a live diagram', async () => {
    const { workspace, adapter } = await setup({
      'versions/pagamentos/velha.json': '{}',
      'versions/visao-geral/keep.json': '{}',
    });
    const slug = await workspace.create('diagram', 'Pagamentos');
    expect(slug).toBe('pagamentos');
    expect(adapter.files.has('versions/pagamentos/velha.json')).toBe(false);
    expect(adapter.files.has('versions/visao-geral/keep.json')).toBe(true);
    await workspace.create('diagram', 'Outro');
    expect(adapter.files.has('versions/visao-geral/keep.json')).toBe(true);
  });

  it('switches diagrams through the diagram store, resetting its history', async () => {
    const { diagram, workspace, adapter } = await setup();
    diagram.getState().apply([{ op: 'add_node', id: 'API' }], { API: { x: 0, y: 0 } });
    const slug = await workspace.create('diagram', 'Pagamentos');
    expect(slug).toBe('pagamentos');
    expect(diagram.getState().model.order).toEqual([]);
    expect(diagram.getState().past).toEqual([]);
    diagram.getState().apply([{ op: 'add_node', id: 'Stripe' }], { Stripe: { x: 5, y: 5 } });
    await workspace.openDiagram('visao-geral');
    expect(diagram.getState().model.order).toEqual(['API']);
    await workspace.flush();
    expect(adapter.files.get('diagrams/pagamentos.strukt.json')).toBe(jsonOf({ op: 'add_node', id: 'Stripe' }));
    expect(adapter.files.get('diagrams/visao-geral.strukt.json')).toBe(jsonOf({ op: 'add_node', id: 'API' }));
    expect(JSON.parse(adapter.files.get('strukt.json')!).diagrams.map((d: { slug: string }) => d.slug)).toEqual(['visao-geral', 'pagamentos']);
  });

  it('propagates edits to a shared entity across diagram views', async () => {
    const { diagram, workspace, adapter } = await setup();
    diagram.getState().apply([{ op: 'add_node', id: 'API' }]);
    workspace.linkEntity('visao-geral', 'API', 'api');
    await workspace.create('diagram', 'Detalhe');
    diagram.getState().apply([{ op: 'add_node', id: 'Backend' }]);
    workspace.linkEntity('detalhe', 'Backend', 'api');
    workspace.setEntityTags('api', ['risco:alto']);
    expect(workspace.store.getState().data?.shared?.entities.api?.tags).toEqual(['risco:alto']);
    await workspace.flush();
    const layoutBefore = adapter.files.get('diagrams/visao-geral.layout.json');
    diagram.getState().apply([{ op: 'update', id: 'Backend', set: { tech: 'Bun' } }]);
    expect(workspace.store.getState().data?.diagrams['visao-geral']?.model.elements.API?.tech).toBe('Bun');
    await workspace.flush();
    expect(adapter.files.get('model.json')).toContain('"api"');
    expect(adapter.files.get('diagrams/visao-geral.strukt.json')).toContain('"tech": "Bun"');
    expect(adapter.files.get('diagrams/visao-geral.layout.json')).toBe(layoutBefore);
  });

  it('propagates a shared connection label without rewriting either layout', async () => {
    const { diagram, workspace, adapter } = await setup();
    diagram.getState().apply([{ op: 'add_node', id: 'API' }, { op: 'add_node', id: 'DB' }, { op: 'connect', from: 'API', to: 'DB', label: 'old' }]);
    workspace.linkEntity('visao-geral', 'API', 'api');
    workspace.linkEntity('visao-geral', 'DB', 'db');
    workspace.linkRelation('visao-geral', 'API→DB', 'sql');
    await workspace.create('diagram', 'Detalhe');
    diagram.getState().apply([{ op: 'add_node', id: 'Gateway' }, { op: 'add_node', id: 'Database' }, { op: 'connect', from: 'Gateway', to: 'Database', label: 'old' }]);
    workspace.linkEntity('detalhe', 'Gateway', 'api');
    workspace.linkEntity('detalhe', 'Database', 'db');
    workspace.linkRelation('detalhe', 'Gateway→Database', 'sql');
    await workspace.flush();
    const layoutBefore = adapter.files.get('diagrams/visao-geral.layout.json');
    diagram.getState().apply([{ op: 'update_edge', edgeId: 'Gateway→Database', set: { label: 'SQL' } }]);
    expect(workspace.store.getState().data?.diagrams['visao-geral']?.model.edges[0]?.label).toBe('SQL');
    await workspace.flush();
    expect(adapter.files.get('diagrams/visao-geral.layout.json')).toBe(layoutBefore);
  });

  it('runs before-switch hooks (pending code edits) before reloading the diagram store', async () => {
    const { diagram, workspace } = await setup();
    await workspace.create('diagram', 'Outro');
    const seen: string[] = [];
    workspace.onBeforeSwitch((reload) => {
      seen.push(`${workspace.store.getState().diagram}:${reload}`);
      if (reload) diagram.getState().apply([{ op: 'add_node', id: 'Tardio' }], { Tardio: { x: 0, y: 0 } });
    });
    await workspace.show({ kind: 'board' });
    await workspace.openDiagram('outro');
    await workspace.openDiagram('visao-geral');
    expect(seen).toEqual(['outro:false', 'outro:false', 'outro:true']);
    expect(workspace.store.getState().data!.diagrams.outro!.model.order).toEqual(['Tardio']);
    expect(diagram.getState().model.order).toEqual([]);
  });

  it('keeps the loaded diagram (and its history) while a doc is shown', async () => {
    const { diagram, workspace, adapter } = await setup();
    diagram.getState().apply([{ op: 'add_node', id: 'API' }], { API: { x: 0, y: 0 } });
    const doc = await workspace.create('doc', 'Visão da API');
    expect(workspace.store.getState().view).toEqual({ kind: 'doc', slug: 'visao-da-api' });
    workspace.setDoc(doc, '# API\n\nREST.\n');
    await workspace.show({ kind: 'diagram' });
    expect(diagram.getState().past).toHaveLength(1);
    await workspace.flush();
    expect(adapter.files.get('docs/visao-da-api.md')).toBe('# API\n\nREST.\n');
    expect(parseBoard(adapter.files.get('board.json')!).cards.map((c) => c.id)).toEqual(['diagram:visao-geral', 'doc:visao-da-api']);
  });

  it('renames titles without touching files and removes items with their files', async () => {
    const { workspace, adapter } = await setup();
    const doc = await workspace.create('doc', 'API');
    workspace.rename('doc', doc, 'API pública');
    workspace.rename('doc', doc, '   ');
    await workspace.flush();
    expect(JSON.parse(adapter.files.get('strukt.json')!).docs).toEqual([{ slug: 'api', title: 'API pública' }]);
    await workspace.remove('doc', doc);
    expect(workspace.store.getState().view).toEqual({ kind: 'board' });
    await workspace.flush();
    expect(adapter.files.has('docs/api.md')).toBe(false);
  });

  it('folders: create, move, rename and delete persist to strukt.json and never touch item files', async () => {
    const { workspace, adapter } = await setup();
    const doc = await workspace.create('doc', 'API');
    await workspace.flush();
    const files = [...adapter.files.keys()].sort();
    workspace.createFolder('doc', 'Guias');
    workspace.moveItem('doc', doc, 'Guias');
    await workspace.flush();
    let manifest = JSON.parse(adapter.files.get('strukt.json')!);
    expect(manifest.docs).toEqual([{ folder: 'Guias', slug: 'api', title: 'API' }]);
    expect(manifest.folders).toEqual({ docs: ['Guias'] });
    workspace.renameFolder('doc', 'Guias', 'Manuais');
    await workspace.flush();
    manifest = JSON.parse(adapter.files.get('strukt.json')!);
    expect(manifest.docs[0].folder).toBe('Manuais');
    workspace.deleteFolder('doc', 'Manuais');
    await workspace.flush();
    manifest = JSON.parse(adapter.files.get('strukt.json')!);
    expect(manifest.docs).toEqual([{ slug: 'api', title: 'API' }]);
    expect(manifest.folders).toBeUndefined();
    expect([...adapter.files.keys()].sort()).toEqual(files);
  });

  it('create(kind, title, { folder }) places the new item in the folder', async () => {
    const { workspace, adapter } = await setup();
    await workspace.create('doc', 'Notas', undefined, 'Guias');
    await workspace.flush();
    expect(JSON.parse(adapter.files.get('strukt.json')!).docs).toEqual([{ folder: 'Guias', slug: 'notas', title: 'Notas' }]);
  });

  it('removing the current diagram loads the next one, or leaves the board with an empty store', async () => {
    const { diagram, workspace, adapter } = await setup();
    await workspace.create('diagram', 'B');
    diagram.getState().apply([{ op: 'add_node', id: 'X' }], { X: { x: 0, y: 0 } });
    await workspace.remove('diagram', 'b');
    expect(workspace.store.getState()).toMatchObject({ diagram: 'visao-geral', view: { kind: 'diagram' } });
    await workspace.remove('diagram', 'visao-geral');
    expect(workspace.store.getState()).toMatchObject({ diagram: null, view: { kind: 'board' } });
    expect(diagram.getState().model.order).toEqual([]);
    diagram.getState().apply([{ op: 'add_node', id: 'Solto' }], { Solto: { x: 0, y: 0 } });
    await workspace.flush();
    expect([...adapter.files.keys()].filter((p) => p.startsWith('diagrams/'))).toEqual([]);
  });

  it('reports failed writes as "error" and recovers on retry', async () => {
    const { diagram, workspace, adapter } = await setup();
    const write = adapter.write;
    let broken = true;
    adapter.write = (path, text) => (broken ? Promise.reject(new Error('sem permissão')) : write(path, text));
    diagram.getState().apply([{ op: 'add_node', id: 'API' }], { API: { x: 0, y: 0 } });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(workspace.store.getState()).toMatchObject({ save: 'error', saveError: expect.stringContaining('sem permissão') });
    expect(workspace.hasUnsaved()).toBe(true);
    broken = false;
    await workspace.retrySave();
    expect(workspace.store.getState().save).toBe('saved');
  });

  it('exposes its storage and queues other files through the same autosave', async () => {
    const { workspace, adapter } = await setup();
    expect(workspace.storage()).toBe(adapter);
    workspace.schedule('context/llms.txt', () => '# Loja\n');
    expect(workspace.store.getState().save).toBe('pending');
    await vi.advanceTimersByTimeAsync(50);
    expect(adapter.files.get('context/llms.txt')).toBe('# Loja\n');
    workspace.schedule('context/llms.txt', null);
    await workspace.flush();
    expect(adapter.files.has('context/llms.txt')).toBe(false);
  });

  it('opens an existing workspace instead of initializing it', async () => {
    const first = await setup();
    await first.workspace.create('doc', 'Notas');
    await first.workspace.close();
    const diagram = createDiagramStore();
    const again = createWorkspace(diagram);
    await again.open(first.adapter, () => {
      throw new Error('não deveria inicializar');
    });
    expect(again.store.getState().data!.manifest.docs).toEqual([{ slug: 'notas', title: 'Notas' }]);
  });

  it('rewrites a .strukt.json only when the diagram means something new', async () => {
    const manifest = { version: 1, name: 'Loja', diagrams: [{ slug: 'a', title: 'A' }], docs: [], sketches: [] };
    const text = jsonOf({ op: 'add_node', id: 'API' }, { op: 'add_node', id: 'Fila' }, { op: 'connect', from: 'API', to: 'Fila' });
    const { diagram, workspace, adapter } = await setup({ 'strukt.json': printManifest(manifest), 'diagrams/a.strukt.json': text });
    diagram.getState().moveLive({ API: { x: 90, y: 10 } });
    await workspace.flush();
    expect(adapter.files.get('diagrams/a.strukt.json')).toBe(text);
    expect(JSON.parse(adapter.files.get('diagrams/a.layout.json')!).nodes.API).toEqual({ x: 90, y: 10 });
    diagram.getState().apply([{ op: 'add_node', id: 'Banco' }], { Banco: { x: 0, y: 200 } });
    await workspace.flush();
    expect(adapter.files.get('diagrams/a.strukt.json')).toBe(jsonOf({ op: 'add_node', id: 'API' }, { op: 'add_node', id: 'Fila' }, { op: 'add_node', id: 'Banco' }, { op: 'connect', from: 'API', to: 'Fila' }));
  });

  it('re-binds the single diagram store on switch: routing and the code editor follow the new diagram', async () => {
    const { diagram, workspace } = await setup();
    const route = vi.fn<EdgeRouter['route']>((model) => Object.fromEntries(model.edges.map((e) => [e.id, [[0, 0], [1, 1]] as [number, number][]])));
    const stopRouting = startRouting(diagram, async (model, rects) => computeRoutes(model, rects, { route }));
    let text = '';
    const sync = createCodeSync(diagram, { getText: () => text, setText: (next) => void (text = next), showDiagnostics: () => {} }, { delay: 10 });
    workspace.onBeforeSwitch(() => sync.flush());
    diagram.getState().apply([{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }, { op: 'connect', from: 'A', to: 'B' }], {
      A: { x: 0, y: 0 },
      B: { x: 300, y: 0 },
    });
    await workspace.create('diagram', 'Outro');
    expect(text).toBe(jsonOf());
    diagram.getState().apply([{ op: 'add_node', id: 'X' }], { X: { x: 0, y: 0 } });
    expect(text).toBe(jsonOf({ op: 'add_node', id: 'X' }));
    text = jsonOf({ op: 'add_node', id: 'X' }, { op: 'add_node', id: 'Y' }, { op: 'connect', from: 'X', to: 'Y' });
    sync.edited();
    await workspace.openDiagram('visao-geral');
    expect(workspace.store.getState().data!.diagrams.outro!.model.edges.map((e) => e.id)).toEqual(['X→Y']);
    expect(text).toBe(jsonOf({ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }, { op: 'connect', from: 'A', to: 'B' }));
    await vi.advanceTimersByTimeAsync(200); // routing waits for commits to pause
    expect(Object.keys(diagram.getState().layout.edges)).toEqual(['A→B']);
    sync.dispose();
    stopRouting();
  });

  it('refuses to switch diagrams while the diagram store is read-only, leaving files and the slug untouched', async () => {
    const manifest = { version: 1, name: 'Loja', diagrams: [{ slug: 'a', title: 'A' }, { slug: 'b', title: 'B' }], docs: [], sketches: [] };
    const { diagram, workspace, adapter } = await setup({
      'strukt.json': printManifest(manifest),
      'diagrams/a.strukt.json': jsonOf({ op: 'add_node', id: 'API' }),
      'diagrams/b.strukt.json': jsonOf({ op: 'add_node', id: 'Fila' }),
    });
    expect(workspace.store.getState().diagram).toBe('a');
    diagram.getState().setReadOnly('travado para teste');
    await expect(workspace.openDiagram('b')).rejects.toThrow('Aplique ou descarte a proposta da IA antes de trocar de diagrama.');
    expect(workspace.store.getState().diagram).toBe('a');
    await workspace.flush();
    expect(adapter.files.get('diagrams/a.strukt.json')).toBe(jsonOf({ op: 'add_node', id: 'API' }));
    expect(adapter.files.get('diagrams/b.strukt.json')).toBe(jsonOf({ op: 'add_node', id: 'Fila' }));
    diagram.getState().setReadOnly(null);
    await workspace.openDiagram('b');
    expect(workspace.store.getState().diagram).toBe('b');
    diagram.getState().apply([{ op: 'add_node', id: 'Y' }], { Y: { x: 0, y: 0 } });
    await workspace.flush();
    expect(adapter.files.get('diagrams/b.strukt.json')).toBe(jsonOf({ op: 'add_node', id: 'Fila' }, { op: 'add_node', id: 'Y' }));
    expect(adapter.files.get('diagrams/a.strukt.json')).toBe(jsonOf({ op: 'add_node', id: 'API' }));
  });

  it('refuses to remove the current diagram while the diagram store is read-only, leaving its files untouched', async () => {
    const { diagram, workspace, adapter } = await setup();
    await workspace.create('diagram', 'Outro');
    diagram.getState().setReadOnly('travado para teste');
    await expect(workspace.remove('diagram', 'outro')).rejects.toThrow('Aplique ou descarte a proposta da IA antes de trocar de diagrama.');
    expect(workspace.store.getState().diagram).toBe('outro');
    await workspace.flush();
    expect(adapter.files.has('diagrams/outro.strukt.json')).toBe(true);
    expect(JSON.parse(adapter.files.get('strukt.json')!).diagrams.map((d: { slug: string }) => d.slug)).toEqual(['visao-geral', 'outro']);
  });

  it('keeps the current workspace working when opening a different adapter fails', async () => {
    const { diagram, workspace, adapter } = await setup();
    const broken = createMemoryAdapter({}, 'Quebrado');
    broken.read = () => Promise.reject(new Error('sem acesso'));
    await expect(workspace.open(broken, () => { throw new Error('não deveria inicializar'); })).rejects.toThrow('sem acesso');
    expect(workspace.store.getState().source).toEqual({ kind: 'memory', label: 'Memória' });
    diagram.getState().apply([{ op: 'add_node', id: 'API' }], { API: { x: 0, y: 0 } });
    await workspace.flush();
    expect(adapter.files.get('diagrams/visao-geral.strukt.json')).toBe(jsonOf({ op: 'add_node', id: 'API' }));
  });

  it('reload re-reads the disk, keeps the current diagram and clears the external notice', async () => {
    const { diagram, workspace, adapter } = await setup();
    diagram.getState().apply([{ op: 'add_node', id: 'API' }], { API: { x: 0, y: 0 } });
    await workspace.flush();
    workspace.setExternal(['diagrams/visao-geral.strukt.json', 'docs/x.md']);
    expect(workspace.store.getState().external).toEqual({ files: ['diagrams/visao-geral.strukt.json', 'docs/x.md'] });

    // Someone else (an agent) rewrote the diagram on disk.
    adapter.files.set('diagrams/visao-geral.strukt.json', jsonOf({ op: 'add_node', id: 'DoAgente' }));
    await workspace.reload();
    expect(diagram.getState().model.order).toEqual(['DoAgente']);
    expect(workspace.store.getState()).toMatchObject({ diagram: 'visao-geral', view: { kind: 'diagram' }, external: null });
  });

  it('reload drops pending writes instead of overwriting what is on disk', async () => {
    const { diagram, workspace, adapter } = await setup();
    // An edit still inside the debounce (nothing written yet)...
    diagram.getState().apply([{ op: 'add_node', id: 'Local' }], { Local: { x: 0, y: 0 } });
    expect(workspace.hasUnsaved()).toBe(true);
    // ...while the agent already wrote its own version.
    const agent = jsonOf({ op: 'add_node', id: 'DoAgente' });
    adapter.files.set('diagrams/visao-geral.strukt.json', agent);

    await workspace.reload();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(adapter.files.get('diagrams/visao-geral.strukt.json')).toBe(agent);
    expect(diagram.getState().model.order).toEqual(['DoAgente']);
  });

  it('reload refuses while the diagram store is read-only and keeps the doc view when it still exists', async () => {
    const { diagram, workspace, adapter } = await setup();
    const doc = await workspace.create('doc', 'Notas');
    await workspace.flush();
    workspace.setExternal(['docs/notas.md']);
    await workspace.reload();
    expect(workspace.store.getState().view).toEqual({ kind: 'doc', slug: doc });

    diagram.getState().setReadOnly('travado para teste');
    await expect(workspace.reload()).rejects.toThrow('Aplique ou descarte a proposta da IA antes de trocar de diagrama.');
    expect(adapter.files.has('strukt.json')).toBe(true);
  });

  it('dismissExternal clears the notice without touching the files', async () => {
    const { workspace, adapter } = await setup();
    workspace.setExternal(['docs/x.md']);
    workspace.dismissExternal();
    expect(workspace.store.getState().external).toBeNull();
    expect(workspace.setExternal.bind(null, [])).not.toThrow();
    workspace.setExternal([]);
    expect(workspace.store.getState().external).toBeNull();
    expect(adapter.files.has('strukt.json')).toBe(true);
  });

  it('does not schedule a save nor mirror data for a routes-only update', async () => {
    const { diagram, workspace } = await setup();
    expect(workspace.store.getState().save).toBe('saved');
    diagram.getState().setRoutes({ 'X→Y': { points: [[0, 0], [1, 1]], key: 'k' } });
    expect(workspace.store.getState().save).toBe('saved');
    expect(workspace.hasUnsaved()).toBe(false);
  });

  it('gives a second item created with the same title a unique slug, keeping both files', async () => {
    const { workspace, adapter } = await setup();
    const first = await workspace.create('doc', 'API');
    const second = await workspace.create('doc', 'API');
    expect(first).not.toBe(second);
    expect(second).toBe('api-2');
    await workspace.flush();
    expect(adapter.files.has(`docs/${first}.md`)).toBe(true);
    expect(adapter.files.has(`docs/${second}.md`)).toBe(true);
  });

  it('removes a diagram that is not the current one without touching the current diagram or its files', async () => {
    const { diagram, workspace, adapter } = await setup();
    const bSlug = await workspace.create('diagram', 'B');
    await workspace.openDiagram('visao-geral');
    diagram.getState().apply([{ op: 'add_node', id: 'API' }], { API: { x: 0, y: 0 } });
    await workspace.remove('diagram', bSlug);
    expect(workspace.store.getState()).toMatchObject({ diagram: 'visao-geral', view: { kind: 'diagram' } });
    expect(diagram.getState().model.order).toEqual(['API']);
    await workspace.flush();
    expect(adapter.files.has(`diagrams/${bSlug}.strukt.json`)).toBe(false);
    expect(adapter.files.has(`diagrams/${bSlug}.layout.json`)).toBe(false);
    expect(adapter.files.get('diagrams/visao-geral.strukt.json')).toBe(jsonOf({ op: 'add_node', id: 'API' }));
  });

  it('does not swap to a new adapter while the diagram store is read-only, even once it has loaded', async () => {
    const { diagram, workspace, adapter } = await setup();
    const secondManifest = { version: 1, name: 'Outro', diagrams: [{ slug: 'x', title: 'X' }], docs: [], sketches: [] };
    const second = createMemoryAdapter({ 'strukt.json': printManifest(secondManifest), 'diagrams/x.strukt.json': jsonOf({ op: 'add_node', id: 'Y' }) }, 'Segundo');
    const filesBefore = new Map(second.files);
    diagram.getState().setReadOnly('travado para teste');
    await expect(workspace.open(second, () => { throw new Error('não deveria inicializar'); })).rejects.toThrow(
      'Aplique ou descarte a proposta da IA antes de trocar de diagrama.',
    );
    expect(workspace.store.getState().source).toEqual({ kind: 'memory', label: 'Memória' });
    expect(second.files).toEqual(filesBefore);
    diagram.getState().setReadOnly(null);
    diagram.getState().apply([{ op: 'add_node', id: 'API' }], { API: { x: 0, y: 0 } });
    await workspace.flush();
    expect(adapter.files.get('diagrams/visao-geral.strukt.json')).toBe(jsonOf({ op: 'add_node', id: 'API' }));
    expect(second.files).toEqual(filesBefore);
  });

  it('does not swap to a new adapter when a beforeSwitch hook engages the AI lock', async () => {
    const { diagram, workspace, adapter } = await setup();
    const secondManifest = { version: 1, name: 'Outro', diagrams: [{ slug: 'x', title: 'X' }], docs: [], sketches: [] };
    const second = createMemoryAdapter({ 'strukt.json': printManifest(secondManifest), 'diagrams/x.strukt.json': jsonOf({ op: 'add_node', id: 'Y' }) }, 'Segundo');
    const filesBefore = new Map(second.files);
    workspace.onBeforeSwitch((reload) => {
      if (reload) diagram.getState().setReadOnly('travado durante o gancho');
    });
    await expect(workspace.open(second, () => { throw new Error('não deveria inicializar'); })).rejects.toThrow(
      'Aplique ou descarte a proposta da IA antes de trocar de diagrama.',
    );
    expect(workspace.store.getState().source).toEqual({ kind: 'memory', label: 'Memória' });
    expect(second.files).toEqual(filesBefore);
    diagram.getState().setReadOnly(null);
    diagram.getState().apply([{ op: 'add_node', id: 'API' }], { API: { x: 0, y: 0 } });
    await workspace.flush();
    expect(adapter.files.get('diagrams/visao-geral.strukt.json')).toBe(jsonOf({ op: 'add_node', id: 'API' }));
  });

  describe('open() while the previous workspace still has pending saves', () => {
    const manifestOf = (name: string, slug: string, title: string) =>
      printManifest({ version: 1, name, diagrams: [{ slug, title }], docs: [], sketches: [] });
    const noInit = () => {
      throw new Error('não deveria inicializar');
    };
    const PREVIOUS_UNSAVED = 'Algumas mudanças do workspace anterior não puderam ser salvas.';

    it('strict project switching preserves the old session and pending saves on failure', async () => {
      const { workspace, a, edit } = await editedA();
      a.write = async () => { throw new Error('disco cheio'); };
      edit();
      const before = workspace.store.getState().source;
      const b = createMemoryAdapter({ 'strukt.json': manifestOf('B', 'outro', 'Outro') });
      await expect(workspace.open(b, noInit, { requireSaved: true })).rejects.toThrow('salvar o workspace atual');
      expect(workspace.storage()).toBe(a);
      expect(workspace.store.getState().source).toBe(before);
      expect(workspace.hasUnsaved()).toBe(true);
      await workspace.close();
    });

    /** Workspace A ("Sem título") open, with an edit still inside the save debounce. */
    async function editedA() {
      const diagram = createDiagramStore();
      const workspace = createWorkspace(diagram, { saveDelay: 50 });
      const a = createMemoryAdapter({ 'strukt.json': manifestOf('A', 'sem-titulo', 'Sem título'), 'diagrams/sem-titulo.strukt.json': jsonOf() });
      await workspace.open(a, noInit);
      const manifestA = a.files.get('strukt.json');
      return {
        diagram,
        workspace,
        a,
        manifestA,
        edit: () => diagram.getState().apply([{ op: 'add_node', id: 'API' }], { API: { x: 10, y: 20 } }),
      };
    }

    it('(a) writes them into the previous workspace, even when the new one lacks the slug', async () => {
      const { workspace, a, manifestA, edit } = await editedA();
      edit();
      const b = createMemoryAdapter({ 'strukt.json': manifestOf('B', 'outro', 'Outro'), 'diagrams/outro.strukt.json': jsonOf({ op: 'add_node', id: 'Fila' }) });
      await workspace.open(b, noInit);
      expect(workspace.store.getState().data!.manifest.name).toBe('B');
      expect(a.files.get('diagrams/sem-titulo.strukt.json')).toBe(jsonOf({ op: 'add_node', id: 'API' }));
      expect(a.files.has('diagrams/sem-titulo.layout.json')).toBe(true);
      expect(a.files.get('strukt.json')).toBe(manifestA);
    });

    it('(b) never writes the new workspace\'s content into a same-named file of the previous one', async () => {
      const { workspace, a, edit } = await editedA();
      edit();
      const b = createMemoryAdapter({ 'strukt.json': manifestOf('B', 'sem-titulo', 'Sem título'), 'diagrams/sem-titulo.strukt.json': jsonOf({ op: 'add_node', id: 'DeB' }) });
      const filesB = new Map(b.files);
      await workspace.open(b, noInit);
      expect(a.files.get('diagrams/sem-titulo.strukt.json')).toBe(jsonOf({ op: 'add_node', id: 'API' }));
      expect(b.files).toEqual(filesB);
    });

    it('(c) reopening the same storage after its files were replaced (zip import) never writes the old workspace back', async () => {
      const { workspace, a, edit } = await editedA();
      edit();
      const replacement = { 'strukt.json': manifestOf('Importado', 'sem-titulo', 'Sem título'), 'diagrams/sem-titulo.strukt.json': jsonOf({ op: 'add_node', id: 'Zip' }) };
      await replaceFiles(a, replacement);
      await workspace.open(a, noInit);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(Object.fromEntries(a.files)).toEqual(replacement);
      expect(workspace.store.getState().data!.manifest.name).toBe('Importado');
    });

    it('(d) mirrors and saves edits made while the previous workspace is still writing', async () => {
      const { diagram, workspace, a, edit } = await editedA();
      let release = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const { write, remove } = a;
      a.write = async (path, text) => {
        await gate;
        return write(path, text);
      };
      a.remove = async (path) => {
        await gate;
        return remove(path);
      };
      edit();
      const b = createMemoryAdapter({ 'strukt.json': manifestOf('B', 'outro', 'Outro'), 'diagrams/outro.strukt.json': jsonOf({ op: 'add_node', id: 'Fila' }) });
      const opening = workspace.open(b, noInit);
      await vi.waitFor(() => expect(workspace.store.getState().diagram).toBe('outro'));
      diagram.getState().apply([{ op: 'add_node', id: 'DuranteFlush' }], { DuranteFlush: { x: 0, y: 200 } });
      release();
      await opening;
      await workspace.flush();
      expect(workspace.store.getState().data!.diagrams.outro!.model.order).toEqual(['Fila', 'DuranteFlush']);
      expect(b.files.get('diagrams/outro.strukt.json')).toBe(jsonOf({ op: 'add_node', id: 'Fila' }, { op: 'add_node', id: 'DuranteFlush' }));
      expect(a.files.get('diagrams/sem-titulo.strukt.json')).toBe(jsonOf({ op: 'add_node', id: 'API' }));
    });

    it('(e) reports the previous workspace\'s failed writes as a warning, without touching the new indicator', async () => {
      const { workspace, a, edit } = await editedA();
      a.write = () => Promise.reject(new Error('sem permissão'));
      edit();
      const b = createMemoryAdapter({ 'strukt.json': manifestOf('B', 'outro', 'Outro'), 'diagrams/outro.strukt.json': jsonOf({ op: 'add_node', id: 'Fila' }) });
      const warnings = await workspace.open(b, noInit);
      expect(warnings).toContain(PREVIOUS_UNSAVED);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(workspace.store.getState()).toMatchObject({ save: 'saved', saveError: null });
    });

    it('(f) storage() follows the swap and a file scheduled before it lands in the old adapter with the data bound at schedule time', async () => {
      const { workspace, a, edit } = await editedA();
      edit();
      expect(workspace.storage()).toBe(a);
      // A caller (e.g. context sync) must capture whatever it needs from `data` up front, exactly like
      // the internal scheduleX helpers bind to `s.data`: the closure below never reads `workspace` again,
      // so it cannot pick up the next workspace's data no matter when the saver gets around to it.
      const nameAtSchedule = workspace.store.getState().data!.manifest.name;
      workspace.schedule('context/llms.txt', () => `# ${nameAtSchedule}\n`);
      const b = createMemoryAdapter({ 'strukt.json': manifestOf('B', 'outro', 'Outro'), 'diagrams/outro.strukt.json': jsonOf({ op: 'add_node', id: 'Fila' }) });
      await workspace.open(b, noInit);
      expect(workspace.storage()).toBe(b);
      expect(a.files.get('context/llms.txt')).toBe('# A\n');
      expect(b.files.has('context/llms.txt')).toBe(false);
      expect(workspace.store.getState()).toMatchObject({ save: 'saved', saveError: null });
    });
  });

  it('flushAndDispose disposes the saver (and unsubscribes) even when flush rejects', async () => {
    const dispose = vi.fn();
    const stop = vi.fn();
    const saver: Saver = {
      schedule: vi.fn(),
      flush: () => Promise.reject(new Error('falha ao salvar')),
      seed: vi.fn(),
      forget: vi.fn(),
      retry: () => Promise.resolve(),
      cancel: vi.fn(),
      status: 'pending',
      error: null,
      hasPending: () => false,
      subscribe: () => () => {},
      dispose,
    };
    await expect(flushAndDispose(saver, stop)).rejects.toThrow('falha ao salvar');
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  describe('drag gestures and renames', () => {
    const a = () => setup({
      'strukt.json': printManifest({ version: 1, name: 'Loja', diagrams: [{ slug: 'a', title: 'A' }], docs: [], sketches: [] }),
      'diagrams/a.strukt.json': jsonOf({ op: 'add_node', id: 'API' }, { op: 'add_node', id: 'Fila' }, { op: 'connect', from: 'API', to: 'Fila' }),
    });

    it('does not touch workspace data per moveLive frame during a gesture and persists the layout once at the end', async () => {
      const { diagram, workspace, adapter } = await a();
      const notify = vi.fn();
      const stop = workspace.store.subscribe(notify);
      const write = vi.spyOn(adapter, 'write');
      diagram.getState().beginGesture();
      for (let i = 1; i <= 20; i++) diagram.getState().moveLive({ API: { x: i * 10, y: 5 } });
      expect(notify).not.toHaveBeenCalled();
      await workspace.flush();
      expect(write).not.toHaveBeenCalled();
      diagram.getState().endGesture();
      expect(notify.mock.calls.length).toBeLessThanOrEqual(2); // data + save indicator, once
      await workspace.flush();
      expect(write.mock.calls.map(([path]) => path)).toEqual(['diagrams/a.layout.json']);
      expect(JSON.parse(adapter.files.get('diagrams/a.layout.json')!).nodes.API).toEqual({ x: 200, y: 5 });
      stop();
    });

    it('keeps flows and evidence on a rename with a single diffModels per commit', async () => {
      const core = await import('@strukt/core');
      const { diagram, workspace } = await a();
      workspace.setFlows('a', [{ id: 'f', title: 'F', steps: [{ from: 'API', to: 'Fila' }, { kind: 'process', node: 'API' }] }]);
      workspace.store.setState({ data: { ...workspace.store.getState().data!, evidence: { a: { API: [{ path: 'src/api.ts' }] } } as never } });
      const spy = vi.spyOn(core, 'diffModels');
      diagram.getState().apply([{ op: 'rename', id: 'API', to: 'Gateway' }]);
      const data = workspace.store.getState().data!;
      expect(JSON.stringify(data.flows!.a)).toContain('Gateway');
      expect(JSON.stringify(data.flows!.a)).not.toContain('"API"');
      expect(Object.keys(data.evidence!.a!)).toEqual(['Gateway']);
      expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
      spy.mockClear();
      diagram.getState().apply([{ op: 'add_node', id: 'Novo' }]);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});

describe('perspectives and levels', () => {
  const a = () => setup({
    'strukt.json': printManifest({ version: 1, name: 'Loja', diagrams: [{ slug: 'a', title: 'A' }], docs: [], sketches: [] }),
    'diagrams/a.strukt.json': jsonOf({ op: 'add_node', id: 'API' }, { op: 'add_node', id: 'Fila' }, { op: 'connect', from: 'API', to: 'Fila' }),
  });

  it('saves a diagram\'s perspectives to their own file and removes the file when none is left', async () => {
    const { workspace, adapter } = await a();
    workspace.setPerspectives('a', [{ id: 'riscos', name: 'Riscos', tags: ['risco:alto'] }]);
    await workspace.flush();
    expect(JSON.parse(adapter.files.get('diagrams/a.perspectives.json')!)).toEqual({ version: 1, perspectives: [{ id: 'riscos', name: 'Riscos', tags: ['risco:alto'] }] });
    workspace.setPerspectives('a', []);
    await workspace.flush();
    expect(adapter.files.has('diagrams/a.perspectives.json')).toBe(false);
  });

  it('does not touch the diagram, its history or its files when perspectives change', async () => {
    const { diagram, workspace, adapter } = await a();
    const model = diagram.getState().model;
    const past = diagram.getState().past.length;
    const before = adapter.files.get('diagrams/a.strukt.json');
    workspace.setPerspectives('a', [{ id: 'x', name: 'X', hide: ['API'] }]);
    await workspace.flush();
    expect(diagram.getState().model).toBe(model);
    expect(diagram.getState().past).toHaveLength(past);
    expect(adapter.files.get('diagrams/a.strukt.json')).toBe(before);
  });

  it('ignores a diagram that does not exist', async () => {
    const { workspace } = await a();
    workspace.setPerspectives('constructor', [{ id: 'x', name: 'X' }]);
    expect(workspace.store.getState().data!.perspectives?.constructor).toBeUndefined();
  });

  it('follows a renamed element in the perspectives with a single diffModels per commit', async () => {
    const core = await import('@strukt/core');
    const { diagram, workspace } = await a();
    workspace.setPerspectives('a', [{ id: 'x', name: 'X', include: ['API'], hide: ['Fila'] }]);
    const spy = vi.spyOn(core, 'diffModels');
    diagram.getState().apply([{ op: 'rename', id: 'API', to: 'Gateway' }]);
    expect(workspace.store.getState().data!.perspectives!.a![0]).toMatchObject({ include: ['Gateway'], hide: ['Fila'] });
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    await workspace.flush();
    expect(JSON.parse((workspace.storage() as ReturnType<typeof createMemoryAdapter>).files.get('diagrams/a.perspectives.json')!).perspectives[0].include).toEqual(['Gateway']);
  });

  it('removing the diagram removes its perspectives file', async () => {
    const { workspace, adapter } = await a();
    await workspace.create('diagram', 'Outro');
    workspace.setPerspectives('a', [{ id: 'x', name: 'X' }]);
    await workspace.flush();
    expect(adapter.files.has('diagrams/a.perspectives.json')).toBe(true);
    await workspace.remove('diagram', 'a');
    await workspace.flush();
    expect(adapter.files.has('diagrams/a.perspectives.json')).toBe(false);
  });

  it('sets levels in one step: shares the element, tags the entity, writes model.json, leaves the diagram alone', async () => {
    const { diagram, workspace, adapter } = await a();
    const model = diagram.getState().model;
    await workspace.setLevels('a', { API: 'container', Fila: 'componente' });
    await workspace.flush();
    const shared = workspace.store.getState().data!.shared!;
    const ids = shared.views.a!;
    expect(Object.keys(ids).sort()).toEqual(['API', 'Fila']);
    expect(shared.entities[ids.API!]!.tags).toEqual(['nivel:container']);
    expect(shared.entities[ids.Fila!]!.tags).toEqual(['nivel:componente']);
    expect(JSON.parse(adapter.files.get('model.json')!).entities[ids.API!].tags).toEqual(['nivel:container']);
    expect(diagram.getState().model).toBe(model);
    await workspace.setLevels('a', { API: null });
    expect(workspace.store.getState().data!.shared!.entities[ids.API!]!.tags).toBeUndefined();
  });
});

describe('applyCollaborativeDiagram (incremental remote apply)', () => {
  const node = (id: string, label = id) => ({ kind: 'node' as const, id, label });
  async function seeded() {
    const ctx = await setup();
    ctx.diagram.getState().apply([{ op: 'add_node', id: 'A' }, { op: 'add_node', id: 'B' }], { A: { x: 0, y: 0 }, B: { x: 100, y: 0 } });
    ctx.diagram.getState().apply([{ op: 'update', id: 'A', set: { label: 'Alpha' } }]);
    return ctx;
  }
  const remote = (state: ReturnType<Awaited<ReturnType<typeof seeded>>['diagram']['getState']>, mutate: (m: typeof state.model) => typeof state.model, nodes = state.layout.nodes) =>
    ({ model: mutate(structuredClone(state.model)), layout: { nodes: structuredClone(nodes), edges: {} } });

  it('keeps references of untouched elements but clears local undo/redo after a remote update', async () => {
    const { diagram, workspace } = await seeded();
    const before = diagram.getState();
    expect(before.past.length).toBeGreaterThan(0);
    const snapshot = remote(before, (m) => ({ ...m, elements: { ...m.elements, C: node('C') }, order: [...m.order, 'C'] }), { ...before.layout.nodes, C: { x: 5, y: 5 } });
    workspace.applyCollaborativeDiagram('visao-geral', snapshot);
    const after = diagram.getState();
    expect(after.model.elements.A).toBe(before.model.elements.A);
    expect(after.model.elements.B).toBe(before.model.elements.B);
    expect(after.model.elements.C).toMatchObject({ id: 'C' });
    expect(after.layout.nodes.A).toBe(before.layout.nodes.A);
    expect(after.past).toEqual([]);
    expect(after.future).toEqual([]);
  });

  it('local undo after a peer adds a node cannot delete that node', async () => {
    const { diagram, workspace } = await seeded();
    const before = diagram.getState();
    workspace.applyCollaborativeDiagram('visao-geral', remote(before, (m) => ({ ...m, elements: { ...m.elements, C: node('C') }, order: [...m.order, 'C'] }), { ...before.layout.nodes, C: { x: 5, y: 5 } }));
    diagram.getState().undo();
    expect(diagram.getState().model.elements.C).toMatchObject({ id: 'C' });
  });

  it('is a no-op (same state object) when nothing changed', async () => {
    const { diagram, workspace } = await seeded();
    const before = diagram.getState();
    workspace.applyCollaborativeDiagram('visao-geral', remote(before, (m) => m));
    expect(diagram.getState().model).toBe(before.model);
    expect(diagram.getState().layout).toBe(before.layout);
  });

  it('clears history when the remote deletes an element the local history references', async () => {
    const { diagram, workspace } = await seeded();
    const before = diagram.getState();
    const { A: _a, ...rest } = before.model.elements;
    const { A: _p, ...nodes } = before.layout.nodes;
    workspace.applyCollaborativeDiagram('visao-geral', remote(before, (m) => ({ ...m, elements: rest, order: ['B'] }), nodes));
    expect(diagram.getState().past).toEqual([]);
    expect(diagram.getState().future).toEqual([]);
    expect(diagram.getState().model.elements.A).toBeUndefined();
  });

  it('clears history when the remote edits an element the local history references', async () => {
    const { diagram, workspace } = await seeded();
    const before = diagram.getState();
    workspace.applyCollaborativeDiagram('visao-geral', remote(before, (m) => ({ ...m, elements: { ...m.elements, B: { ...node('B'), label: 'Remoto' } } })));
    expect(diagram.getState().past).toEqual([]);
    expect(diagram.getState().model.elements.B).toMatchObject({ label: 'Remoto' });
  });

  it('a doc whose concurrent moves closed a parent cycle opens as a valid diagram and renders', async () => {
    const { diagram, workspace } = await seeded();
    const doc = new Y.Doc();
    const before = diagram.getState();
    const groups = {
      G1: { kind: 'group' as const, id: 'G1' }, G2: { kind: 'group' as const, id: 'G2' }, N: { kind: 'node' as const, id: 'N', parentId: 'G1' },
    };
    seedCollaborativeDiagram(doc, remote(before, (m) => ({ ...m, elements: { ...m.elements, ...groups }, order: [...m.order, 'G1', 'G2', 'N'] }), { ...before.layout.nodes, N: { x: 400, y: 0 } }));
    doc.transact(() => {
      (doc.getMap('elements').get('G1') as Y.Map<unknown>).set('parentId', 'G2');
      (doc.getMap('elements').get('G2') as Y.Map<unknown>).set('parentId', 'G1');
    });
    workspace.applyCollaborativeDiagram('visao-geral', readCollaborativeDiagram(doc)!);
    const { model, layout, selection } = diagram.getState();
    expect(Object.keys(model.elements).sort()).toEqual(['A', 'B', 'G1', 'G2', 'N']);
    expect(model.elements.G1).toMatchObject({ parentId: 'G2' });
    expect(model.elements.G2!.parentId).toBeUndefined();
    expect(() => toFlow(model, layout, selection, 'light')).not.toThrow();
  });

  describe('create() and leftover versions', () => {
    it('clears orphan versions of a slug that is gone from the manifest and the disk', async () => {
      const { workspace, adapter } = await setup({ 'versions/novo/1-a.json': '{}' });
      await workspace.create('diagram', 'Novo');
      expect(await adapter.read('versions/novo/1-a.json')).toBeNull();
    });

    it('keeps versions of a diagram that is inside its undo window', async () => {
      const { workspace, adapter } = await setup({ 'versions/novo/1-a.json': '{}' });
      const off = workspace.keepVersionsWhile((slug) => slug === 'novo');
      await workspace.create('diagram', 'Novo');
      expect(await adapter.read('versions/novo/1-a.json')).toBe('{}');
      off();
    });

    it('keeps versions of a diagram an agent created on disk while the app was open (stale manifest)', async () => {
      const { workspace, adapter } = await setup();
      await adapter.write('diagrams/agente.strukt.json', jsonOf({ op: 'add_node', id: 'X' }));
      await adapter.write('versions/agente/1-a.json', '{}');
      await workspace.create('diagram', 'Agente');
      expect(await adapter.read('versions/agente/1-a.json')).toBe('{}');
    });
  });

  it('keeps a drag in progress pending when a remote diagram update lands', async () => {
    const { diagram, workspace } = await setup();
    diagram.getState().apply([{ op: 'add_node', id: 'API' }], { API: { x: 0, y: 0 } });
    diagram.getState().beginGesture();
    const { model, layout } = diagram.getState();
    workspace.applyCollaborativeDiagram('visao-geral', { model, layout: { ...layout, nodes: { API: { x: 5, y: 5 } } } });
    expect(diagram.getState().pending).not.toBeNull();
    diagram.getState().endGesture();
    expect(diagram.getState().pending).toBeNull();
  });
});

describe('shared sessions (collaboration): the diagram waits for its room', () => {
  const two = () => {
    const data = newWorkspace('Loja', { title: 'Mapa', snapshot: { model: emptyModel(), layout: { nodes: {}, edges: {} } } });
    return data;
  };
  async function shared(label = 'Rede local: repo') {
    const diagram = createDiagramStore();
    const workspace = createWorkspace(diagram, { saveDelay: 50 });
    const adapter = createMemoryAdapter({}, label);
    await workspace.open(adapter, two);
    await workspace.flush();
    await workspace.create('diagram', 'Outro');
    await workspace.openDiagram('mapa');
    return { diagram, workspace, adapter };
  }

  it.each(['Rede local: repo', 'Local network: repo', 'GitHub: org/repo'])('loads %s locked until the bridge syncs it, and never saves it through REST', async (label) => {
    const { diagram, workspace, adapter } = await shared(label);
    expect(diagram.getState().readOnly).toBe(COLLAB_WAITING_LOCK);
    const before = diagram.getState().model;
    diagram.getState().apply([{ op: 'add_node', id: 'Cedo' }]);
    expect(diagram.getState().model).toBe(before);
    // The bridge releases once the room's snapshot is applied: edits then go to the room, not the REST adapter.
    const written = adapter.files.get('diagrams/mapa.strukt.json');
    diagram.setState({ readOnly: null });
    diagram.getState().apply([{ op: 'add_node', id: 'API' }]);
    expect(own(workspace.store.getState().data!.diagrams, 'mapa')!.model.elements).toHaveProperty('API');
    await vi.advanceTimersByTimeAsync(100);
    expect(adapter.files.get('diagrams/mapa.strukt.json')).toBe(written);
  });

  it('switching diagrams replaces the waiting lock instead of being refused', async () => {
    const { diagram, workspace } = await shared('GitHub: org/repo');
    expect(diagram.getState().readOnly).toBe(COLLAB_WAITING_LOCK);
    await workspace.openDiagram('outro');
    expect(workspace.store.getState().diagram).toBe('outro');
    expect(diagram.getState().readOnly).toBe(COLLAB_WAITING_LOCK);
  });

  describe('a load is never a local edit of the room the bridge guards (P0: a switch copied one diagram into another room)', () => {
    /** What the collaboration bridge for `mapa` does with every store change: it would send it to Mapa's room. */
    async function pushedToMapaRoom(act: (workspace: ReturnType<typeof createWorkspace>) => Promise<unknown>) {
      const { diagram, workspace } = await shared();
      diagram.getState().setReadOnly(null);
      diagram.getState().apply([{ op: 'add_node', id: 'Web' }, { op: 'add_node', id: 'API' }], { Web: { x: 0, y: 0 }, API: { x: 200, y: 0 } });
      await workspace.flush();
      const pushed: string[][] = [];
      diagram.subscribe((state, before) => {
        if (!workspace.isLocalEdit('mapa')) return;
        if (state.model !== before.model || state.layout.nodes !== before.layout.nodes) pushed.push(state.model.order);
      });
      await act(workspace);
      return pushed;
    }

    it('opening another diagram', async () => {
      expect(await pushedToMapaRoom((workspace) => workspace.openDiagram('outro'))).toEqual([]);
    });

    it('creating a diagram while Mapa is open', async () => {
      expect(await pushedToMapaRoom((workspace) => workspace.create('diagram', 'Terceiro'))).toEqual([]);
    });

    it('deleting the open diagram', async () => {
      expect(await pushedToMapaRoom((workspace) => workspace.remove('diagram', 'mapa'))).toEqual([]);
    });

    it('opening another shared workspace whose first diagram has the same slug', async () => {
      const pushed = await pushedToMapaRoom(async (workspace) => {
        await workspace.open(createMemoryAdapter({}, 'Rede local: repo'), () => newWorkspace('Outra', { title: 'Mapa', snapshot: { model: emptyModel(), layout: { nodes: {}, edges: {} } } }));
      });
      expect(pushed).toEqual([]);
    });

    it('a real edit of the open diagram still counts', async () => {
      const { diagram, workspace } = await shared();
      diagram.getState().setReadOnly(null);
      let seen = 0;
      diagram.subscribe((state, before) => { if (workspace.isLocalEdit('mapa') && state.model !== before.model) seen++; });
      diagram.getState().apply([{ op: 'add_node', id: 'Web' }], { Web: { x: 0, y: 0 } });
      expect(seen).toBe(1);
      expect(workspace.isLocalEdit('outro')).toBe(false);
    });
  });

  describe('the list of items follows the other guests (applyRemoteManifest)', () => {
    const withSlugs = (manifest: Manifest, kind: 'diagrams' | 'docs', ...extra: string[]): Manifest => ({
      ...manifest, [kind]: [...manifest[kind], ...extra.map((slug) => ({ slug, title: slug }))],
    });

    it('shows an item another guest created, with its files loaded, and writes nothing', async () => {
      const { workspace, adapter } = await shared();
      const base = printManifest(workspace.store.getState().data!.manifest);
      adapter.files.set('diagrams/do-ana.strukt.json', jsonOf({ op: 'add_node', id: 'Web' }));
      adapter.files.set('docs/notas-ana.md', 'Olá');
      const theirs = printManifest(withSlugs(withSlugs(parseManifest(base).manifest, 'diagrams', 'do-ana'), 'docs', 'notas-ana'));
      const writes = vi.spyOn(adapter, 'write');
      const result = await workspace.applyRemoteManifest({ base, theirs });
      const data = workspace.store.getState().data!;
      expect(data.manifest.diagrams.map((item) => item.slug)).toEqual(['mapa', 'outro', 'do-ana']);
      expect(data.diagrams['do-ana']!.model.order).toEqual(['Web']);
      expect(data.docs['notas-ana']).toBe('Olá');
      expect(Object.keys(data.board.cards).length).toBeGreaterThan(0);
      expect(result.removed).toEqual([]);
      await vi.advanceTimersByTimeAsync(200);
      expect(writes).not.toHaveBeenCalled();
    });

    it('keeps an item this guest created and has not saved yet', async () => {
      const { workspace, adapter } = await shared();
      const base = printManifest(workspace.store.getState().data!.manifest);
      await workspace.create('diagram', 'Do Cris');
      adapter.files.set('diagrams/do-ana.strukt.json', jsonOf());
      await workspace.applyRemoteManifest({ base, theirs: printManifest(withSlugs(parseManifest(base).manifest, 'diagrams', 'do-ana')) });
      expect(workspace.store.getState().data!.manifest.diagrams.map((item) => item.slug)).toEqual(['mapa', 'outro', 'do-ana', 'do-cris']);
    });

    it('drops an item another guest deleted and says which', async () => {
      const { workspace } = await shared();
      const before = workspace.store.getState().data!.manifest;
      const theirs = printManifest({ ...before, diagrams: before.diagrams.filter((item) => item.slug !== 'outro') });
      const result = await workspace.applyRemoteManifest({ base: printManifest(before), theirs });
      expect(workspace.store.getState().data!.manifest.diagrams.map((item) => item.slug)).toEqual(['mapa']);
      expect(workspace.store.getState().data!.diagrams.outro).toBeUndefined();
      expect(result.removed).toEqual([{ kind: 'diagram', slug: 'outro', title: 'Outro' }]);
      expect(workspace.store.getState().diagram).toBe('mapa');
    });

    it('when the open diagram is the deleted one, leaves it clean: another diagram loaded, the Overview in view, the lock of that room gone', async () => {
      const { diagram, workspace } = await shared();
      expect(workspace.store.getState().diagram).toBe('mapa');
      diagram.getState().setReadOnly(null);
      diagram.getState().apply([{ op: 'add_node', id: 'Web' }], { Web: { x: 0, y: 0 } });
      const before = workspace.store.getState().data!.manifest;
      const theirs = printManifest({ ...before, diagrams: before.diagrams.filter((item) => item.slug !== 'mapa') });
      await workspace.applyRemoteManifest({ base: printManifest(before), theirs });
      const state = workspace.store.getState();
      expect(state.diagram).toBe('outro');
      expect(state.view).toEqual({ kind: 'board' });
      expect(diagram.getState().model.order).toEqual([]);
      expect(diagram.getState().readOnly).toBe(COLLAB_WAITING_LOCK); // the room of Outro, until the bridge syncs it
    });

    it('leaves a doc that was deleted: the view goes to the Overview', async () => {
      const { workspace, adapter } = await shared();
      await workspace.create('doc', 'Notas');
      await workspace.flush();
      expect(workspace.store.getState().view).toEqual({ kind: 'doc', slug: 'notas' });
      const before = workspace.store.getState().data!.manifest;
      await workspace.applyRemoteManifest({ base: printManifest(before), theirs: printManifest({ ...before, docs: [] }) });
      expect(workspace.store.getState().view).toEqual({ kind: 'board' });
      expect(workspace.store.getState().data!.docs.notas).toBeUndefined();
      expect(adapter.files.has('docs/notas.md')).toBe(true); // the files are the host's: never removed from here
    });

    it('ignores a manifest that is not one', async () => {
      const { workspace } = await shared();
      const before = workspace.store.getState().data;
      await workspace.applyRemoteManifest({ base: null, theirs: 'não é json' });
      expect(workspace.store.getState().data).toBe(before);
    });
  });

  it('keeps both mounted shared documents out of the REST saver until each room is released', async () => {
    const { workspace, adapter } = await setup();
    await workspace.create('doc', 'Primeiro');
    await workspace.create('doc', 'Segundo');
    await workspace.flush();
    const first = adapter.files.get('docs/primeiro.md');
    const second = adapter.files.get('docs/segundo.md');
    const releaseFirst = workspace.registerCollaborativeDoc('primeiro');
    const releaseSecond = workspace.registerCollaborativeDoc('segundo');
    workspace.setDoc('primeiro', 'primeiro compartilhado');
    workspace.setDoc('segundo', 'segundo compartilhado');
    await workspace.flush();
    expect(adapter.files.get('docs/primeiro.md')).toBe(first);
    expect(adapter.files.get('docs/segundo.md')).toBe(second);
    releaseFirst(); releaseFirst();
    workspace.setDoc('primeiro', 'primeiro local');
    workspace.setDoc('segundo', 'ainda compartilhado');
    await workspace.flush();
    expect(adapter.files.get('docs/primeiro.md')).toBe('primeiro local');
    expect(adapter.files.get('docs/segundo.md')).toBe(second);
    releaseSecond();
  });

  it('removing an item deletes the files its room wrote (the open diagram and doc too), however stale the load-time copy', async () => {
    const inner = createMemoryAdapter({}, 'Rede local: repo');
    // The guest's REST client: a write or remove sends what it last read (`expected`); the host refuses a mismatch.
    const seen = new Map<string, string | null>();
    const check = (path: string) => { if ((seen.get(path) ?? null) !== (inner.files.get(path) ?? null)) throw new Error('Arquivo alterado fora da sessão.'); };
    const adapter = {
      ...inner,
      read: async (path: string) => { const text = await inner.read(path); seen.set(path, text); return text; },
      write: async (path: string, text: string) => { check(path); await inner.write(path, text); seen.set(path, text); },
      remove: async (path: string) => { check(path); await inner.remove(path); seen.set(path, null); },
    };
    const diagram = createDiagramStore();
    const workspace = createWorkspace(diagram, { saveDelay: 50 });
    await workspace.open(adapter, two);
    await workspace.create('diagram', 'Outro');
    await workspace.create('doc', 'Notas');
    await workspace.openDiagram('mapa');
    await workspace.flush();
    workspace.setCollaborativeItem('doc', 'notas');
    // The rooms projected newer content than this guest ever read.
    for (const path of ['diagrams/mapa.strukt.json', 'diagrams/mapa.layout.json', 'diagrams/outro.strukt.json', 'docs/notas.md']) inner.files.set(path, `${inner.files.get(path) ?? ''} `);
    await workspace.remove('diagram', 'mapa');
    await workspace.remove('diagram', 'outro');
    await workspace.remove('doc', 'notas');
    await vi.advanceTimersByTimeAsync(100);
    await workspace.flush();
    expect(workspace.store.getState().saveError).toBeNull();
    for (const path of ['diagrams/mapa.strukt.json', 'diagrams/mapa.layout.json', 'diagrams/outro.strukt.json', 'diagrams/outro.layout.json', 'docs/notas.md']) expect(inner.files.has(path), path).toBe(false);
  });

  it('a plain (local) workspace never gets the waiting lock', async () => {
    const { diagram } = await setup();
    expect(diagram.getState().readOnly).toBeNull();
  });
});

it('splits into real saved diagrams in one batch and undoes the original and new files together', async () => {
  const { workspace, diagram, adapter } = await setup();
  diagram.getState().apply([
    { op: 'add_node', id: 'API', tech: 'Node.js', description: 'Recebe perguntas' },
    { op: 'add_node', id: 'Banco', icon: 'postgresql' },
    { op: 'add_node', id: 'Indexador' },
    { op: 'connect', from: 'API', to: 'Banco' },
    { op: 'connect', from: 'Indexador', to: 'Banco' },
  ], { API: { x: 10, y: 20 }, Banco: { x: 300, y: 20 }, Indexador: { x: 10, y: 160 } });
  const before = workspace.store.getState().data;
  const result = await workspace.splitDiagram([{ title: 'Consulta', elements: ['API', 'Banco'] }, { title: 'Ingestão', elements: ['Indexador', 'Banco'] }], new AbortController().signal);
  expect(result.slugs).toEqual(['visao-geral', 'ingestao']);
  expect(diagram.getState().model.order).toEqual(['API', 'Banco']);
  expect(workspace.store.getState().diagram).toBe('visao-geral');
  await workspace.flush();
  expect(adapter.files.get('diagrams/ingestao.strukt.json')).toContain('Indexador');
  expect(JSON.parse(adapter.files.get('diagrams/ingestao.layout.json')!).nodes.Banco).toEqual({ x: 300, y: 20 });
  expect(parseManifest(adapter.files.get('strukt.json')!).manifest.diagrams.map(d => d.title)).toEqual(['Consulta', 'Ingestão']);
  result.undo();
  await workspace.flush();
  expect(workspace.store.getState().data).toBe(before);
  expect(diagram.getState().model.order).toEqual(['API', 'Banco', 'Indexador']);
  expect(adapter.files.has('diagrams/ingestao.strukt.json')).toBe(false);
});

it('rejects incomplete, cancelled and concurrent splits without creating partial files', async () => {
  const { workspace, diagram, adapter } = await setup();
  diagram.getState().apply([{ op: 'add_node', id: 'API' }, { op: 'add_node', id: 'Banco' }, { op: 'connect', from: 'API', to: 'Banco' }]);
  const before = workspace.store.getState().data;
  await expect(workspace.splitDiagram([{ title: 'Um', elements: ['API'] }, { title: 'Dois', elements: ['Banco'] }], new AbortController().signal)).rejects.toThrow('perderia conexões');
  const controller = new AbortController(); controller.abort();
  const parts = [{ title: 'Um', elements: ['API', 'Banco'] }, { title: 'Dois', elements: ['Banco'] }];
  await expect(workspace.splitDiagram(parts, controller.signal)).rejects.toThrow();
  const pending = workspace.splitDiagram(parts, new AbortController().signal);
  diagram.getState().apply([{ op: 'add_node', id: 'Manual' }]);
  await expect(pending).rejects.toThrow('mudou');
  expect(workspace.store.getState().data!.manifest.diagrams).toEqual(before!.manifest.diagrams);
  await workspace.flush();
  expect(adapter.files.has('diagrams/dois.strukt.json')).toBe(false);
});

it('preserves subsequent edits when undoing a split and avoids stale files on disk', async () => {
  const { workspace, diagram, adapter } = await setup({ 'diagrams/ingestao.strukt.json': 'old file' });
  diagram.getState().apply([{ op: 'add_node', id: 'API' }, { op: 'add_node', id: 'Banco' }]);
  const result = await workspace.splitDiagram([{ title: 'Consulta', elements: ['API'] }, { title: 'Ingestão', elements: ['Banco'] }], new AbortController().signal);
  expect(result.slugs[1]).not.toBe('ingestao');
  workspace.rename('diagram', result.slugs[1]!, 'Ingestão revisada');
  expect(() => result.undo()).toThrow('alterações posteriores');
  expect(workspace.store.getState().data!.manifest.diagrams).toHaveLength(2);
  await workspace.flush();
  expect(adapter.files.get('diagrams/ingestao.strukt.json')).toBe('old file');
});

it('keeps a split in its folder with evidence and shared entity bindings, and rechecks pending editor changes', async () => {
  const { workspace, diagram } = await setup();
  diagram.getState().apply([{ op: 'add_node', id: 'API' }, { op: 'add_node', id: 'Banco' }]);
  workspace.createFolder('diagram', 'Arquitetura');
  workspace.moveItem('diagram', 'visao-geral', 'Arquitetura');
  workspace.setEvidence('visao-geral', 'Banco', [{ path: 'src/database.ts' }]);
  await workspace.setLevels('visao-geral', { Banco: 'container' });
  const parts = [{ title: 'Consulta', elements: ['API'] }, { title: 'Ingestão', elements: ['Banco'] }];
  await expect(workspace.splitDiagram(parts, new AbortController().signal, () => false)).rejects.toThrow('mudou');
  const result = await workspace.splitDiagram(parts, new AbortController().signal);
  const data = workspace.store.getState().data!;
  expect(data.manifest.diagrams.find(d => d.slug === result.slugs[1])?.folder).toBe('Arquitetura');
  expect(data.evidence?.[result.slugs[1]!]!.Banco).toEqual([{ path: 'src/database.ts' }]);
  expect(data.shared?.views[result.slugs[1]!]!.Banco).toBe(data.shared?.views['visao-geral']!.Banco);
  result.undo();
  expect(workspace.store.getState().data!.manifest.diagrams).toHaveLength(1);
});

it('organizes the sidebar atomically, persists and undoes metadata while preserving later document edits', async () => {
  const { workspace, adapter } = await setup();
  await workspace.create('doc', 'Decisão');
  const before = workspace.store.getState().data!.manifest;
  const undo = workspace.organize([{ op: 'create_folder', kind: 'diagram', path: 'Arquitetura' }, { op: 'move_item', kind: 'diagram', slug: 'visao-geral', folder: 'Arquitetura' }, { op: 'rename_item', kind: 'doc', slug: 'decisao', title: 'ADR' }], before);
  await workspace.flush();
  expect(parseManifest(adapter.files.get('strukt.json')!).manifest.diagrams[0]?.folder).toBe('Arquitetura');
  workspace.setDoc('decisao', 'Edição manual posterior');
  undo();
  expect(workspace.store.getState().data!.manifest).toBe(before);
  expect(workspace.store.getState().data!.docs.decisao).toBe('Edição manual posterior');
  expect(() => workspace.organize([{ op: 'move_item', kind: 'diagram', slug: 'missing', folder: 'A' }], before)).toThrow('não existe');
  expect(workspace.store.getState().data!.manifest).toBe(before);
});

it('updates an existing local workspace schema so canvas frame properties validate in external editors', async () => {
  const { workspace, adapter } = await setup({ 'strukt.json': printManifest({ version: 1, name: 'Projeto', diagrams: [], docs: [], sketches: [] }), 'strukt.schema.json': '{"old":true}' });
  await workspace.flush();
  expect(JSON.parse(adapter.files.get('strukt.schema.json')!).$defs.group.properties.canvasFrame).toMatchObject({ type: 'boolean' });
});
