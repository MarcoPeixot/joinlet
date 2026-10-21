import { describe, expect, it } from 'vitest';
import { MODELS } from './anthropic';
import { fakeClient, message } from './testing';
import { MAX_CHAT_REPAIRS, readChatTarget, replyToEditableChat } from './chatEdit';
const request = { context: 'Workspace de teste', messages: [{ role: 'user' as const, content: 'Adicione um cache' }] };
const target = { kind: 'diagram' as const, slug: 'teste', content: '{"version":1,"nodes":[{"id":"API"}],"connections":[]}' };
const run = (kind: string, input: unknown, current: import('@strukt/core').ChatTarget = target) => {
  const fake = fakeClient(...Array.from({ length: MAX_CHAT_REPAIRS + 1 }, () => message([{ type: 'tool_use', id: 't1', name: kind, input }])));
  return replyToEditableChat(fake.client, request, current, new AbortController().signal, MODELS);
};
describe('editable chat', () => {
  it('creates documents, diagrams and sketches together from an empty workspace or another open item', async () => {
    const workspace = JSON.stringify({ version: 1, name: 'Novo', diagrams: [], docs: [], sketches: [] });
    const input = { summary: 'Planejamento criado', items: [{ kind: 'doc', title: 'Requisitos', folder: 'Planejamento', markdown: '# Requisitos\n\nRetenção: a definir.' }, { kind: 'diagram', title: 'Transcrição', folder: 'Arquitetura', ops: [{ op: 'add_node', id: 'Participantes' }, { op: 'add_node', id: 'Transcrição' }, { op: 'connect', from: 'Participantes', to: 'Transcrição' }] }, { kind: 'sketch', title: 'Fluxo', layout: 'horizontal', upsert: [{ id: 'api', type: 'rectangle', x: 0, y: 0, width: 200, height: 100, text: 'API' }] }] };
    for (const current of [{ kind: 'workspace' as const, slug: 'workspace', content: workspace, workspace }, { ...target, workspace }]) {
      const fake = fakeClient(message([{ type: 'tool_use', id: 'create', name: 'create_workspace_items', input }]));
      expect(await replyToEditableChat(fake.client, request, current, new AbortController().signal, MODELS)).toMatchObject({ ok: true, edit: { kind: 'create_workspace_items', ...input } });
      expect(fake.calls[0]?.tools).toContainEqual(expect.objectContaining({ name: 'create_workspace_items' }));
      expect(fake.calls[0]?.system).toContain('inclusive no Quadro e com o workspace vazio');
    }
    expect(await run('create_workspace_items', { ...input, items: [{ ...input.items[0], folder: '../Inválido' }] }, { kind: 'workspace', slug: 'workspace', content: workspace, workspace })).toMatchObject({ ok: false });
    expect(await run('create_workspace_items', { ...input, items: [{ kind: 'diagram', title: 'Inválido', ops: [{ op: 'connect', from: 'A', to: 'B' }] }] }, { kind: 'workspace', slug: 'workspace', content: workspace, workspace })).toMatchObject({ ok: false });
  });
  it('merges multiple creation calls from providers and repairs every tool id atomically', async () => {
    const workspace = JSON.stringify({ version: 1, name: 'Novo', diagrams: [], docs: [], sketches: [] });
    const current = { kind: 'workspace' as const, slug: 'workspace', content: workspace, workspace };
    const calls = [{ type: 'tool_use', id: 'a', name: 'create_workspace_items', input: { summary: 'Documento criado', items: [{ kind: 'doc', title: 'Requisitos', markdown: '# Requisitos' }] } }, { type: 'tool_use', id: 'b', name: 'create_workspace_items', input: { summary: 'Diagrama criado', items: [{ kind: 'diagram', title: 'API', ops: [{ op: 'add_node', id: 'API' }] }] } }];
    const fake = fakeClient(message(calls));
    expect(await replyToEditableChat(fake.client, request, current, new AbortController().signal, MODELS)).toMatchObject({ ok: true, edit: { items: [{ kind: 'doc' }, { kind: 'diagram' }] } });
    const invalid = structuredClone(calls); invalid[1]!.input.items = [];
    const repaired = fakeClient(message(invalid), message(calls));
    expect(await replyToEditableChat(repaired.client, request, current, new AbortController().signal, MODELS)).toMatchObject({ ok: true, edit: { items: [{ kind: 'doc' }, { kind: 'diagram' }] } });
    expect(repaired.calls[1]?.messages.at(-1)?.content).toMatchObject([{ tool_use_id: 'a', is_error: true }, { tool_use_id: 'b', is_error: true }]);
  });
  it('keeps questions as text without mutations and forwards cancellation', async () => {
    const { client, calls, options } = fakeClient(message([{ type: 'text', text: 'A API recebe pedidos.' }], { stop_reason: 'end_turn' }));
    const signal = new AbortController().signal;
    expect(await replyToEditableChat(client, request, target, signal, MODELS)).toEqual({ ok: true, reply: 'A API recebe pedidos.' });
    expect(options[0]?.signal).toBe(signal);
    expect(calls[0]!.tools?.[0]).toMatchObject({ name: 'edit_diagram' });
    expect(calls[0]!.system).not.toContain('Você só conversa');
  });
  it('validates additions and clear against the current diagram', async () => {
    expect(await run('edit_diagram', { summary: 'Cache adicionado', ops: [{ op: 'add_node', id: 'Redis', icon: 'redis' }, { op: 'connect', from: 'API', to: 'Redis' }] })).toMatchObject({ ok: true, edit: { kind: 'diagram', ops: [{ op: 'add_node' }, { op: 'connect' }] } });
    expect(await run('edit_diagram', { summary: 'Diagrama limpo', ops: [{ op: 'remove', id: 'API' }] })).toMatchObject({ ok: true, edit: { ops: [{ op: 'remove', id: 'API' }] } });
    expect(await run('edit_diagram', { summary: 'Inválido', ops: [{ op: 'connect', from: 'API', to: 'Inexistente' }] })).toMatchObject({ ok: false });
  });
  it('accepts document rewrites and empty content to clear', async () => {
    for (const markdown of ['# Novo conteúdo', '']) expect(await run('edit_document', { summary: 'Documento atualizado', markdown }, { ...target, kind: 'doc', content: '# Antes' })).toMatchObject({ ok: true, edit: { kind: 'doc', markdown } });
  });
  it('checks sketch geometry and rejects unrelated tools', async () => {
    const current = { ...target, kind: 'sketch' as const, content: '{"elements":[]}' };
    const shape = { id: 'cache', type: 'rectangle', x: 20, y: 30, width: 120, height: 70 };
    expect(await run('edit_sketch', { summary: 'Cache desenhado', clear: false, remove: [], upsert: [shape] }, current)).toMatchObject({ ok: true, edit: { kind: 'sketch' } });
    expect(await run('edit_sketch', { summary: 'Inválido', clear: false, remove: [], upsert: [{ ...shape, width: -1 }] }, current)).toMatchObject({ ok: false });
    expect(await run('edit_document', { summary: 'Inválido', markdown: '' })).toMatchObject({ ok: false });
  });
  it('refuses malformed targets', () => {
    expect(readChatTarget({ ...target, slug: '../fora' })).toBeNull();
    expect(readChatTarget({ ...target, kind: 'board' })).toBeNull();
    expect(readChatTarget(target)).toEqual(target);
    expect(readChatTarget({ ...target, slug: 'API_v2' })).not.toBeNull();
  });
});

describe('streamed edits', () => {
  it('streams text but keeps tool JSON private until validation', async () => {
    const { streamEditableChat } = await import('./chatEdit');
    const client: import('./anthropic').AiClient = { beta: { messages: {
      create: async () => { throw new Error('stream expected'); },
      async *stream() {
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Vou adicionar o cache.' } };
        yield { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', name: 'edit_diagram', input: {} } };
        yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"summary":"Cache adicionado","ops":[' } };
        yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"op":"add_node","id":"Redis"}]}' } };
        yield { type: 'message_delta', delta: { stop_reason: 'tool_use' } };
      },
    } } };
    const events: import('./chatEdit').ChatEditEvent[] = [];
    for await (const event of streamEditableChat(client, request, target, new AbortController().signal, MODELS)) events.push(event);
    expect(events).toEqual([{ t: 'Vou adicionar o cache.' }, { edit: { kind: 'diagram', summary: 'Cache adicionado', ops: [{ op: 'add_node', id: 'Redis' }] } }]);
  });
  it('refuses a truncated tool and never yields an edit', async () => {
    const { streamEditableChat } = await import('./chatEdit');
    const client: import('./anthropic').AiClient = { beta: { messages: {
      create: async () => { throw new Error('stream expected'); },
      async *stream() {
        yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name: 'edit_diagram', input: {} } };
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"ops":[' } };
      },
    } } };
    const events: import('./chatEdit').ChatEditEvent[] = [];
    await expect(async () => { for await (const event of streamEditableChat(client, request, target, new AbortController().signal, MODELS)) events.push(event); }).rejects.toThrow('incompleta');
    expect(events).toEqual([]);
  });
});

describe('editable chat HTTP contract', () => {
  it('delivers a validated action before done, and rejects invalid targets', async () => {
    const { createApp } = await import('./app');
    const { client } = fakeClient(message([{ type: 'tool_use', id: 't1', name: 'edit_document', input: { summary: 'Documento limpo', markdown: '' } }]));
    const app = createApp({ ai: client });
    const res = await app.request('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...request, target: { kind: 'doc', slug: 'notas', content: 'Antes' }, stream: true }) });
    expect(res.status).toBe(200);
    const events = (await res.text()).trim().split('\n').map((s) => JSON.parse(s));
    expect(events).toEqual([{ t: 'Alteração preparada.' }, { edit: { kind: 'doc', summary: 'Documento limpo', markdown: '' } }, { done: true }]);
    const bad = await app.request('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...request, target: { kind: 'other' } }) });
    expect(bad.status).toBe(400);
  });
});

it('guides readable sketches and rejects dangling semantic arrows before application', async () => {
  const current = { ...target, kind: 'sketch' as const, content: '{"elements":[]}' };
  const input = { summary: 'Fluxo', layout: 'horizontal', clear: false, remove: [], upsert: [
    { id: 'api', type: 'rectangle', text: 'API', x: 0, y: 0, width: 192, height: 88 },
    { id: 'cache', type: 'rectangle', text: 'Cache', x: 0, y: 0, width: 192, height: 88 },
    { id: 'flow', type: 'arrow', from: 'api', to: 'cache', text: 'consulta', x: 0, y: 0, width: 0, height: 0 },
  ] };
  const fake = fakeClient(message([{ type: 'tool_use', id: 's1', name: 'edit_sketch', input }]));
  expect(await replyToEditableChat(fake.client, request, current, new AbortController().signal, MODELS)).toMatchObject({ ok: true, edit: input });
  expect(fake.calls[0]!.system).toContain('rótulo vinculado');
  expect(fake.calls[0]!.system).toContain('layout horizontal ou vertical');
  expect(fake.calls[0]!.system).not.toContain('add_node');
  expect(await run('edit_sketch', { ...input, upsert: input.upsert.slice(1) }, current)).toMatchObject({ ok: false });
});

it('offers a real split tool and validates the whole partition before emitting it', async () => {
  const current = { ...target, content: JSON.stringify({ version: 1, nodes: [{ id: 'API' }, { id: 'Banco' }, { id: 'Indexador' }], connections: [{ from: 'API', to: 'Banco' }, { from: 'Indexador', to: 'Banco' }] }) };
  const input = { summary: 'Consulta e ingestão separadas.', parts: [{ title: 'Consulta', elements: ['API', 'Banco'] }, { title: 'Ingestão', elements: ['Indexador', 'Banco'] }] };
  const fake = fakeClient(message([{ type: 'tool_use', id: 'split', name: 'split_diagram', input }]));
  expect(await replyToEditableChat(fake.client, request, current, new AbortController().signal, MODELS)).toMatchObject({ ok: true, edit: { kind: 'split_diagram', ...input } });
  expect(fake.calls[0]!.tools?.map(t => 'name' in t ? t.name : undefined)).toEqual(['edit_diagram', 'split_diagram', 'add_canvas_diagram']);
  expect(fake.calls[0]!.system).toContain('não peça que a pessoa crie');
  expect(await run('split_diagram', { ...input, parts: [{ title: 'Consulta', elements: ['API'] }, input.parts[1]] }, current)).toMatchObject({ ok: false });
  expect(await run('split_diagram', input, { ...current, kind: 'doc' })).toMatchObject({ ok: false });
});

it('supports multiple editable diagrams on one canvas and workspace folder organization', async () => {
  const workspace = JSON.stringify({ version: 1, name: 'RAG', diagrams: [{ slug: 'consulta', title: 'Consulta' }, { slug: 'ingestao', title: 'Ingestão' }], docs: [], sketches: [] });
  const current = { ...target, workspace };
  expect(await run('add_canvas_diagram', { title: 'Ingestão', summary: 'Novo diagrama ao lado', ops: [{ op: 'add_node', id: 'Indexador' }] }, current)).toMatchObject({ ok: true, edit: { kind: 'add_canvas_diagram', title: 'Ingestão' } });
  const input = { summary: 'Diagramas organizados em RAG', ops: [{ op: 'create_folder', kind: 'diagram', path: 'RAG' }, { op: 'move_item', kind: 'diagram', slug: 'consulta', folder: 'RAG' }, { op: 'move_item', kind: 'diagram', slug: 'ingestao', folder: 'RAG' }] };
  expect(await run('organize_workspace', input, current)).toMatchObject({ ok: true, edit: { kind: 'workspace', ...input } });
  expect(await run('organize_workspace', { ...input, ops: [...input.ops, { op: 'move_item', kind: 'diagram', slug: 'unknown', folder: 'RAG' }] }, current)).toMatchObject({ ok: false });
  expect(await run('organize_workspace', input, { kind: 'workspace', slug: 'workspace', content: workspace, workspace })).toMatchObject({ ok: true });
  const split = { summary: 'Dois desenhos no mesmo canvas', destination: 'canvas', parts: [{ title: 'Um', elements: ['API'] }, { title: 'Dois', elements: ['API'] }] };
  expect(await run('split_diagram', split, target)).toMatchObject({ ok: true, edit: { destination: 'canvas' } });
});
