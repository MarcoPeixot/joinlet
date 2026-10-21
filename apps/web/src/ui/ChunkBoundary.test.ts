import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHUNK_ERROR_MESSAGE, ChunkBoundary, isChunkError, reportChunkFailure, resetChunkFailures } from './ChunkBoundary';
import { closeSettings, openSettings, settingsStore } from '../settings/store';
import { clearToastQueue, dismissToast, uiStore } from './uiStore';

beforeEach(() => {
  resetChunkFailures();
  dismissToast();
  clearToastQueue();
  uiStore.setState({ rightPanel: null });
});

describe('ChunkBoundary', () => {
  it('turns a thrown error into the failed state, classifying chunk failures apart from render bugs', () => {
    expect(ChunkBoundary.getDerivedStateFromError(new TypeError('Failed to fetch dynamically imported module: /x.js'))).toEqual({ failed: true, chunk: true });
    expect(ChunkBoundary.getDerivedStateFromError(new TypeError('refs.map is not a function'))).toEqual({ failed: true, chunk: false });
  });

  it('isChunkError recognises the browsers\' dynamic-import failures only', () => {
    for (const message of ['Failed to fetch dynamically imported module', 'error loading dynamically imported module', 'Importing a module script failed.', 'Loading chunk 12 failed']) {
      expect(isChunkError(new Error(message)), message).toBe(true);
    }
    const named = new Error('x');
    named.name = 'ChunkLoadError';
    expect(isChunkError(named)).toBe(true);
    expect(isChunkError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkError('boom')).toBe(false);
  });

  it('a quiet boundary (a badge) draws nothing when its chunk fails, instead of the alert', () => {
    const boundary = new ChunkBoundary({ children: 'x', quiet: true });
    expect(boundary.render()).toBe('x');
    boundary.state = { failed: true, chunk: true, attempts: 0 };
    expect(boundary.render()).toBeNull();
    const loud = new ChunkBoundary({ children: 'x' });
    loud.state = { failed: true, chunk: true, attempts: 0 };
    expect(loud.render()).not.toBeNull();
  });

  it('a render bug is logged with console.error and gets the generic message, not the connection toast', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boundary = new ChunkBoundary({ children: null });
    const error = new TypeError('refs.map is not a function');
    boundary.componentDidCatch(error);
    expect(log).toHaveBeenCalled();
    expect(uiStore.getState().toast).toBeNull();
    log.mockRestore();
  });

  it('a chunk failure calls onError (e.g. to release a modal state)', () => {
    const onError = vi.fn();
    const boundary = new ChunkBoundary({ children: null, onError });
    boundary.componentDidCatch(new Error('Failed to fetch dynamically imported module'));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(uiStore.getState().toast).toBe(CHUNK_ERROR_MESSAGE);
  });

  it('reportChunkFailure toasts in pt-BR and closes only its own right panel', () => {
    uiStore.setState({ rightPanel: 'flows' });
    reportChunkFailure('accuracy');
    expect(uiStore.getState().rightPanel).toBe('flows');
    reportChunkFailure('flows');
    expect(uiStore.getState().rightPanel).toBeNull();
    expect(uiStore.getState().toast).toBe(CHUNK_ERROR_MESSAGE);
    expect(uiStore.getState().toastAction?.label).toBe('Tentar de novo');
  });

  it('toast retry reopens the panel', () => {
    reportChunkFailure('flows');
    uiStore.getState().toastAction?.run();
    expect(uiStore.getState().rightPanel).toBe('flows');
  });

  it('a second failure of the same panel offers a page reload (browsers cache failed module fetches)', () => {
    reportChunkFailure('flows');
    reportChunkFailure('flows');
    expect(uiStore.getState().toastAction?.label).toBe('Recarregar a página');
  });

  it('without a panel the toast has no action (the inline retry button is the way)', () => {
    reportChunkFailure();
    expect(uiStore.getState().toastAction).toBeNull();
  });

  it('a failed settings chunk releases the settings state so canvas shortcuts and ⌘S work again', () => {
    openSettings();
    expect(settingsStore.getState().open).toBe(true);
    const boundary = new ChunkBoundary({ children: null, onError: closeSettings });
    boundary.componentDidCatch(new Error('Failed to fetch dynamically imported module'));
    expect(settingsStore.getState().open).toBe(false);
  });
});
