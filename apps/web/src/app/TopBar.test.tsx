import { Tooltip } from 'radix-ui';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PanelsMenu, TOPBAR_GROUP } from './TopBar';

const quiet = { concerns: 0, changes: 0, lens: null };

function html(compact: boolean, signals = quiet): string {
  return renderToStaticMarkup(<Tooltip.Provider><PanelsMenu compact={compact} signals={signals} /></Tooltip.Provider>);
}

describe('TopBar Painéis menu', () => {
  it('is one trigger that names itself Painéis while no panel is open', () => {
    const out = html(false);
    expect(out).toContain('aria-label="Painéis"');
    expect(out).toContain('aria-haspopup="menu"');
    expect(out).not.toContain('>Painéis<');
  });

  it('carries no dot while nothing is pending, and one when something is', () => {
    const dot = 'rounded-full bg-accent';
    expect(html(false)).not.toContain(dot);
    expect(html(false, { ...quiet, concerns: 2 })).toContain(dot);
    expect(html(true, { ...quiet, changes: 1 })).toContain(dot);
  });

  it('keeps the phone trigger icon-only', () => {
    expect(html(true)).not.toContain('>Painéis<');
  });
});

describe('TopBar groups', () => {
  it('floats the action bar and lets touch targets grow', () => {
    expect(TOPBAR_GROUP).toContain('sk-float');
    expect(TOPBAR_GROUP).toContain('min-h-10');
    expect(TOPBAR_GROUP).not.toMatch(/(^| )h-10( |$)/);
  });
});
