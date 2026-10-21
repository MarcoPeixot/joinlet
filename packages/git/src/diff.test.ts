import { describe, expect, it } from 'vitest';
import { newWorkspace } from '@strukt/workspace';
import { diffWorkspaces, renderDiffMarkdown } from './diff';

describe('accuracy in architecture review', () => {
  it('summarizes concerns opened and resolved between refs', () => {
    const before = newWorkspace('Loja');
    before.concerns = [{ id: 'old', diagram: 'api', message: 'Antigo', status: 'open', createdAt: '2026-09-24T00:00:00Z' }];
    const after = newWorkspace('Loja');
    after.concerns = [{ ...before.concerns[0]!, status: 'resolved' }, { id: 'new', diagram: 'api', message: 'Falta cache', status: 'open', createdAt: '2026-09-24T00:00:00Z' }];
    const markdown = renderDiffMarkdown(diffWorkspaces({ label: 'main', data: before }, { label: 'branch', data: after }));
    expect(markdown).toContain('Aberta em api: Falta cache');
    expect(markdown).toContain('Resolvida em api: Antigo');
  });

  it('shows shared-model and flow changes even when diagram JSON is unchanged', () => {
    const before = newWorkspace('Loja');
    before.shared = { version: 1, entities: { api: { id: 'api', label: 'API' } }, views: {} };
    before.flows = { api: [{ id: 'checkout', title: 'Checkout', steps: [] }] };
    const after = newWorkspace('Loja');
    after.shared = { version: 1, entities: { api: { id: 'api', label: 'API', tags: ['risk:high'] } }, views: {}, relations: { call: { id: 'call', from: 'api', to: 'api', connector: '>' } } };
    after.flows = { api: [{ id: 'checkout', title: 'Pagamento', steps: [] }] };
    const markdown = renderDiffMarkdown(diffWorkspaces({ label: 'main', data: before }, { label: 'branch', data: after }));
    expect(markdown).toContain('### Entidades');
    expect(markdown).toContain('Alterado: api');
    expect(markdown).toContain('### Relações');
    expect(markdown).toContain('Adicionado: call');
    expect(markdown).toContain('### Fluxos');
    expect(markdown).toContain('Alterado: api/checkout');
  });
});
