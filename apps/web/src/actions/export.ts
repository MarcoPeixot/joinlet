import { trackAnalytics } from '../analytics/client';
import { uiText } from '../i18n';
import { downloadBlob, svgToPngBlob } from '../export/png';
import { diagramStore } from '../state/appStore';
import { loadEraserRouter } from '../state/eraserRouter';
import { showToast, uiStore } from '../ui/uiStore';

export async function exportDiagram(format: 'svg' | 'png'): Promise<void> {
  const state = diagramStore.getState();
  if (!state.model.order.length) {
    showToast(uiText("O diagrama está vazio."));
    return;
  }
  try {
    // With a perspective applied, the file is that reading of the diagram, not the whole of it.
    if (uiStore.getState().activePerspective) await import('../perspectives/engine');
    const read = uiStore.getState().perspectiveRead;
    const { model, layout } = read ?? state;
    if (!model.order.length) {
      showToast(uiText("A perspectiva aplicada não mostra nenhum componente."));
      return;
    }
    const name = read ? `diagrama-${read.perspective.id}` : uiText("diagrama");
    const [{ loadDiagramIcons, renderDiagramSvg }, { embeddedFontCss }] = await Promise.all([
      import('../export/svg'),
      import('../export/fonts'),
    ]);
    const icons = await loadDiagramIcons(model);
    const svg = renderDiagramSvg(model, layout, { theme: uiStore.getState().theme, icons, fontCss: await embeddedFontCss(), router: await loadEraserRouter() });
    if (format === 'svg') downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`);
    else downloadBlob(await svgToPngBlob(svg, 2), `${name}.png`);
    trackAnalytics('export_generated', false, { format });
  } catch (err) {
    trackAnalytics('export_failed', false, { format });
    showToast(err instanceof Error ? err.message : uiText("Falha ao exportar."));
  }
}

const TEXT_FORMATS = {
  mermaid: { print: async () => (await import('@strukt/dsl/export')).printMermaid, done: uiText("Mermaid copiado") },
  plantuml: { print: async () => (await import('@strukt/dsl/export')).printPlantUml, done: uiText("PlantUML copiado") },
} as const;

/** Copies the open diagram as Mermaid or PlantUML text to the clipboard. */
export async function copyDiagramAs(format: keyof typeof TEXT_FORMATS): Promise<void> {
  const { model } = diagramStore.getState();
  if (!model.order.length) {
    showToast(uiText("O diagrama está vazio."));
    return;
  }
  try {
    const print = await TEXT_FORMATS[format].print();
    await navigator.clipboard.writeText(print(model));
    trackAnalytics('export_generated', false, { format });
    showToast(TEXT_FORMATS[format].done);
  } catch {
    trackAnalytics('export_failed', false, { format });
    showToast(uiText("Não foi possível copiar"));
  }
}

/** Transparent PNG for pasting into documents, slides and other apps; normal copy still duplicates components. */
export async function copySelectionImage(download = false): Promise<void> {
  const { model, layout, selection } = diagramStore.getState();
  if (!selection.nodes.length) { showToast(uiText("Selecione um componente para copiar como imagem.")); return; }
  const theme = uiStore.getState().theme;
  const render = async () => {
    const [{ selectedDiagram }, { loadDiagramIcons, renderDiagramSvg }, { embeddedFontCss }] = await Promise.all([
      import('../export/selection'), import('../export/svg'), import('../export/fonts'),
    ]);
    const picked = selectedDiagram(model, layout, selection.nodes);
    const icons = await loadDiagramIcons(picked.model);
    const svg = renderDiagramSvg(picked.model, picked.layout, { theme, background: false, padding: 20, rects: picked.rects, icons, fontCss: await embeddedFontCss(), router: await loadEraserRouter() });
    return svgToPngBlob(svg, 2);
  };
  try {
    if (download) downloadBlob(await render(), 'selecao-joinlet.png');
    else {
      if (!globalThis.ClipboardItem || !navigator.clipboard?.write) throw new Error(uiText("Use Exportar → Baixar seleção PNG neste navegador."));
      // Start the clipboard write in the user gesture, before fonts or icons finish loading (Safari requires this).
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': render() })]);
      showToast(uiText("Imagem copiada com fundo transparente."));
    }
    trackAnalytics('export_generated', false, { format: 'png' });
  } catch { trackAnalytics('export_failed', false, { format: 'png' }); showToast(download ? uiText("Não foi possível gerar a imagem. Tente novamente.") : uiText("Não foi possível copiar. Use Exportar → Baixar seleção PNG.")); }
}
