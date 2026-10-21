import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../styles/diagram.css', import.meta.url), 'utf8');
const card = readFileSync(new URL('./CardNode.tsx', import.meta.url), 'utf8');
const block = (selector: string) => {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
};

describe('scene card depth', () => {
  it('uses the depth tokens, not literal colors, for shadow and sheen', () => {
    const body = block('.strukt-scene-card {');
    expect(body).toContain('var(--sk-node-shadow)');
    expect(body).toContain('var(--sk-node-sheen)');
    expect(body).toMatch(/border-radius:\s*12px/);
  });
  it('selected card adds the soft glow on the element, leaving ::after for the ring', () => {
    expect(block('.strukt-scene-card[data-selected] {')).toContain('var(--sk-glow)');
  });
  it('the icon sits in a tinted chip', () => {
    expect(block('.strukt-scene-card__chip {')).toContain('color-mix');
    expect(card).toContain('strukt-scene-card__chip');
  });
  it('fill goes in background-color so the sheen image survives', () => {
    expect(card).toContain('backgroundColor:colors.fill');
    expect(card).not.toMatch(/background:colors\.fill/);
  });
  it('the chip is 32 px, the width cardCaption reserves for the icon', () => {
    const body = block('.strukt-scene-card__chip {');
    expect(body).toMatch(/width:\s*32px/);
    expect(body).toMatch(/height:\s*32px/);
  });
  it('the selection ring is concentric with the 12 px card (12 + 4 inset)', () => {
    expect(block('[data-selected]::after,')).toMatch(/border-radius:\s*16px/);
  });
});
