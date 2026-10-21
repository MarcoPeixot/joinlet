import { applyOps, emptyModel } from '@strukt/core';
import { eraserRouter } from '@strukt/layout';
import { describe, expect, it } from 'vitest';
import { renderDiagramSvg } from '../export/svg';
// The server's attachment gate, checked against the app's real exporter: if the exporter ever emits something the
// gate refuses (or the gate loosens), publishing a diagram would break silently.
import { checkSvg } from '../../../server/src/integrations/svgCheck';

const FONT_CSS = "@font-face{font-family:'Geist Variable';font-weight:100 900;src:url(data:font/woff2;base64,d09GMgABAAAAAA==) format('woff2');}";

describe('the exporter output passes the server SVG gate', () => {
  it('for a mixed diagram, in both themes, with embedded fonts', () => {
    const result = applyOps(emptyModel(), [
      { op: 'add_group', id: 'Backend', label: 'Backend' },
      { op: 'add_node', id: 'API', label: 'API & <Gateway>', shape: 'component', icon: 'nestjs', tech: 'NestJS', parentId: 'Backend' },
      { op: 'add_node', id: 'DB', label: 'javascript: onclick = "x"', parentId: 'Backend' },
      { op: 'add_node', id: 'Users', presentation: 'table', fields: [{ name: 'id', type: 'uuid', key: 'PK' }] },
      { op: 'connect', from: 'API', to: 'DB', label: 'SQL <b>', connector: '-->' },
    ]);
    if (!result.ok) throw new Error(result.error.message);
    for (const theme of ['light', 'dark'] as const) {
      const svg = renderDiagramSvg(result.model, { nodes: { API: { x: 0, y: 0 }, DB: { x: 300, y: 0 }, Users: { x: 600, y: 0 } }, edges: {} }, { theme, fontCss: FONT_CSS, router: eraserRouter });
      expect(checkSvg(svg), theme).toBe(true);
    }
  });
});
