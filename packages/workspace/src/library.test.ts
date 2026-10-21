import { applyOps, emptyModel, semanticView } from '@strukt/core';
import { describe, expect, it } from 'vitest';
import { emptyLibrary, parseLibrary, printLibrary, templateFromDiagram } from './library';
import { newWorkspace, loadWorkspace, removeItem, workspaceFiles } from './workspace';
import { createMemoryAdapter } from './storage';

describe('workspace library', () => {
  it('keeps reusable boundary presets distinct from service nodes', () => {
    const library = {components:[{id:'vpc',label:'VPC',category:'AWS',description:'Rede',kind:'group' as const,icon:'aws:group-virtual-private-cloud-vpc',color:'gray',width:400,height:260}],templates:[]};
    expect(parseLibrary(printLibrary(library))).toEqual(library);
  });
  it('roundtrips reusable tables with defaults and authored positions', () => {
    const applied = applyOps(emptyModel(), [
      { op: 'add_node', id: 'Clientes', presentation: 'table', fields: [{ name: 'id', type: 'uuid', key: 'PK' }] },
      { op: 'add_node', id: 'Pedidos', presentation: 'table', fields: [{ name: 'cliente_id', type: 'uuid', key: 'FK' }] },
      { op: 'connect', from: 'Clientes', to: 'Pedidos', connector: '-', fromCardinality: 'one', toCardinality: 'zero-many' },
    ]);
    if (!applied.ok) throw new Error(applied.error.message);
    const positions = { Clientes: { x: 12, y: 24, w: 260 }, Pedidos: { x: 400, y: 24 } };
    const template = templateFromDiagram('my-erd', 'Dados', 'Modelo de clientes e pedidos', applied.model, positions);
    const library = { components: [{ id: 'my-table', label: 'Tabela', category: 'Dados internos', description: 'Tabela da aplicação', color: 'gray', presentation: 'table' as const, fields: [{ name: 'id', type: 'uuid', key: 'PK' as const }], width: 260 }], templates: [template] };
    const restored = parseLibrary(printLibrary(library));
    expect(restored.components).toEqual(library.components);
    expect(restored.templates[0]!.positions).toEqual(positions);
    const copy = applyOps(emptyModel(), restored.templates[0]!.ops);
    expect(copy.ok && semanticView(copy.model)).toEqual(semanticView(applied.model));
  });

  it('preserves library on item removal and workspace export/reopen', async () => {
    const data = newWorkspace('A');
    data.library = { components: [{ id: 'mine', label: 'API própria', category: 'Minha empresa', description: '', color: 'gray', icon: 'server', presentation: 'card' }], templates: [] };
    const next = removeItem(data, 'diagram', 'unused');
    const reopened = await loadWorkspace(createMemoryAdapter(workspaceFiles(next)));
    expect(reopened?.data.library).toEqual(data.library);
    expect(reopened?.warnings).toEqual([]);
    expect(workspaceFiles(newWorkspace('B'))['library.json']).toBeUndefined();
  });

  it('does not write an empty library into old workspaces', () => {
    const data = newWorkspace('A');
    data.library = emptyLibrary();
    expect(workspaceFiles(data)['library.json']).toBeUndefined();
  });

  it.each([
    { components: [{ id: 'x', label: 'API', category: 'Own', color: 'gray', presentation: 'unknown' }], templates: [] },
    { components: [{ id: 'x', label: 'API', category: 'Own', color: 'gray', width: -1 }], templates: [] },
    { components: [], templates: [{ id: 'x', title: 'Broken', ops: [{ op: 'connect', from: 'missing', to: 'node' }] }] },
    { components: [], templates: [{ id: 'x', title: 'Broken', ops: [{ op: 'add_node', id: 'A' }], positions: { Z: { x: 0, y: 0 } } }] },
    { components: [], templates: [{ id: 'x', title: 'Broken', ops: [null] }] },
  ])('rejects invalid library entries instead of silently losing defaults', (library) => {
    expect(() => parseLibrary(JSON.stringify({ version: 1, ...library }))).toThrow('library.json');
  });

  it('preserves invalid imported library and reports a warning', async () => {
    const invalid = '{"version":999,"components":[],"templates":[]}';
    const adapter = createMemoryAdapter({ ...workspaceFiles(newWorkspace('A')), 'library.json': invalid });
    const loaded = await loadWorkspace(adapter);
    expect(loaded?.warnings[0]).toContain('library.json');
    expect(adapter.files.get('library.json')).toBe(invalid);
    expect(adapter.files.get('library.json.bak')).toBe(invalid);
  });
});
