import { describe, expect, it } from 'vitest';
import { applyOps, emptyModel } from '@strukt/core';
import { eraserRouter } from '@strukt/layout';
import { TEMPLATES } from '@strukt/workspace';
import { loadDiagramIcons, renderDiagramSvg } from './svg';

describe('editable template exports', () => {
  for (const template of TEMPLATES) it(`renders ${template.id} with real icons in both themes`, async () => {
    const result = applyOps(emptyModel(), template.ops);
    if (!result.ok) throw new Error(result.error.message);
    const icons = await loadDiagramIcons(result.model);
    expect(Object.entries(icons).filter(([, icon]) => !icon)).toEqual([]);
    expect(template.positions).toBeDefined();
    for (const theme of ['light', 'dark'] as const) {
      const svg = renderDiagramSvg(result.model, { nodes: template.positions!, edges: {} }, { theme, icons, router: eraserRouter });
      expect(svg).toMatch(/^<svg /);
      expect(svg).not.toMatch(/NaN|undefined|<script|<foreignObject/);
      const box = svg.match(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/);
      expect(box).not.toBeNull();
      expect(Number(box![3])).toBeGreaterThan(100);
      expect(Number(box![4])).toBeGreaterThan(100);
      if (template.id === 'relational-orders') expect(svg).toContain('cliente_id');
      if (template.id === 'sequence-api') expect(svg).toContain('6. 200 OK');
    }
  });
});
