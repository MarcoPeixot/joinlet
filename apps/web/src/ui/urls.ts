import { getLocale } from '../i18n';

/** Configured by the remote server; absent in local development. */
function base(name: 'app' | 'site', fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return document.querySelector<HTMLMetaElement>(`meta[name="joinlet-${name}-url"]`)?.content || fallback;
}
export function appUrl(query = ''): string {
  const target = base('app', '/app/');
  // A different origin cannot read the language preference saved on the public site.
  return target + (query || (target.startsWith('https:') ? `?lang=${getLocale()}` : ''));
}
export const siteUrl = (path = '') => base('site', '/') + path.replace(/^\//, '');
