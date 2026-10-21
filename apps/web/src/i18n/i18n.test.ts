import { afterEach, describe, expect, it, vi } from 'vitest';
import english from './en.json';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
function environment(lang: string) {
  vi.stubGlobal('location', { search: '', href: 'http://localhost/app/#diagram/test', assign: vi.fn() });
  vi.stubGlobal('localStorage', { getItem: () => lang, setItem: vi.fn() });
}
describe('Joinlet language', () => {
  it('has matching interpolation arguments for every translated message', () => {
    for (const [source, target] of Object.entries(english)) {
      expect([...source.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort(), source).toEqual([...target.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort());
    }
  });
  it('translates UI messages and preserves arbitrary content and identifiers', async () => {
    environment('en');
    const { getLocale, uiText, systemMessage } = await import('./index');
    expect(getLocale()).toBe('en');
    expect(uiText('Salvar')).toBe('Save');
    expect(uiText('Excluir {0}', ['Meu diagrama'])).toBe('Delete Meu diagrama');
    expect(uiText('Overview')).toBe('Overview');
    expect(uiText('.strukt.json')).toBe('.strukt.json');
    expect(systemMessage('Não foi possível abrir a pasta: EACCES')).toBe('Could not open folder: EACCES');
    expect(systemMessage('Unknown provider diagnostic')).toBe('Unknown provider diagnostic');
  });
  it('preserves an explicit Brazilian Portuguese preference', async () => {
    environment('pt-BR');
    const { getLocale, uiText } = await import('./index');
    expect(getLocale()).toBe('pt-BR');
    expect(uiText('Excluir {0}', ['App'])).toBe('Excluir App');
  });
  it.each([null, 'unsupported', 'en'])('defaults to English for preference %s', async value => {
    environment(value as string);
    expect((await import('./index')).getLocale()).toBe('en');
  });
  it('uses English when storage is unavailable', async () => {
    environment('pt-BR');
    vi.stubGlobal('localStorage', { getItem: () => { throw Error('blocked'); } });
    expect((await import('./index')).getLocale()).toBe('en');
  });
  it('honors an explicit Portuguese URL before the saved language', async () => {
    environment('en');
    vi.stubGlobal('location', { search: '?lang=pt-BR' });
    expect((await import('./index')).getLocale()).toBe('pt-BR');
  });
  it('waits for pending writes before persisting language and navigating', async () => {
    environment('pt-BR');
    const { beforeLocaleChange, changeLocale } = await import('./index');
    let finish!: () => void;
    beforeLocaleChange(() => new Promise<void>(resolve=>{ finish=resolve; }));
    const changing = changeLocale('en');
    expect(location.assign).not.toHaveBeenCalled();
    finish(); await changing;
    expect(localStorage.setItem).toHaveBeenCalledWith('joinlet:locale','en');
    expect(location.assign).toHaveBeenCalledWith('http://localhost/app/?lang=en#diagram/test');
  });
  it('does not navigate if saving fails', async () => {
    environment('pt-BR');
    const { beforeLocaleChange, changeLocale } = await import('./index');
    beforeLocaleChange(async()=>{throw Error('disk full');});
    await expect(changeLocale('en')).rejects.toThrow('disk full');
    expect(location.assign).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });
});
