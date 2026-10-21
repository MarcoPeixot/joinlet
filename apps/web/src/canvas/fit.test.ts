import { describe, expect, it } from 'vitest';
import { fitOptionsFor } from './fit';

describe('fitOptionsFor', () => {
  it('keeps the plain paddings without an inset', () => {
    expect(fitOptionsFor(false, 0)).toEqual({ padding: 0.2, maxZoom: 1 });
    expect(fitOptionsFor(false, 0, 1000)).toEqual({ padding: 0.2, maxZoom: 1 });
  });
  it('reserves the bottom inset (px) while keeping the other sides', () => {
    expect(fitOptionsFor(false, 180)).toEqual({ padding: { top: 0.2, left: 0.2, right: 0.2, bottom: '180px' }, maxZoom: 1 });
  });
  it('ignores negative or non-finite insets', () => {
    expect(fitOptionsFor(false, -5)).toEqual({ padding: 0.2, maxZoom: 1 });
    expect(fitOptionsFor(false, Number.NaN)).toEqual({ padding: 0.2, maxZoom: 1 });
  });
  it('keeps the diagram clear of the tool palette on a narrow canvas (tablet, panel beside it)', () => {
    // A fractional 0.2 is a margin of about 8.3 % of the pane per side: 46 px of 560 (under the palette), 83 px of 1000 (clear).
    expect(fitOptionsFor(false, 0, 1000)).toEqual({ padding: 0.2, maxZoom: 1 });
    expect(fitOptionsFor(false, 0, 560)).toEqual({ padding: { top: 0.2, left: '76px', right: 0.2, bottom: 0.2 }, maxZoom: 1 });
    expect(fitOptionsFor(false, 120, 560)).toEqual({ padding: { top: 0.2, left: '76px', right: 0.2, bottom: '120px' }, maxZoom: 1 });
  });
  it('on a phone the palette is a row under the bar: the top margin clears it', () => {
    expect(fitOptionsFor(true, 0)).toEqual({ padding: { top: '116px', left: 0.08, right: 0.08, bottom: 0.08 }, maxZoom: 1 });
    expect(fitOptionsFor(true, 120)).toEqual({ padding: { top: '116px', left: 0.08, right: 0.08, bottom: '120px' }, maxZoom: 1 });
  });
});
