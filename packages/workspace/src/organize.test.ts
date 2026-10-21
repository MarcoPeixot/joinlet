import { describe, expect, it } from 'vitest';
import { organizeWorkspace } from './organize';
import { emptyManifest } from './manifest';
const manifest = { ...emptyManifest('Projeto'), diagrams: [{ slug: 'consulta', title: 'Consulta' }, { slug: 'ingestao', title: 'Ingestão' }], docs: [{ slug: 'adr', title: 'Decisão' }] };
describe('workspace organization batches', () => {
  it('creates folders, moves and renames items and folders without changing slugs or other kinds', () => {
    const next = organizeWorkspace(manifest, [{ op: 'create_folder', kind: 'diagram', path: 'RAG' }, { op: 'move_item', kind: 'diagram', slug: 'consulta', folder: 'RAG/Consulta' }, { op: 'move_item', kind: 'diagram', slug: 'ingestao', folder: 'RAG/Ingestão' }, { op: 'rename_folder', kind: 'diagram', from: 'RAG', to: 'Arquitetura' }, { op: 'rename_item', kind: 'diagram', slug: 'consulta', title: 'Fluxo de consulta' }]);
    expect(next.diagrams).toEqual([{ slug: 'consulta', title: 'Fluxo de consulta', folder: 'Arquitetura/Consulta' }, { slug: 'ingestao', title: 'Ingestão', folder: 'Arquitetura/Ingestão' }]);
    expect(next.docs).toBe(manifest.docs); expect(manifest.diagrams[0]).not.toHaveProperty('folder');
  });
  it('rejects an entire batch for nonexistent items, traversal, self moves and excessive depth', () => {
    for (const folder of ['../fora', 'A/B/C/D/E']) expect(() => organizeWorkspace(manifest, [{ op: 'move_item', kind: 'diagram', slug: 'consulta', folder }])).toThrow();
    expect(() => organizeWorkspace(manifest, [{ op: 'create_folder', kind: 'diagram', path: 'Válida' }, { op: 'move_item', kind: 'diagram', slug: 'inexistente', folder: 'Válida' }])).toThrow('não existe');
    const nested = organizeWorkspace(manifest, [{ op: 'create_folder', kind: 'diagram', path: 'A/B/C/D' }]);
    expect(() => organizeWorkspace(nested, [{ op: 'rename_folder', kind: 'diagram', from: 'A', to: 'X/Y' }])).toThrow('profundidade');
  });
});
