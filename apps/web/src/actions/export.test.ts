import { emptyLayout, emptyModel } from '@strukt/core';
import { emptyShared } from '@strukt/workspace';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob } from '../export/png';
import { diagramStore } from '../state/appStore';
import { dismissToast, uiStore } from '../ui/uiStore';
import { workspace } from '../workspace/appWorkspace';
import { copyDiagramAs, exportDiagram } from './export';

vi.mock('../export/png', () => ({ downloadBlob: vi.fn(), svgToPngBlob: vi.fn() }));
vi.mock('../export/fonts', () => ({ embeddedFontCss: async () => '' }));

describe('copyDiagramAs', () => {
  beforeEach(() => {
    dismissToast();
    diagramStore.getState().load({ model: emptyModel(), layout: emptyLayout() });
    diagramStore.getState().apply([{ op: 'add_node', id: 'API' }] as never);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('writes Mermaid to the clipboard and confirms', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await copyDiagramAs('mermaid');
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('flowchart'));
    expect(uiStore.getState().toast).toBe('Mermaid copiado');
  });

  it('reports a clipboard failure', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no')) } });
    await copyDiagramAs('plantuml');
    expect(uiStore.getState().toast).toBe('Não foi possível copiar');
  });

  it('says the diagram is empty and never touches the clipboard', async () => {
    const writeText = vi.fn();
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    diagramStore.getState().load({ model: emptyModel(), layout: emptyLayout() });
    await copyDiagramAs('mermaid');
    expect(writeText).not.toHaveBeenCalled();
    expect(uiStore.getState().toast).toBe('O diagrama está vazio.');
  });
});

describe('exports through a perspective', () => {
  beforeEach(() => {
    dismissToast();
    vi.mocked(downloadBlob).mockClear();
    diagramStore.getState().load({ model: emptyModel(), layout: emptyLayout() });
    diagramStore.getState().apply([{ op: 'add_node', id: 'Usuário' }, { op: 'add_node', id: 'Segredo' }, { op: 'connect', from: 'Usuário', to: 'Segredo' }] as never, { Usuário: { x: 0, y: 0 }, Segredo: { x: 300, y: 0 } });
    const shared = { ...emptyShared(), entities: { u: { id: 'u', tags: ['nivel:contexto'] }, s: { id: 's', tags: ['nivel:container'] } }, views: { d: { Usuário: 'u', Segredo: 's' } } };
    workspace.store.setState({ diagram: 'd', data: { ...(workspace.store.getState().data ?? { manifest: { version: 1, name: 'x', diagrams: [], docs: [], sketches: [] }, diagrams: {}, docs: {}, sketches: {}, board: { cards: [], connections: [] } }), shared } as never });
  });
  afterEach(() => {
    uiStore.setState({ activePerspective: null });
    vi.unstubAllGlobals();
  });
  const written = async () => {
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0]!;
    return { name, text: await blob.text() };
  };

  it('writes the whole diagram when no perspective is applied', async () => {
    await exportDiagram('svg');
    const { name, text } = await written();
    expect(name).toBe('diagrama.svg');
    expect(text).toContain('Segredo');
  });

  it('writes only what the applied perspective shows, under its own file name', async () => {
    uiStore.setState({ activePerspective: { diagram: 'd', id: 'c4-contexto', name: 'C4: Contexto' } });
    await exportDiagram('svg');
    const { name, text } = await written();
    expect(name).toBe('diagrama-c4-contexto.svg');
    expect(text).toContain('Usuário');
    expect(text).not.toContain('Segredo');
  });

  it('ignores a perspective applied to another diagram', async () => {
    uiStore.setState({ activePerspective: { diagram: 'outro', id: 'c4-contexto', name: 'C4: Contexto' } });
    await exportDiagram('svg');
    expect((await written()).text).toContain('Segredo');
  });

  it('says so when the perspective shows nothing, and writes no file', async () => {
    workspace.store.setState({ data: { ...workspace.store.getState().data!, perspectives: { d: [{ id: 'vazio', name: 'Vazio', levels: ['componente'] }] } } });
    uiStore.setState({ activePerspective: { diagram: 'd', id: 'vazio', name: 'Vazio' } });
    await exportDiagram('svg');
    expect(uiStore.getState().toast).toBe('A perspectiva aplicada não mostra nenhum componente.');
    expect(vi.mocked(downloadBlob)).not.toHaveBeenCalled();
  });
});
