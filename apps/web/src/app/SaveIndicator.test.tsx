import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SaveIndicator } from './SaveIndicator';

describe('SaveIndicator', () => {
  it('is a polite live status, not just a colored dot', () => {
    const out = renderToStaticMarkup(<SaveIndicator />);
    expect(out).toContain('role="status"');
    expect(out).toContain('aria-live="polite"');
    expect(out).toMatch(/Salvo|Salvando/);
  });

  it('keeps the words for assistive tech while everything is fine', () => {
    const out = renderToStaticMarkup(<SaveIndicator />);
    expect(out).toMatch(/<span class="sr-only">(Salvo|Salvando…)<\/span>/);
  });
});
