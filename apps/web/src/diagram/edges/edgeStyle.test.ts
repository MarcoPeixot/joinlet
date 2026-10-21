import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const edge = readFileSync(new URL('./StruktEdge.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../styles/diagram.css', import.meta.url), 'utf8');
const canvas = readFileSync(new URL('../../canvas/DiagramCanvas.tsx', import.meta.url), 'utf8');

describe('edge and canvas depth', () => {
  it('lines are 1.5 px, 2.25 px when emphasised', () => {
    expect(edge).toContain('strokeWidth: strong ? 2.25 : 1.5');
  });
  it('the canvas paints the vignette over the pane without catching the pointer', () => {
    const start = css.indexOf('.react-flow::after');
    expect(start).toBeGreaterThanOrEqual(0);
    const body = css.slice(start, css.indexOf('}', start));
    expect(body).toContain('var(--sk-vignette)');
    expect(body).toContain('pointer-events: none');
  });
  it('the pane paints paper dots (22 px, 1.6 px)', () => {
    expect(canvas).toMatch(/variant=\{BackgroundVariant\.Dots\} gap=\{22\} size=\{1\.6\}/);
  });
});
