import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastBody } from './Toast';
import { clearToastQueue, dismissToast, pauseToast, resumeToast, runToastAction, showToast, uiStore } from './uiStore';

beforeEach(() => {
  vi.useFakeTimers();
  clearToastQueue();
  dismissToast();
});
afterEach(() => vi.useRealTimers());

describe('showToast', () => {
  it('keeps the old behavior: text only, gone after 3.5 s', () => {
    showToast('Salvo');
    expect(uiStore.getState().toast).toBe('Salvo');
    expect(uiStore.getState().toastAction).toBeNull();
    vi.advanceTimersByTime(3499);
    expect(uiStore.getState().toast).toBe('Salvo');
    vi.advanceTimersByTime(2);
    expect(uiStore.getState().toast).toBeNull();
  });

  it('with an action lasts 8 s and the action runs once, then dismisses', () => {
    const run = vi.fn();
    showToast('Diagrama excluído', { label: 'Desfazer', run });
    vi.advanceTimersByTime(7999);
    expect(uiStore.getState().toast).toBe('Diagrama excluído');
    runToastAction();
    expect(run).toHaveBeenCalledTimes(1);
    expect(uiStore.getState().toast).toBeNull();
    runToastAction();
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('expires the action after 8 s', () => {
    const run = vi.fn();
    showToast('x', { label: 'Desfazer', run });
    vi.advanceTimersByTime(8001);
    expect(uiStore.getState().toast).toBeNull();
    runToastAction();
    expect(run).not.toHaveBeenCalled();
  });

  it('a newer plain toast replaces the older plain one and its timer', () => {
    showToast('a');
    showToast('b');
    expect(uiStore.getState().toast).toBe('b');
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(3501);
    expect(uiStore.getState().toast).toBeNull();
  });
});

describe('toast timer pause', () => {
  it('holds the auto-dismiss while paused and resumes with the remaining time', () => {
    showToast('x', { label: 'Desfazer', run: () => {} });
    vi.advanceTimersByTime(5000);
    pauseToast();
    vi.advanceTimersByTime(60000);
    expect(uiStore.getState().toast).toBe('x');
    resumeToast();
    vi.advanceTimersByTime(2999);
    expect(uiStore.getState().toast).toBe('x');
    vi.advanceTimersByTime(2);
    expect(uiStore.getState().toast).toBeNull();
  });

  it('a new toast starts a fresh timer even if the old one was paused', () => {
    showToast('a');
    pauseToast();
    showToast('b');
    vi.advanceTimersByTime(3501);
    expect(uiStore.getState().toast).toBeNull();
  });
});

describe('onExpire', () => {
  it('fires when the toast times out, is replaced or dismissed, but not when the action runs', () => {
    const expire = vi.fn();
    showToast('a', { label: 'Desfazer', run: () => {}, onExpire: expire });
    vi.advanceTimersByTime(8001);
    expect(expire).toHaveBeenCalledTimes(1);

    showToast('b', { label: 'Desfazer', run: () => {}, onExpire: expire });
    showToast('c', { label: 'Outro', run: () => {} });
    expect(expire).toHaveBeenCalledTimes(2);
    dismissToast();

    showToast('d', { label: 'Desfazer', run: () => {}, onExpire: expire });
    runToastAction();
    expect(expire).toHaveBeenCalledTimes(2);
  });
});

describe('toast queue behind an action toast', () => {
  const offer = (onExpire = vi.fn()) => showToast('Excluído', { label: 'Desfazer', run: () => {}, onExpire });

  it('an unrelated plain toast neither replaces nor expires the offer; it shows after the offer ends', () => {
    const expire = vi.fn();
    offer(expire);
    showToast('Versão salva');
    expect(uiStore.getState().toast).toBe('Excluído');
    expect(uiStore.getState().toastAction?.label).toBe('Desfazer');
    expect(expire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(8001);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(uiStore.getState().toast).toBe('Versão salva');
    expect(uiStore.getState().toastAction).toBeNull();
    vi.advanceTimersByTime(3501);
    expect(uiStore.getState().toast).toBeNull();
  });

  it('shows queued toasts in order after an explicit dismissal or after the action runs', () => {
    offer();
    showToast('um');
    showToast('dois');
    runToastAction();
    expect(uiStore.getState().toast).toBe('um');
    vi.advanceTimersByTime(3501);
    expect(uiStore.getState().toast).toBe('dois');
    vi.advanceTimersByTime(3501);
    expect(uiStore.getState().toast).toBeNull();
  });

  it('deduplicates by message and caps the queue at 5 (oldest dropped)', () => {
    offer();
    showToast('a'); showToast('a'); showToast('Excluído');
    for (const m of ['b', 'c', 'd', 'e', 'f']) showToast(m);
    dismissToast();
    const seen: string[] = [];
    while (uiStore.getState().toast) { seen.push(uiStore.getState().toast!); vi.advanceTimersByTime(3501); }
    expect(seen).toEqual(['b', 'c', 'd', 'e', 'f']);
  });

  it('an error-like toast raised during the offer is not lost', () => {
    offer();
    showToast('Não foi possível salvar');
    vi.advanceTimersByTime(8001);
    expect(uiStore.getState().toast).toBe('Não foi possível salvar');
  });

  it('a plain toast displaced by a newer action toast returns to the queue head', () => {
    showToast('info');
    offer();
    expect(uiStore.getState().toast).toBe('Excluído');
    runToastAction();
    expect(uiStore.getState().toast).toBe('info');
  });
});

describe('<Toast>', () => {
  it('renders the action as a button', () => {
    const out = renderToStaticMarkup(<ToastBody message="Diagrama excluído" action={{ label: 'Desfazer', run: () => {} }} />);
    expect(out).toContain('Diagrama excluído');
    expect(out).toMatch(/<button[^>]*>Desfazer<\/button>/);
  });

  it('renders no button for a plain toast', () => {
    expect(renderToStaticMarkup(<ToastBody message="Oi" action={null} />)).not.toContain('<button');
  });
});

describe('toast progress bar state', () => {
  it('exposes the total time, follows pause/resume and restarts per toast', () => {
    showToast('a');
    const first = uiStore.getState();
    expect(first).toMatchObject({ toastMs: 3500, toastPaused: false });
    pauseToast();
    expect(uiStore.getState().toastPaused).toBe(true);
    resumeToast();
    expect(uiStore.getState().toastPaused).toBe(false);
    showToast('b', { label: 'Desfazer', run: () => {} });
    expect(uiStore.getState().toastMs).toBe(8000);
    expect(uiStore.getState().toastId).toBeGreaterThan(first.toastId);
    dismissToast();
    expect(uiStore.getState().toastPaused).toBe(false);
  });
});
