import { printDiagramJson } from '@strukt/json';
import { orthogonalRouter } from '@strukt/layout';
import { describe, expect, it, vi } from 'vitest';
import { exampleSnapshot } from '../samples/example';
import { createDiagramStore } from '../state/diagramStore';
import { DRAFT_LOCK, FOREIGN_LOCK, createAiStore } from './aiStore';
import type { AiDeps } from './aiStore';
import type { OpsReply, OpsRequest } from './client';

function setup(reply: OpsReply, extra: Partial<AiDeps> = {}) {
  const diagram = createDiagramStore(exampleSnapshot());
  const requestOps = vi.fn(async (_body: OpsRequest) => reply);
  const flushCode = vi.fn(async () => {});
  const ai = createAiStore(diagram, { requestOps, flushCode, router: orthogonalRouter, ...extra });
  return { diagram, ai, requestOps, flushCode };
}

/** A promise this test controls the settling of, to freeze `submit()` mid-request. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const kafkaOut: OpsReply = { kind: 'ok', ops: [{ op: 'remove', id: 'Kafka' }], summary: 'Removi o Kafka.', model: 'claude-sonnet-5' };

describe('AI session', () => {
  it('sends the DSL, selection and mode, then shows a draft and locks editing', async () => {
    const { diagram, ai, requestOps } = setup(kafkaOut);
    diagram.getState().select({ nodes: ['Kafka'] });
    ai.getState().setPrompt('  remova o Kafka ');
    await ai.getState().submit();
    expect(requestOps).toHaveBeenCalledWith(
      { instruction: 'remova o Kafka', json: printDiagramJson(diagram.getState().model), selection: ['Kafka'], mode: 'edit' },
      expect.any(AbortSignal),
    );
    const { draft } = ai.getState();
    expect(draft).toMatchObject({ source: 'ai', model: 'claude-sonnet-5', summary: 'Removi o Kafka.' });
    expect(draft!.changes.elements.removed).toEqual(['Kafka']);
    expect(diagram.getState().readOnly).toBe(DRAFT_LOCK);
    expect(diagram.getState().model.elements.Kafka).toBeDefined();
  });

  it('flushes pending Código edits before asking, before showing and before applying', async () => {
    const { diagram, ai, requestOps, flushCode } = setup(kafkaOut);
    // A pending text edit commits on flush: the request must already see it.
    flushCode.mockImplementationOnce(async () => void diagram.getState().apply([{ op: 'add_node', id: 'Log' }], { Log: { x: 0, y: 600 } }));
    ai.getState().setPrompt('remova o Kafka');
    await ai.getState().submit();
    expect(requestOps.mock.calls[0]![0].json).toContain('Log');
    expect(flushCode).toHaveBeenCalledTimes(2);
    await ai.getState().apply();
    expect(flushCode).toHaveBeenCalledTimes(3);
  });

  it('applies the draft as one undo step and unlocks', async () => {
    const { diagram, ai } = setup(kafkaOut);
    ai.getState().setPrompt('remova o Kafka');
    await ai.getState().submit();
    expect(await ai.getState().apply()).toBe(true);
    expect(diagram.getState()).toMatchObject({ readOnly: null });
    expect(diagram.getState().model.elements.Kafka).toBeUndefined();
    expect(diagram.getState().past).toHaveLength(1);
    expect(ai.getState()).toMatchObject({ draft: null, prompt: '' });
    diagram.getState().undo();
    expect(diagram.getState().model.elements.Kafka).toBeDefined();
  });

  it('discards the draft, also when the panel closes', async () => {
    const { diagram, ai } = setup(kafkaOut);
    const before = diagram.getState().model;
    ai.getState().setOpen(true);
    ai.getState().setPrompt('remova o Kafka');
    await ai.getState().submit();
    ai.getState().discard();
    expect(diagram.getState()).toMatchObject({ model: before, readOnly: null });
    await ai.getState().submit();
    ai.getState().setOpen(false);
    expect(ai.getState().draft).toBeNull();
    expect(diagram.getState().readOnly).toBeNull();
  });

  it('offline rules rename by label when the session says ids must stay (collaboration)', async () => {
    const { ai } = setup({ kind: 'offline', reason: 'Servidor de IA fora do ar.' }, { keepIds: async () => true });
    ai.getState().setPrompt('renomeie Pedidos para Encomendas');
    await ai.getState().submit();
    expect(ai.getState().draft!.changes.elements.removed).toEqual([]);
    expect(ai.getState().draft!.ops).toEqual([{ op: 'update', id: 'Pedidos', set: { label: 'Encomendas' } }]);
  });

  it('falls back to the offline interpreter when the server is off', async () => {
    const { ai } = setup({ kind: 'offline', reason: 'Servidor de IA fora do ar.' });
    ai.getState().setPrompt('adicione Redis entre API Gateway e Pedidos');
    await ai.getState().submit();
    expect(ai.getState()).toMatchObject({ offlineReason: 'Servidor de IA fora do ar.', draft: { source: 'offline', summary: 'Adicionei "Redis" entre "API Gateway" e "Pedidos".' } });
    ai.getState().discard();
    ai.getState().setMode('generate');
    await ai.getState().submit();
    expect(ai.getState().notice).toEqual({ kind: 'error', text: '"Gerar do zero" precisa do servidor de IA. Servidor de IA fora do ar.' });
  });

  it('reports errors, empty proposals and stale answers without locking', async () => {
    const failing = setup({ kind: 'error', message: 'A IA recusou este pedido.' });
    failing.ai.getState().setPrompt('x');
    await failing.ai.getState().submit();
    expect(failing.ai.getState()).toMatchObject({ status: 'idle', draft: null, notice: { kind: 'error', text: 'A IA recusou este pedido.' } });
    expect(failing.diagram.getState().readOnly).toBeNull();

    const nothing = setup({ kind: 'ok', ops: [], summary: 'O diagrama já tem isso.', model: 'claude-sonnet-5' });
    nothing.ai.getState().setPrompt('x');
    await nothing.ai.getState().submit();
    expect(nothing.ai.getState()).toMatchObject({ draft: null, notice: { kind: 'info', text: 'O diagrama já tem isso.' } });

    const stale = setup(kafkaOut);
    stale.requestOps.mockImplementation(async () => {
      stale.diagram.getState().apply([{ op: 'add_node', id: 'Novo' }]);
      return kafkaOut;
    });
    stale.ai.getState().setPrompt('remova o Kafka');
    await stale.ai.getState().submit();
    expect(stale.ai.getState()).toMatchObject({ draft: null, notice: { kind: 'error', text: 'O diagrama mudou enquanto a IA respondia. Envie de novo.' } });

    const empty = setup(kafkaOut);
    await empty.ai.getState().submit();
    expect(empty.requestOps).not.toHaveBeenCalled();
    expect(empty.ai.getState().notice).toEqual({ kind: 'error', text: 'Descreva o que a IA deve fazer.' });
  });

  it('reports each applied draft, never a discarded one', async () => {
    const onApplied = vi.fn();
    const { diagram, ai } = setup(kafkaOut, { onApplied });
    ai.getState().setPrompt('remova o Kafka');
    await ai.getState().submit();
    ai.getState().discard();
    expect(onApplied).not.toHaveBeenCalled();
    await ai.getState().submit();
    expect(await ai.getState().apply()).toBe(true);
    expect(onApplied).toHaveBeenCalledOnce();
    expect(onApplied.mock.calls[0]![0]).toMatchObject({ summary: 'Removi o Kafka.', source: 'ai' });
    expect(diagram.getState().model.elements.Kafka).toBeUndefined();
  });

  it('fits the view after applying a draft laid out by ELK', async () => {
    const { model } = exampleSnapshot();
    const clear = model.order.filter((id) => !model.elements[id]!.parentId).map((id) => ({ op: 'remove' as const, id }));
    const onAutoLayout = vi.fn();
    const { ai } = setup(
      { kind: 'ok', ops: [...clear, { op: 'add_node', id: 'A' }], summary: 'Criei.', model: 'claude-opus-5-5' },
      { onAutoLayout, runLayout: async () => ({ A: { x: 0, y: 0 } }) },
    );
    ai.getState().setMode('generate');
    ai.getState().setPrompt('um nó');
    await ai.getState().submit();
    expect(await ai.getState().apply()).toBe(true);
    expect(onAutoLayout).toHaveBeenCalledOnce();
  });

  it('refuses a second submit while one is already loading', async () => {
    const pending = deferred<OpsReply>();
    const requestOps = vi.fn(async () => pending.promise);
    const { ai } = setup(kafkaOut, { requestOps });
    ai.getState().setPrompt('remova o Kafka');
    const first = ai.getState().submit();
    await vi.waitFor(() => expect(requestOps).toHaveBeenCalledOnce());
    await ai.getState().submit();
    expect(requestOps).toHaveBeenCalledOnce();
    pending.resolve(kafkaOut);
    await first;
  });

  it('never replaces a lock somebody else took while the request was in flight: no draft, a toast, their lock stays', async () => {
    const pending = deferred<OpsReply>();
    const onBlocked = vi.fn();
    const { diagram, ai } = setup(kafkaOut, { requestOps: async () => pending.promise, onBlocked });
    ai.getState().setPrompt('remova o Kafka');
    const submitting = ai.getState().submit();
    await vi.waitFor(() => expect(ai.getState().status).toBe('loading'));
    diagram.getState().setReadOnly('Modo apresentação: saia para editar.');
    pending.resolve(kafkaOut);
    await submitting;
    expect(ai.getState().draft).toBeNull();
    expect(ai.getState().status).toBe('idle');
    expect(diagram.getState().readOnly).toBe('Modo apresentação: saia para editar.');
    expect(onBlocked).toHaveBeenCalledWith(FOREIGN_LOCK);
    // Their lock is not ours to release: discarding leaves it alone.
    ai.getState().discard();
    expect(diagram.getState().readOnly).toBe('Modo apresentação: saia para editar.');
  });

  it('cancels a request abandoned by closing the panel: no late draft or lock, and the fetch is aborted', async () => {
    const pending = deferred<OpsReply>();
    let signal: AbortSignal | undefined;
    const requestOps = vi.fn(async (_body: OpsRequest, sig?: AbortSignal) => {
      signal = sig;
      return pending.promise;
    });
    const { diagram, ai } = setup(kafkaOut, { requestOps });
    ai.getState().setPrompt('remova o Kafka');
    const submitting = ai.getState().submit();
    await vi.waitFor(() => expect(requestOps).toHaveBeenCalledOnce());
    ai.getState().setOpen(false);
    expect(signal?.aborted).toBe(true);
    pending.resolve(kafkaOut);
    await submitting;
    expect(ai.getState()).toMatchObject({ draft: null, status: 'idle' });
    expect(diagram.getState().readOnly).toBeNull();
  });

  it('cancels a request abandoned by discard: no late draft or lock, and the fetch is aborted', async () => {
    const pending = deferred<OpsReply>();
    let signal: AbortSignal | undefined;
    const requestOps = vi.fn(async (_body: OpsRequest, sig?: AbortSignal) => {
      signal = sig;
      return pending.promise;
    });
    const { diagram, ai } = setup(kafkaOut, { requestOps });
    ai.getState().setPrompt('remova o Kafka');
    const submitting = ai.getState().submit();
    await vi.waitFor(() => expect(requestOps).toHaveBeenCalledOnce());
    ai.getState().discard();
    expect(signal?.aborted).toBe(true);
    pending.resolve(kafkaOut);
    await submitting;
    expect(ai.getState()).toMatchObject({ draft: null, status: 'idle' });
    expect(diagram.getState().readOnly).toBeNull();
  });

  it('does not apply a draft discarded while its pending Código flush was running', async () => {
    const { diagram, ai, flushCode } = setup(kafkaOut);
    ai.getState().setPrompt('remova o Kafka');
    await ai.getState().submit();
    flushCode.mockImplementationOnce(async () => void ai.getState().discard());
    expect(await ai.getState().apply()).toBe(false);
    expect(diagram.getState().model.elements.Kafka).toBeDefined();
    expect(diagram.getState().readOnly).toBeNull();
    expect(ai.getState().draft).toBeNull();
  });

  it('recovers to idle and reports the error when the request throws unexpectedly', async () => {
    const { ai, diagram } = setup(kafkaOut, {
      requestOps: vi.fn(async () => {
        throw new Error('Falha de rede.');
      }),
    });
    ai.getState().setPrompt('remova o Kafka');
    await ai.getState().submit();
    expect(ai.getState()).toMatchObject({ status: 'idle', draft: null, notice: { kind: 'error', text: 'Falha de rede.' } });
    expect(diagram.getState().readOnly).toBeNull();
  });

  it('treats a layout-only change during the request as stale, without locking', async () => {
    const { diagram, ai } = setup(kafkaOut, {
      requestOps: vi.fn(async () => {
        // No model change (arrange never touches it), only the layout moves under the request.
        diagram.getState().arrange({ Kafka: { x: 999, y: 999 } });
        return kafkaOut;
      }),
    });
    ai.getState().setPrompt('remova o Kafka');
    await ai.getState().submit();
    expect(ai.getState()).toMatchObject({ draft: null, notice: { kind: 'error', text: 'O diagrama mudou enquanto a IA respondia. Envie de novo.' } });
    expect(diagram.getState().readOnly).toBeNull();
  });
});
