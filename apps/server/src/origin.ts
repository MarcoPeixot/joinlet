/** Where the owner's browser app is served from: the Vite dev server and `vite preview` (see apps/web/vite.config.ts). */
const DEV_PORTS = [5178, 4173];
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * The origins allowed to call the owner's `/api/*`. Loopback host names only, on the app's real ports (dev 5178,
 * `vite preview` 4173, this server's own port) plus whatever `STRUKT_ALLOWED_ORIGINS` lists (comma separated
 * origins, e.g. `http://localhost:5179`, for a Vite on another port).
 */
export function allowedOrigins(env: Record<string, string | undefined> = {}, ownPort?: number): string[] {
  const ports = [...DEV_PORTS, ...(ownPort ? [ownPort] : [])];
  const origins = LOOPBACK_HOSTS.flatMap((host) => ports.map((port) => `http://${host}:${port}`));
  for (const raw of (env.STRUKT_ALLOWED_ORIGINS ?? '').split(',')) {
    const origin = normalizeOrigin(raw.trim());
    if (origin) origins.push(origin);
  }
  return [...new Set(origins)];
}

/** `scheme://host[:port]` of an http(s) URL, or null (`Origin: null`, other schemes and garbage never match). */
export function normalizeOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * A browser sends `Origin` on every cross-origin request and every POST; a page on another origin (even
 * `http://evil.localhost:3000`, which the OS resolves to loopback) must not drive this API. No `Origin` means a
 * same-origin GET or a non-browser client, which the Host check already confines to this machine.
 */
export function originRefusal(origin: string | undefined, fetchSite: string | undefined, allowed: readonly string[]): string | null {
  if (fetchSite === 'cross-site') return 'Este pedido veio de outro site e foi recusado.';
  if (origin === undefined) return null;
  const normalized = normalizeOrigin(origin);
  return normalized && allowed.includes(normalized) ? null : 'Origem não permitida: o Joinlet só aceita pedidos do próprio app (defina STRUKT_ALLOWED_ORIGINS para usar outra porta).';
}
