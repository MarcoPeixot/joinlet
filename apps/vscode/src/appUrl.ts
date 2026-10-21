export const DEFAULT_APP_URL = 'http://localhost:5178';

export type AppUrl = { ok: true; url: string } | { ok: false; error: string };

/** The `strukt.appUrl` setting as a safe http(s) URL: nothing else is ever handed to the browser. */
export function resolveAppUrl(raw: unknown): AppUrl {
  const value = raw === undefined ? DEFAULT_APP_URL : raw;
  const invalid: AppUrl = { ok: false, error: 'A configuração strukt.appUrl precisa ser um endereço http:// ou https:// (sem usuário e senha).' };
  if (typeof value !== 'string') return invalid;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return invalid;
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) return invalid;
  return { ok: true, url: url.toString() };
}
