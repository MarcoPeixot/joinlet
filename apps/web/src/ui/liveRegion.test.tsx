import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { announce, liveRegionStore, LiveRegionView } from './LiveRegion';
import { draftMessage, selectionMessage } from './announcements';

beforeEach(() => liveRegionStore.setState({ message: '' }));

describe('live region', () => {
  it('is a polite, visually hidden status', () => {
    const out = renderToStaticMarkup(<LiveRegionView message="2 selecionados" />);
    expect(out).toContain('role="status"');
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain('sr-only');
    expect(out).toContain('2 selecionados');
  });

  it('announce() feeds the store', () => {
    announce('Rascunho pendente');
    expect(liveRegionStore.getState().message).toBe('Rascunho pendente');
  });

  it('announcing the same text twice still changes the DOM text', () => {
    announce('1 selecionado');
    const first = liveRegionStore.getState().message;
    announce('1 selecionado');
    expect(liveRegionStore.getState().message).not.toBe(first);
    expect(liveRegionStore.getState().message.trim()).toBe('1 selecionado');
  });
});

describe('messages', () => {
  it('counts the selection in pt-BR and stays silent when empty', () => {
    expect(selectionMessage({ nodes: [], edges: [] })).toBe('');
    expect(selectionMessage({ nodes: ['a'], edges: [] })).toBe('1 selecionado');
    expect(selectionMessage({ nodes: ['a', 'b'], edges: ['e'] })).toBe('3 selecionados');
  });

  it('announces a pending draft only when it appears', () => {
    expect(draftMessage(true, false)).toBe('Rascunho pendente');
    expect(draftMessage(true, true)).toBe('');
    expect(draftMessage(false, true)).toBe('Rascunho resolvido');
  });
});
