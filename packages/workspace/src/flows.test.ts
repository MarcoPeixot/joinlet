import { describe, expect, it } from 'vitest';
import { emptyModel } from '@strukt/core';
import { flowEdge, flowFrames, flowStepIssue, parseFlows, printFlows, renameFlowSteps } from './flows';
import type { Flow } from './flows';

describe('flows', () => {
  it('round trips valid steps and ignores malformed input', () => {
    const flows = [{ id: 'checkout', title: 'Checkout', steps: [{ from: 'Web', to: 'API', nth: 2, note: 'HTTPS' }] }];
    expect(parseFlows(printFlows(flows))).toEqual(flows);
    expect(parseFlows('{')).toEqual([]);
    expect(parseFlows('[{"id":"../x","title":"bad","steps":[]}]')).toEqual([]);
  });

  it('keeps a broken step visible and follows renamed endpoints', () => {
    const model = emptyModel();
    model.edges = [{ id: 'Web→API', from: 'Web', to: 'API', connector: '>' }];
    const flows = [{ id: 'f', title: 'F', steps: [{ from: 'Web', to: 'API' }, { from: 'API', to: 'DB' }] }];
    expect(flowEdge(model, flows[0]!.steps[0]!)).toBe('Web→API');
    expect(flowEdge(model, flows[0]!.steps[1]!)).toBeNull();
    expect(renameFlowSteps(flows, 'Web', 'Browser')[0]!.steps[0]).toMatchObject({ from: 'Browser' });
  });

  it('keeps old messages and plays choices, parallel paths, processes and cross-diagram links', () => {
    const flow: Flow = { id: 'f', title: 'Checkout', steps: [
      { from: 'Web', to: 'API' },
      { kind: 'process', node: 'API', note: 'Valida pedido' },
      { kind: 'choice', title: 'Pagamento', branches: [
        { title: 'Cartão', steps: [{ from: 'API', to: 'Card' }] },
        { title: 'Pix', steps: [{ from: 'API', to: 'Pix' }] },
      ] },
      { kind: 'parallel', branches: [
        { title: 'E-mail', steps: [{ from: 'API', to: 'Mail' }] },
        { title: 'Evento', steps: [{ from: 'API', to: 'Queue' }] },
      ] },
      { kind: 'goto', diagram: 'detalhe', flowId: 'f2' },
    ] };
    expect(parseFlows(printFlows([flow]))).toEqual([flow]);
    expect(flowFrames(flow, { 2: 1 }).map((frame) => frame.steps.length)).toEqual([1, 1, 1, 2, 1]);
    expect(flowFrames(flow, { 2: 1 })[2]?.steps[0]).toMatchObject({ to: 'Pix' });
    expect(renameFlowSteps([flow], 'API', 'Gateway')[0]?.steps[1]).toMatchObject({ kind: 'process', node: 'Gateway' });
    const choice = renameFlowSteps([flow], 'API', 'Gateway')[0]?.steps[2];
    expect(choice && 'branches' in choice ? choice.branches[1]?.steps[0] : null).toMatchObject({ from: 'Gateway' });
    expect(flowStepIssue(emptyModel(), { kind: 'goto', diagram: 'detalhe', flowId: 'f2' }, { detalhe: [] })).toBe('Fluxo de destino ausente');
  });
});
