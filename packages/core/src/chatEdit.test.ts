import { describe, expect, it } from 'vitest';
import { readChatEdit, sketchEditError } from './chatEdit';
const shape = { id: 'a', type: 'rectangle' as const, x: 0, y: 0, width: 100, height: 50 };
const sketch = { kind: 'sketch', summary: 'Bloco desenhado', clear: false, remove: [], upsert: [shape] };
describe('chat edit wire validation', () => {
  it('validates batches of new workspace items, including empty files and semantic sketch data', () => {
    const batch = { kind: 'create_workspace_items', summary: 'Arquivos criados', items: [{ kind: 'doc', title: 'Requisitos', folder: 'Planejamento', markdown: '# Requisitos' }, { kind: 'diagram', title: 'Arquitetura', ops: [] }, { kind: 'sketch', title: 'Fluxo', layout: 'horizontal', upsert: [{ ...shape, text: 'API' }] }] };
    expect(readChatEdit(batch)).toEqual(batch);
    for (const items of [[], Array.from({ length: 9 }, () => batch.items[0]), [{ kind: 'doc', title: '', markdown: '' }], [{ kind: 'doc', title: 'Nulo\u0000', markdown: '' }], [{ kind: 'diagram', title: 'Inválido', ops: null }], [{ kind: 'sketch', title: 'Inválido', upsert: [{ ...shape, width: -1 }] }], Array.from({ length: 2 }, () => ({ kind: 'doc', title: 'Grande', markdown: 'x'.repeat(160000) }))]) expect(readChatEdit({ ...batch, items })).toBeNull();
  });
  it('allows an empty document and an empty sketch when explicitly clearing', () => {
    expect(readChatEdit({ kind: 'doc', summary: 'Documento limpo', markdown: '' })).toBeTruthy();
    expect(readChatEdit({ ...sketch, clear: true, upsert: [] })).toBeTruthy();
  });
  it.each([null, {}, { ...sketch, summary: '' }, { ...sketch, remove: [3] }, { ...sketch, upsert: [shape, shape] }, ...[NaN, Infinity, -1].map((width) => ({ ...sketch, upsert: [{ ...shape, width }] })), { ...sketch, upsert: [{ ...shape, type: 'image', src: 'https://elsewhere' }] }, { ...sketch, upsert: [{ ...shape, type: 'text' }] }, { ...sketch, upsert: [{ ...shape, points: [[NaN, 0]] }] }])('rejects malformed or unsupported edits: %j', (value) => {
    expect(readChatEdit(value)).toBeNull();
  });
});

it('checks semantic sketch connections against the final scene', () => {
  const arrow = { ...shape, id: 'edge', type: 'arrow' as const, from: 'a', to: 'b' };
  const edit = { kind: 'sketch' as const, summary: 'Fluxo', clear: false, remove: [], upsert: [arrow] };
  expect(readChatEdit({ ...edit, layout: 'horizontal' })).toBeTruthy();
  const scene = [{ id: 'a', type: 'rectangle' }, { id: 'b', type: 'ellipse' }];
  expect(sketchEditError(edit, scene)).toBeNull();
  expect(sketchEditError({ ...edit, clear: true }, scene)).toContain('inexistente');
  expect(sketchEditError({ ...edit, remove: ['b'] }, scene)).toContain('inexistente');
  expect(sketchEditError({ ...edit, upsert: [arrow, { ...shape, id: 'b', type: 'ellipse' }] }, scene.slice(0, 1))).toBeNull();
  expect(readChatEdit({ ...edit, upsert: [{ ...arrow, to: undefined }] })).toBeNull();
  expect(readChatEdit({ ...edit, upsert: [{ ...shape, from: 'a', to: 'b' }] })).toBeNull();
  expect(readChatEdit({ ...edit, layout: 'random' })).toBeNull();
});

it('requires visible component names when organizing an architecture, preserving existing bound labels', () => {
  const edit = { kind: 'sketch' as const, summary: 'Organiza', layout: 'horizontal' as const, clear: false, remove: [], upsert: [shape] };
  expect(sketchEditError(edit, [])).toContain('sem nome');
  expect(sketchEditError({ ...edit, upsert: [{ ...shape, text: 'API' }] }, [])).toBeNull();
  expect(sketchEditError(edit, [{ id: 'a', type: 'rectangle' }, { id: 'label', type: 'text', containerId: 'a', text: 'API' }])).toBeNull();
  expect(sketchEditError({ ...edit, layout: undefined }, [])).toBeNull();
});
