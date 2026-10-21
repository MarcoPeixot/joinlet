import { applyOps, emptyModel } from '@strukt/core';
import { describe, expect, it, vi } from 'vitest';
import { exampleSnapshot } from '../samples/example';
import { createDiagramStore } from '../state/diagramStore';
import type { DocReply } from './client';
import { createDocSession } from './doc';

describe('documentation session', () => {
  it('sends the current JSON and shows the markdown', async () => {
    const requestDoc = vi.fn(async (_json: string): Promise<DocReply> => ({ kind: 'ok', markdown: '# Loja' }));
    const flushCode = vi.fn(async () => {});
    const doc = createDocSession(createDiagramStore(exampleSnapshot()), { requestDoc, flushCode });
    const pending = doc.generate();
    expect(doc.store.getState()).toMatchObject({ open: true, status: 'loading' });
    await pending;
    expect(flushCode).toHaveBeenCalledOnce();
    expect(requestDoc.mock.calls[0]![0]).toContain('"icon": "nginx"');
    expect(doc.store.getState()).toMatchObject({ status: 'ready', markdown: '# Loja', error: null });
  });

  it('explains offline mode, server errors and empty diagrams in pt-BR', async () => {
    const offline = createDocSession(createDiagramStore(exampleSnapshot()), { requestDoc: async () => ({ kind: 'offline', reason: 'Servidor de IA fora do ar.' }) });
    await offline.generate();
    expect(offline.store.getState()).toMatchObject({ status: 'error', error: 'Gerar documentação precisa do servidor de IA. Servidor de IA fora do ar.' });
    const failing = createDocSession(createDiagramStore(exampleSnapshot()), { requestDoc: async () => ({ kind: 'error', message: 'A IA recusou este pedido.' }) });
    await failing.generate();
    expect(failing.store.getState().error).toBe('A IA recusou este pedido.');
    const requestDoc = vi.fn(async (): Promise<DocReply> => ({ kind: 'ok', markdown: '' }));
    const empty = createDocSession(createDiagramStore({ model: emptyModel(), layout: { nodes: {}, edges: {} } }), { requestDoc });
    await empty.generate();
    expect(empty.store.getState()).toMatchObject({ status: 'error', error: 'O diagrama está vazio.' });
    expect(requestDoc).not.toHaveBeenCalled();
  });

  it('never calls requestDoc when closed during a pending flushCode', async () => {
    let resolveFlush!: () => void;
    const flushCode = vi.fn(() => new Promise<void>((resolve) => (resolveFlush = resolve)));
    const requestDoc = vi.fn(async (): Promise<DocReply> => ({ kind: 'ok', markdown: '# tarde demais' }));
    const doc = createDocSession(createDiagramStore(exampleSnapshot()), { requestDoc, flushCode });
    const pending = doc.generate();
    doc.close();
    resolveFlush();
    await pending;
    expect(requestDoc).not.toHaveBeenCalled();
    expect(doc.store.getState()).toMatchObject({ open: false });
  });

  it('leaves the state at error (not loading) when flushCode rejects', async () => {
    const flushCode = vi.fn(async (): Promise<void> => {
      throw new Error('Falha ao salvar o texto.');
    });
    const doc = createDocSession(createDiagramStore(exampleSnapshot()), { requestDoc: vi.fn(), flushCode });
    await doc.generate();
    expect(doc.store.getState()).toMatchObject({ status: 'error', error: 'Falha ao salvar o texto.' });
  });

  it('aborts the signal passed to requestDoc when closed while the request is pending', async () => {
    let signal: AbortSignal | undefined;
    const requestDoc = vi.fn((_json: string, sig?: AbortSignal) => {
      signal = sig;
      return new Promise<DocReply>(() => {});
    });
    const doc = createDocSession(createDiagramStore(exampleSnapshot()), { requestDoc });
    void doc.generate();
    await vi.waitFor(() => expect(requestDoc).toHaveBeenCalledOnce());
    doc.close();
    expect(signal?.aborted).toBe(true);
  });

  it('drops an answer that arrives after the modal was closed', async () => {
    let answer: (reply: DocReply) => void = () => {};
    const model = applyOps(emptyModel(), [{ op: 'add_node', id: 'A' }]);
    if (!model.ok) throw new Error(model.error.message);
    const doc = createDocSession(createDiagramStore({ model: model.model, layout: { nodes: {}, edges: {} } }), {
      requestDoc: () => new Promise<DocReply>((resolve) => (answer = resolve)),
    });
    const pending = doc.generate();
    await Promise.resolve();
    doc.close();
    answer({ kind: 'ok', markdown: '# tarde demais' });
    await pending;
    expect(doc.store.getState()).toMatchObject({ open: false, markdown: '' });
  });
});
