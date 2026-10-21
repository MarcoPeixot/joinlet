import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_URL, resolveAppUrl } from './appUrl';

describe('resolveAppUrl', () => {
  it('uses the local dev server by default', () => {
    expect(resolveAppUrl(undefined)).toEqual({ ok: true, url: 'http://localhost:5178/' });
    expect(DEFAULT_APP_URL).toBe('http://localhost:5178');
  });

  it('accepts http and https and normalises', () => {
    expect(resolveAppUrl(' https://strukt.example.com/app ')).toEqual({ ok: true, url: 'https://strukt.example.com/app' });
  });

  it('refuses other schemes: the setting must not open file:, javascript: or custom handlers', () => {
    for (const raw of ['file:///etc/passwd', 'javascript:alert(1)', 'vscode://x/y', 'ftp://x', 'localhost:5178']) {
      expect(resolveAppUrl(raw)).toEqual({ ok: false, error: expect.stringContaining('strukt.appUrl') });
    }
  });

  it('refuses credentials in the URL', () => {
    expect(resolveAppUrl('https://user:pass@host/')).toMatchObject({ ok: false });
  });

  it('refuses garbage and non-strings', () => {
    expect(resolveAppUrl('')).toMatchObject({ ok: false });
    expect(resolveAppUrl(42)).toMatchObject({ ok: false });
    expect(resolveAppUrl('http://')).toMatchObject({ ok: false });
  });
});
