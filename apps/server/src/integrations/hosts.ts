/**
 * SSRF guard for every URL an integration calls. The user (or a hand-edited settings file) supplies webhook URLs
 * and the Atlassian site, and the services answer with URLs of their own (upload targets, page links): all of them
 * must land on a fixed set of hosts, over https, with no userinfo and no custom port. IP literals and lookalike
 * hosts fail simply because they are not on the list.
 */

/** The slice of `fetch` the integrations use (Bun's `typeof fetch` also carries `preconnect`, which fakes need not). */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type HostKind = 'slack' | 'teams' | 'discord' | 'atlassian' | 'notion';

export class IntegrationError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = 'IntegrationError';
  }
}

interface Rule {
  label: string;
  host: RegExp;
  /** Path rule: only webhooks have one (the service's own endpoint shape); API hosts are open on purpose. */
  path?: RegExp;
}

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';

const RULES: Record<HostKind, Rule> = {
  slack: { label: 'Slack', host: /^hooks\.slack\.com$/, path: /^\/(?:services|triggers)\/[A-Za-z0-9_/-]{1,300}$/ },
  teams: {
    label: 'Teams',
    host: new RegExp(`^(?:${LABEL}\\.webhook\\.office\\.com|outlook\\.office\\.com)$`),
    path: /^\/webhook(?:b2)?\/[A-Za-z0-9@._/-]{1,400}$/,
  },
  discord: { label: 'Discord', host: /^discord\.com$/, path: /^\/api(?:\/v\d{1,2})?\/webhooks\/\d{5,25}\/[A-Za-z0-9_-]{10,200}$/ },
  atlassian: { label: 'Atlassian', host: new RegExp(`^${LABEL}\\.atlassian\\.net$`) },
  notion: { label: 'Notion', host: /^api\.notion\.com$/ },
};

const MAX_URL = 2048;
/** Printable ASCII without space: a raw URL with anything else (control, space, Unicode dots) is refused outright. */
const PLAIN_URL = /^[\x21-\x7e]+$/;

/** The parsed URL, or the pt-BR reason it is not an address this integration may call. */
export function checkUrl(kind: HostKind, raw: unknown): URL | { error: string } {
  const rule = RULES[kind];
  const invalid = { error: `O endereço do ${rule.label} é inválido.` };
  if (typeof raw !== 'string' || !raw.trim()) return { error: `Informe o endereço do ${rule.label}.` };
  if (raw.length > MAX_URL || !PLAIN_URL.test(raw) || raw.includes('\\')) return invalid;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return invalid;
  }
  if (url.protocol !== 'https:') return { error: `Use um endereço https:// para ${rule.label}.` };
  if (url.username || url.password) return { error: `O endereço do ${rule.label} não pode ter usuário ou senha.` };
  if (url.port) return { error: `O endereço do ${rule.label} não pode ter porta própria.` };
  if (!rule.host.test(url.hostname)) return { error: `O endereço não pertence ao ${rule.label} (host não permitido).` };
  if (rule.path && !rule.path.test(url.pathname)) return { error: `O caminho do endereço não é o de um webhook do ${rule.label}.` };
  return url;
}

/** `acme`, `acme.atlassian.net` or any https URL on that site → `https://acme.atlassian.net`. */
export function normalizeSite(raw: unknown): string | { error: string } {
  if (typeof raw !== 'string' || !raw.trim()) return { error: 'Informe o site da Atlassian (por exemplo, empresa.atlassian.net).' };
  const text = raw.trim().toLowerCase();
  const candidate = new RegExp(`^${LABEL}$`).test(text) ? `https://${text}.atlassian.net` : /^[a-z0-9.-]+$/.test(text) ? `https://${text}` : text;
  const url = checkUrl('atlassian', candidate);
  return 'error' in url ? { error: 'O site precisa ser algo como empresa.atlassian.net.' } : url.origin;
}

const REDIRECT_ERROR = 'O serviço tentou redirecionar a chamada; por segurança o Joinlet não segue redirecionamentos.';
const MAX_HOPS = 3;

/**
 * `fetch` that cannot be steered off the allowlist: the URL is checked first, redirects are never followed by the
 * runtime (`redirect: 'manual'`), and a 307/308 is followed only inside the same origin and the same path rule
 * (credentials never leave the origin they were meant for). Failures carry no URL: a webhook URL is a secret.
 */
export async function safeFetch(
  fetchImpl: FetchLike,
  kind: HostKind,
  target: string,
  init: RequestInit,
  timeoutMs = 15_000,
): Promise<Response> {
  const label = RULES[kind].label;
  const first = checkUrl(kind, target);
  if ('error' in first) throw new IntegrationError(first.error, 400);
  let current = first;
  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      res = await fetchImpl(current.href, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    } catch (cause) {
      const timedOut = cause instanceof DOMException && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
      throw new IntegrationError(timedOut ? `O ${label} demorou demais para responder.` : `Não foi possível falar com o ${label}.`);
    }
    if (res.status < 300 || res.status >= 400) return res;
    void res.body?.cancel().catch(() => undefined);
    const location = res.headers.get('location');
    if ((res.status !== 307 && res.status !== 308) || !location || hop >= MAX_HOPS) throw new IntegrationError(REDIRECT_ERROR);
    let next: URL | { error: string };
    try {
      next = checkUrl(kind, new URL(location, current).href);
    } catch {
      throw new IntegrationError(REDIRECT_ERROR);
    }
    if ('error' in next || next.origin !== first.origin) throw new IntegrationError(REDIRECT_ERROR);
    current = next;
  }
}
