import { afterEach, expect, it, vi } from 'vitest';
import { appUrl, siteUrl } from './urls';
import { documentationUrl } from './documentation';
afterEach(() => vi.unstubAllGlobals());
it('keeps local app and documentation routes', () => {
  expect(appUrl('?lang=en')).toBe('/app/?lang=en');
  expect(siteUrl()).toBe('/');
  expect(documentationUrl()).toMatch(/^\/docs\/(en|pt-BR)\/introduction\/$/);
});
it('links across configured origins while keeping the API same-origin', () => {
  vi.stubGlobal('document', { querySelector: (selector: string) => ({ content: selector.includes('joinlet-app-url') ? 'https://app.example.test/' : 'https://site.example.test/' }) });
  expect(appUrl()).toMatch(/^https:\/\/app.example.test\/\?lang=(en|pt-BR)$/);
  expect(appUrl('?settings=ai&lang=pt-BR')).toBe('https://app.example.test/?settings=ai&lang=pt-BR');
  expect(siteUrl('/docs/en/')).toBe('https://site.example.test/docs/en/');
  expect(documentationUrl()).toMatch(/^https:\/\/site.example.test\/docs\//);
});
