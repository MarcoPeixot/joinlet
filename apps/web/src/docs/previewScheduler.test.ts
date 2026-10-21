import { describe, expect, it, vi } from 'vitest';
import { createPreviewScheduler, PREVIEW_BIG } from './previewScheduler';

function setup() {
  const timers = new Map<number, () => void>();
  let id = 0;
  const render = vi.fn((text: string) => `<p>${text.length}</p>`);
  const onChange = vi.fn();
  const scheduler = createPreviewScheduler({
    render,
    onChange,
    setTimer: (fn) => { timers.set(++id, fn); return id; },
    clearTimer: (handle) => { timers.delete(handle as number); },
  });
  const fire = () => { const all = [...timers.values()]; timers.clear(); all.forEach((fn) => fn()); };
  return { scheduler, render, onChange, fire, timers };
}

const big = (extra = 0) => 'a'.repeat(PREVIEW_BIG + extra);

describe('preview scheduler', () => {
  it('never renders while the preview is hidden (typing in "Escrever")', () => {
    const { scheduler, render, timers } = setup();
    for (let i = 0; i < 200; i++) scheduler.html(big(i), false);
    expect(render).not.toHaveBeenCalled();
    expect(timers.size).toBe(0);
  });

  it('renders a small document on every change, right away', () => {
    const { scheduler, render } = setup();
    expect(scheduler.html('um', true)).toBe('<p>2</p>');
    expect(scheduler.html('dois', true)).toBe('<p>4</p>');
    expect(render).toHaveBeenCalledTimes(2);
    scheduler.html('dois', true);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('renders a big document once when the preview opens, then waits for typing to pause', () => {
    const { scheduler, render, fire, onChange } = setup();
    scheduler.html(big(), true);
    expect(render).toHaveBeenCalledTimes(1);
    for (let i = 1; i <= 50; i++) expect(scheduler.html(big(i), true)).toBe(`<p>${PREVIEW_BIG}</p>`);
    expect(render).toHaveBeenCalledTimes(1);
    fire();
    expect(render).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(scheduler.html(big(50), true)).toBe(`<p>${PREVIEW_BIG + 50}</p>`);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('shows the current text right away when a hidden preview opens on a big document', () => {
    const { scheduler, render } = setup();
    scheduler.html(big(1), false);
    scheduler.html(big(2), false);
    expect(scheduler.html(big(3), true)).toBe(`<p>${PREVIEW_BIG + 3}</p>`);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('hiding the preview cancels the pending render, and dispose drops timers', () => {
    const { scheduler, render, timers, fire } = setup();
    scheduler.html(big(), true);
    scheduler.html(big(1), true);
    expect(timers.size).toBe(1);
    scheduler.html(big(2), false);
    expect(timers.size).toBe(0);
    fire();
    expect(render).toHaveBeenCalledTimes(1);
    scheduler.html(big(3), true);
    scheduler.html(big(4), true);
    scheduler.dispose();
    expect(timers.size).toBe(0);
  });

  it('re-renders the same text when the renderer changes (the sanitizer finished loading)', () => {
    const { scheduler, render } = setup();
    scheduler.html('texto', true, 0);
    scheduler.html('texto', true, 1);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('reports a pending render so the preview can say it is catching up', () => {
    const { scheduler, fire } = setup();
    scheduler.html(big(), true);
    scheduler.html(big(1), true);
    expect(scheduler.pending()).toBe(true);
    fire();
    expect(scheduler.pending()).toBe(false);
  });
});
