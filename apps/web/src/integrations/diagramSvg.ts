import { loadEraserRouter } from '../state/eraserRouter';
import type { DiagramSnapshot } from '@strukt/workspace';

/**
 * The diagram as an SVG string for the server to attach to a Notion/Confluence page. Rendered here, in the browser,
 * with the same exporter as "Exportar › SVG" (icons, embedded fonts, the canvas's routes): the server has none of
 * those. A light page background keeps it readable on a white wiki page whatever theme the app is in.
 */
export async function diagramSvg(snapshot: DiagramSnapshot): Promise<string> {
  const [{ loadDiagramIcons, renderDiagramSvg }, { embeddedFontCss }] = await Promise.all([import('../export/svg'), import('../export/fonts')]);
  const icons = await loadDiagramIcons(snapshot.model);
  return renderDiagramSvg(snapshot.model, snapshot.layout, { theme: 'light', icons, fontCss: await embeddedFontCss(), router: await loadEraserRouter() });
}
