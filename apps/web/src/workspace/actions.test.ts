import { createMemoryAdapter, docLink, newWorkspace } from '@strukt/workspace';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** `actions.ts` binds to the `workspace`/`diagramStore` singletons (via `./appWorkspace`); each test
 * gets a fresh module graph so one test's workspace never leaks into the next (same pattern as
 * boot.test.ts's `freshBoot`). */
async function freshActions() {
  vi.resetModules();
  const ui = await import('../ui/uiStore');
  const appStore = await import('../state/appStore');
  const ai = await import('../ai/session');
  const appWorkspace = await import('./appWorkspace');
  const actions = await import('./actions');
  return { ui, appStore, ai, appWorkspace, actions };
}

type Fresh = Awaited<ReturnType<typeof freshActions>>;

/** Opens a workspace with one diagram ("Exemplo") already loaded, the way boot.ts would. */
async function bootedWorkspace(f: Fresh) {
  await f.appWorkspace.workspace.open(createMemoryAdapter({}), () =>
    newWorkspace('Meu workspace', { title: 'Exemplo', snapshot: f.appStore.diagramStore.getState() }),
  );
  return f;
}

beforeEach(() => {
  vi.stubGlobal('window', { confirm: vi.fn(() => true) });
});

describe('openItem', () => {
  it('opens a diagram and requests a fit', async () => {
    const f = await bootedWorkspace(await freshActions());
    const slug = f.appWorkspace.workspace.store.getState().data!.manifest.diagrams[0].slug;
    const before = f.ui.uiStore.getState().fitRequest;

    await f.actions.openItem('diagram', slug);

    expect(f.appWorkspace.workspace.store.getState().diagram).toBe(slug);
    expect(f.ui.uiStore.getState().fitRequest).toBe(before + 1);
  });

  it('shows a doc without requesting a fit', async () => {
    const f = await bootedWorkspace(await freshActions());
    const slug = await f.appWorkspace.workspace.create('doc', 'Notas');
    const before = f.ui.uiStore.getState().fitRequest;

    await f.actions.openItem('doc', slug);

    expect(f.appWorkspace.workspace.store.getState().view).toEqual({ kind: 'doc', slug });
    expect(f.ui.uiStore.getState().fitRequest).toBe(before);
  });

  it('cancels an AI request still in flight when switching diagrams', async () => {
    const f = await bootedWorkspace(await freshActions());
    const first = f.appWorkspace.workspace.store.getState().data!.manifest.diagrams[0].slug;
    await f.appWorkspace.workspace.create('diagram', 'Pagamentos');
    f.ai.aiStore.setState({ status: 'loading' });

    await f.actions.openItem('diagram', first);

    expect(f.appWorkspace.workspace.store.getState().diagram).toBe(first);
    expect(f.ai.aiStore.getState().status).toBe('idle');
  });

  it('toasts instead of throwing when an AI draft locks the switch', async () => {
    const f = await bootedWorkspace(await freshActions());
    const other = await f.appWorkspace.workspace.create('diagram', 'Pagamentos');
    await f.actions.openItem('diagram', f.appWorkspace.workspace.store.getState().data!.manifest.diagrams[0].slug);
    f.appStore.diagramStore.getState().setReadOnly('Revise a proposta da IA.');

    await expect(f.actions.openItem('diagram', other)).resolves.toBeUndefined();

    expect(f.appWorkspace.workspace.store.getState().diagram).not.toBe(other);
    expect(f.ui.uiStore.getState().toast).toBe('Aplique ou descarte a proposta da IA antes de trocar de diagrama.');
  });
});

describe('createItem', () => {
  it('creates a diagram, opens it and requests a fit', async () => {
    const f = await bootedWorkspace(await freshActions());
    const before = f.ui.uiStore.getState().fitRequest;

    await f.actions.createItem('diagram', 'Pagamentos');

    const data = f.appWorkspace.workspace.store.getState().data!;
    expect(data.manifest.diagrams.map((e) => e.title)).toContain('Pagamentos');
    expect(f.appWorkspace.workspace.store.getState().view).toEqual({ kind: 'diagram' });
    expect(f.ui.uiStore.getState().fitRequest).toBe(before + 1);
  });

  it('creates a doc without requesting a fit', async () => {
    const f = await bootedWorkspace(await freshActions());
    const before = f.ui.uiStore.getState().fitRequest;

    await f.actions.createItem('doc', 'Notas');

    expect(f.appWorkspace.workspace.store.getState().data!.manifest.docs.map((e) => e.title)).toContain('Notas');
    expect(f.ui.uiStore.getState().fitRequest).toBe(before);
  });

  it('toasts instead of throwing when an AI draft locks the switch', async () => {
    const f = await bootedWorkspace(await freshActions());
    f.appStore.diagramStore.getState().setReadOnly('Revise a proposta da IA.');

    await expect(f.actions.createItem('diagram', 'Pagamentos')).resolves.toBeUndefined();

    expect(f.ui.uiStore.getState().toast).toBe('Aplique ou descarte a proposta da IA antes de trocar de diagrama.');
  });
});

describe('deleteItem', () => {
  afterEach(() => vi.useRealTimers());

  it('removes the item right away (no confirm) and offers "Desfazer"', async () => {
    const f = await bootedWorkspace(await freshActions());
    const slug = await f.appWorkspace.workspace.create('doc', 'Notas');

    await f.actions.deleteItem('doc', slug);

    expect(window.confirm).not.toHaveBeenCalled();
    expect(f.appWorkspace.workspace.store.getState().data!.manifest.docs).toEqual([]);
    expect(f.ui.uiStore.getState().toast).toBe('Documento “Notas” excluído');
    expect(f.ui.uiStore.getState().toastAction?.label).toBe('Desfazer');
  });

  it('"Desfazer" brings a doc back with its text and reopens it', async () => {
    const f = await bootedWorkspace(await freshActions());
    const ws = f.appWorkspace.workspace;
    const slug = await ws.create('doc', 'Notas');
    ws.setDoc(slug, 'texto importante');

    await f.actions.deleteItem('doc', slug);
    f.ui.runToastAction();
    await vi.waitFor(() => expect(ws.store.getState().view).toEqual({ kind: 'doc', slug }));

    expect(ws.store.getState().data!.manifest.docs.map((e) => e.slug)).toEqual([slug]);
    expect(ws.store.getState().data!.docs[slug]).toBe('texto importante');
  });

  it('undoes a diagram delete without touching its versions; finalizes (drops versions) after 8 s', async () => {
    const f = await bootedWorkspace(await freshActions());
    const ws = f.appWorkspace.workspace;
    const other = await ws.create('diagram', 'Pagamentos');
    const first = ws.store.getState().data!.manifest.diagrams[0]!.slug;
    const storage = ws.storage()!;
    await storage.write(`versions/${other}/x.json`, '{}');
    vi.useFakeTimers();

    await f.actions.deleteItem('diagram', other);
    expect(ws.store.getState().data!.manifest.diagrams.map((e) => e.slug)).toEqual([first]);
    await vi.advanceTimersByTimeAsync(7000);
    expect(await storage.read(`versions/${other}/x.json`)).toBe('{}');

    f.ui.runToastAction();
    await vi.advanceTimersByTimeAsync(10000);
    expect(ws.store.getState().data!.manifest.diagrams.map((e) => e.slug)).toEqual([first, other]);
    expect(await storage.read(`versions/${other}/x.json`)).toBe('{}');

    await f.actions.deleteItem('diagram', other);
    await vi.advanceTimersByTimeAsync(8100);
    expect(await storage.read(`versions/${other}/x.json`)).toBeNull();
  });

  it('a deleted diagram or doc takes its comments with it only after the undo window, and an undo keeps them', async () => {
    const f = await bootedWorkspace(await freshActions());
    const ws = f.appWorkspace.workspace;
    const diagram = await ws.create('diagram', 'Pagamentos');
    const doc = await ws.create('doc', 'Notas');
    const storage = ws.storage()!;
    await storage.write(`comments/diagram-${diagram}.json`, '{"version":1,"threads":[]}');
    await storage.write(`comments/doc-${doc}.json`, '{"version":1,"threads":[]}');
    vi.useFakeTimers();

    await f.actions.deleteItem('doc', doc);
    await vi.advanceTimersByTimeAsync(7000);
    expect(await storage.read(`comments/doc-${doc}.json`)).not.toBeNull();
    f.ui.runToastAction();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await storage.read(`comments/doc-${doc}.json`)).not.toBeNull();

    await f.actions.deleteItem('doc', doc);
    await f.actions.deleteItem('diagram', diagram);
    await vi.advanceTimersByTimeAsync(8100);
    expect(await storage.read(`comments/doc-${doc}.json`)).toBeNull();
    expect(await storage.read(`comments/diagram-${diagram}.json`)).toBeNull();
    vi.useRealTimers();
  });

  it('creating a diagram with the same title inside the undo window does not wipe the deleted one\'s versions', async () => {
    const f = await bootedWorkspace(await freshActions());
    const ws = f.appWorkspace.workspace;
    const other = await ws.create('diagram', 'Pagamentos');
    const storage = ws.storage()!;
    await storage.write(`versions/${other}/x.json`, '{}');
    vi.useFakeTimers();
    await f.actions.deleteItem('diagram', other);
    await ws.create('diagram', 'Pagamentos');
    expect(await storage.read(`versions/${other}/x.json`)).toBe('{}');
    vi.useRealTimers();
  });

  it('keeps every delete in the window undoable (latest first) and drops versions only when the window closes', async () => {
    const f = await bootedWorkspace(await freshActions());
    const ws = f.appWorkspace.workspace;
    const a = await ws.create('diagram', 'Alfa');
    const b = await ws.create('diagram', 'Beta');
    const storage = ws.storage()!;
    await storage.write(`versions/${a}/x.json`, '{}');
    await storage.write(`versions/${b}/x.json`, '{}');
    vi.useFakeTimers();

    await f.actions.deleteItem('diagram', a);
    await vi.advanceTimersByTimeAsync(5000);
    await f.actions.deleteItem('diagram', b);
    expect(f.ui.uiStore.getState().toastAction?.label).toBe('Desfazer (2)');
    await vi.advanceTimersByTimeAsync(7000); // past the first delete's original 8 s
    expect(await storage.read(`versions/${a}/x.json`)).toBe('{}');

    f.ui.runToastAction(); // restores Beta
    await vi.advanceTimersByTimeAsync(0);
    expect(f.ui.uiStore.getState().toastAction?.label).toBe('Desfazer');
    expect(f.ui.uiStore.getState().toast).toContain('Alfa');
    f.ui.runToastAction(); // restores Alfa
    await vi.advanceTimersByTimeAsync(10000);
    const slugs = ws.store.getState().data!.manifest.diagrams.map((e) => e.slug);
    expect(slugs).toContain(a);
    expect(slugs).toContain(b);
    expect(await storage.read(`versions/${a}/x.json`)).toBe('{}');
    expect(await storage.read(`versions/${b}/x.json`)).toBe('{}');
  });

  it('when the window closes, every pending delete is finalized', async () => {
    const f = await bootedWorkspace(await freshActions());
    const ws = f.appWorkspace.workspace;
    const a = await ws.create('diagram', 'Alfa');
    const b = await ws.create('diagram', 'Beta');
    const storage = ws.storage()!;
    await storage.write(`versions/${a}/x.json`, '{}');
    await storage.write(`versions/${b}/x.json`, '{}');
    vi.useFakeTimers();
    await f.actions.deleteItem('diagram', a);
    await f.actions.deleteItem('diagram', b);
    await vi.advanceTimersByTimeAsync(8100);
    expect(await storage.read(`versions/${a}/x.json`)).toBeNull();
    expect(await storage.read(`versions/${b}/x.json`)).toBeNull();
  });

  it('an unrelated toast does not evict the undo offer or finalize; it shows after the window', async () => {
    const f = await bootedWorkspace(await freshActions());
    const ws = f.appWorkspace.workspace;
    const slug = await ws.create('diagram', 'Pagamentos');
    const storage = ws.storage()!;
    await storage.write(`versions/${slug}/x.json`, '{}');
    vi.useFakeTimers();
    await f.actions.deleteItem('diagram', slug);

    f.ui.showToast('Versão salva');
    await vi.advanceTimersByTimeAsync(7000);
    expect(f.ui.uiStore.getState().toastAction?.label).toBe('Desfazer');
    expect(await storage.read(`versions/${slug}/x.json`)).toBe('{}');

    await vi.advanceTimersByTimeAsync(1100);
    expect(await storage.read(`versions/${slug}/x.json`)).toBeNull();
    expect(f.ui.uiStore.getState().toast).toBe('Versão salva');
  });

  it('undo still works after an unrelated toast was queued', async () => {
    const f = await bootedWorkspace(await freshActions());
    const ws = f.appWorkspace.workspace;
    const slug = await ws.create('diagram', 'Pagamentos');
    const storage = ws.storage()!;
    await storage.write(`versions/${slug}/x.json`, '{}');
    vi.useFakeTimers();
    await f.actions.deleteItem('diagram', slug);
    f.ui.showToast('Falha ao salvar');
    f.ui.runToastAction();
    await vi.advanceTimersByTimeAsync(10000);
    expect(ws.store.getState().data!.manifest.diagrams.map((e) => e.slug)).toContain(slug);
    expect(await storage.read(`versions/${slug}/x.json`)).toBe('{}');
  });

  it('an explicit dismissal finalizes', async () => {
    const f = await bootedWorkspace(await freshActions());
    const ws = f.appWorkspace.workspace;
    const slug = await ws.create('diagram', 'Pagamentos');
    const storage = ws.storage()!;
    await storage.write(`versions/${slug}/x.json`, '{}');
    vi.useFakeTimers();
    await f.actions.deleteItem('diagram', slug);
    f.ui.dismissToast();
    await vi.advanceTimersByTimeAsync(0);
    expect(await storage.read(`versions/${slug}/x.json`)).toBeNull();
  });

  it('never removes the versions of a NEW diagram that reused the slug inside the window', async () => {
    const f = await bootedWorkspace(await freshActions());
    const ws = f.appWorkspace.workspace;
    const slug = await ws.create('diagram', 'Pagamentos');
    const storage = ws.storage()!;
    vi.useFakeTimers();
    await f.actions.deleteItem('diagram', slug);
    const again = await ws.create('diagram', 'Pagamentos');
    expect(again).toBe(slug);
    await storage.write(`versions/${slug}/novo.json`, '{}');

    await vi.advanceTimersByTimeAsync(8100);

    expect(await storage.read(`versions/${slug}/novo.json`)).toBe('{}');
  });

  it('a refused undo (workspace changed) does not leave the finalize hanging: guard skips, no toast action remains', async () => {
    const f = await bootedWorkspace(await freshActions());
    const ws = f.appWorkspace.workspace;
    const slug = await ws.create('diagram', 'Pagamentos');
    const storage = ws.storage()!;
    await storage.write(`versions/${slug}/x.json`, '{}');
    vi.useFakeTimers();
    await f.actions.deleteItem('diagram', slug);
    await ws.open(createMemoryAdapter({}), () => newWorkspace('Outro'));

    f.ui.runToastAction();
    expect(f.ui.uiStore.getState().toast).toContain('workspace');
    await vi.advanceTimersByTimeAsync(10000);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('a refused undo (slug taken) still finalizes without touching the live diagram versions', async () => {
    const f = await bootedWorkspace(await freshActions());
    const ws = f.appWorkspace.workspace;
    const slug = await ws.create('diagram', 'Pagamentos');
    const storage = ws.storage()!;
    vi.useFakeTimers();
    await f.actions.deleteItem('diagram', slug);
    await ws.create('diagram', 'Pagamentos');
    await storage.write(`versions/${slug}/novo.json`, '{}');

    f.ui.runToastAction();
    await vi.advanceTimersByTimeAsync(10000);

    expect(await storage.read(`versions/${slug}/novo.json`)).toBe('{}');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('undo after switching workspace is refused and restores nothing in the new one', async () => {
    const f = await bootedWorkspace(await freshActions());
    const ws = f.appWorkspace.workspace;
    const slug = await ws.create('doc', 'Notas');
    await f.actions.deleteItem('doc', slug);
    await ws.open(createMemoryAdapter({}), () => newWorkspace('Outro'));

    f.ui.runToastAction();
    await Promise.resolve();

    expect(ws.store.getState().data!.manifest.docs).toEqual([]);
    expect(f.ui.uiStore.getState().toast).toContain('workspace');
  });

  it('does nothing for a slug with no title', async () => {
    const f = await bootedWorkspace(await freshActions());

    await f.actions.deleteItem('doc', 'nao-existe');

    expect(f.ui.uiStore.getState().toast).toBeNull();
  });

  it('toasts instead of throwing when deleting the open diagram while an AI draft locks the switch', async () => {
    const f = await bootedWorkspace(await freshActions());
    const slug = f.appWorkspace.workspace.store.getState().diagram!;
    f.appStore.diagramStore.getState().setReadOnly('Revise a proposta da IA.');

    await expect(f.actions.deleteItem('diagram', slug)).resolves.toBeUndefined();

    expect(f.appWorkspace.workspace.store.getState().data!.manifest.diagrams.map((e) => e.slug)).toContain(slug);
    expect(f.ui.uiStore.getState().toast).toBe('Aplique ou descarte a proposta da IA antes de trocar de diagrama.');
  });
});

describe('renameItem', () => {
  it('renames an item in place', async () => {
    const f = await bootedWorkspace(await freshActions());
    const slug = await f.appWorkspace.workspace.create('doc', 'Notas');

    f.actions.renameItem('doc', slug, 'Notas v2');

    expect(f.appWorkspace.workspace.store.getState().data!.manifest.docs.find((e) => e.slug === slug)?.title).toBe('Notas v2');
  });
});

describe('openDocLink', () => {
  it('opens the doc a `doc:<slug>` link points to', async () => {
    const f = await bootedWorkspace(await freshActions());
    const slug = await f.appWorkspace.workspace.create('doc', 'API de Pedidos');
    await f.appWorkspace.workspace.openDiagram(f.appWorkspace.workspace.store.getState().data!.manifest.diagrams[0].slug);

    await f.actions.openDocLink(docLink(slug));

    expect(f.appWorkspace.workspace.store.getState().view).toEqual({ kind: 'doc', slug });
  });

  it('does nothing for an undefined or non-doc link', async () => {
    const f = await bootedWorkspace(await freshActions());
    const before = f.appWorkspace.workspace.store.getState().view;

    await f.actions.openDocLink(undefined);
    await f.actions.openDocLink('https://example.com');

    expect(f.appWorkspace.workspace.store.getState().view).toEqual(before);
  });

  it('toasts when the linked doc no longer exists', async () => {
    const f = await bootedWorkspace(await freshActions());
    const before = f.appWorkspace.workspace.store.getState().view;

    await f.actions.openDocLink(docLink('removido'));

    expect(f.ui.uiStore.getState().toast).toBe('Documento não encontrado no workspace.');
    expect(f.appWorkspace.workspace.store.getState().view).toEqual(before);
  });
});

describe('revealElement', () => {
  it('opens the diagram, selects the element and requests a fit', async () => {
    const f = await bootedWorkspace(await freshActions());
    const slug = f.appWorkspace.workspace.store.getState().data!.manifest.diagrams[0].slug;
    await f.appWorkspace.workspace.create('doc', 'Notas'); // switches the view away from the diagram
    const before = f.ui.uiStore.getState().fitRequest;

    await f.actions.revealElement(slug, 'pedidos');

    expect(f.appWorkspace.workspace.store.getState().view).toEqual({ kind: 'diagram' });
    expect(f.appStore.diagramStore.getState().selection).toEqual({ nodes: ['pedidos'], edges: [] });
    expect(f.ui.uiStore.getState().fitRequest).toBe(before + 1);
  });

  it('toasts instead of throwing (and leaves the selection alone) when an AI draft locks the switch', async () => {
    const f = await bootedWorkspace(await freshActions());
    const other = await f.appWorkspace.workspace.create('diagram', 'Pagamentos');
    await f.actions.openItem('diagram', f.appWorkspace.workspace.store.getState().data!.manifest.diagrams[0].slug);
    f.appStore.diagramStore.getState().select({ nodes: ['ja-selecionado'], edges: [] });
    f.appStore.diagramStore.getState().setReadOnly('Revise a proposta da IA.');

    await f.actions.revealElement(other, 'pedidos');

    expect(f.appWorkspace.workspace.store.getState().diagram).not.toBe(other);
    expect(f.appStore.diagramStore.getState().selection).toEqual({ nodes: ['ja-selecionado'], edges: [] });
    expect(f.ui.uiStore.getState().toast).toBe('Aplique ou descarte a proposta da IA antes de trocar de diagrama.');
  });
});

describe('saveMarkdownAsDoc', () => {
  it('creates a doc with the given title and markdown, then opens it', async () => {
    const f = await bootedWorkspace(await freshActions());

    await f.actions.saveMarkdownAsDoc('Arquitetura', '# Arquitetura\n\nTexto gerado pela IA.');

    const data = f.appWorkspace.workspace.store.getState().data!;
    const entry = data.manifest.docs.find((e) => e.title === 'Arquitetura');
    expect(entry).toBeDefined();
    expect(data.docs[entry!.slug]).toBe('# Arquitetura\n\nTexto gerado pela IA.');
    expect(f.appWorkspace.workspace.store.getState().view).toEqual({ kind: 'doc', slug: entry!.slug });
  });
});
