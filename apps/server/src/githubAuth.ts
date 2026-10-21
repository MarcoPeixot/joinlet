import { randomUUID } from 'node:crypto';

const DEVICE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const API_HEADERS = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };

interface Credentials {
  version: 1;
  accessToken: string;
  refreshToken: string | null;
  accessExpiresAt: number | null;
  refreshExpiresAt: number | null;
  login: string;
}

interface DeviceFlow {
  deviceCode: string;
  intervalMs: number;
  expiresAt: number;
  lastPollAt: number;
}

export interface GithubAuthView {
  configured: boolean;
  connected: boolean;
  login: string | null;
}

export interface GithubDeviceFlow {
  id: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
  expiresAt: number;
}

export type GithubPollResult =
  | { state: 'pending'; retryAfter: number }
  | { state: 'connected'; login: string }
  | { state: 'error'; error: string };

export interface GithubAuthOptions {
  clientId?: string;
  fs: { read(): Promise<string | null>; write(text: string | null): Promise<void> };
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  makeId?: () => string;
}

function parseCredentials(text: string | null): Credentials | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as Partial<Credentials>;
    if (raw.version !== 1 || typeof raw.accessToken !== 'string' || typeof raw.login !== 'string') return null;
    return {
      version: 1,
      accessToken: raw.accessToken,
      refreshToken: typeof raw.refreshToken === 'string' ? raw.refreshToken : null,
      accessExpiresAt: typeof raw.accessExpiresAt === 'number' ? raw.accessExpiresAt : null,
      refreshExpiresAt: typeof raw.refreshExpiresAt === 'number' ? raw.refreshExpiresAt : null,
      login: raw.login,
    };
  } catch {
    return null;
  }
}

const seconds = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/** Device OAuth runs on the local server; access and refresh tokens never reach the browser. */
export function createGithubAuth(options: GithubAuthOptions) {
  const clientId = options.clientId?.trim() ?? '';
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const makeId = options.makeId ?? randomUUID;
  const flows = new Map<string, DeviceFlow>();
  let credentials: Credentials | null = null;
  let refreshInFlight: Promise<string | null> | null = null;

  const save = async (next: Credentials | null) => {
    await options.fs.write(next ? JSON.stringify(next) : null);
    credentials = next;
  };

  const tokenReply = async (response: Response) => {
    const body = await responseJson(response);
    if (!response.ok || typeof body.access_token !== 'string') return null;
    return body;
  };

  async function refresh(): Promise<string | null> {
    const current = credentials;
    if (!current?.refreshToken || (current.refreshExpiresAt !== null && current.refreshExpiresAt <= now())) return null;
    let response: Response;
    try {
      response = await fetcher(TOKEN_URL, {
        method: 'POST',
        headers: { ...API_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, grant_type: 'refresh_token', refresh_token: current.refreshToken }),
      });
    } catch {
      return null;
    }
    const body = await tokenReply(response);
    if (!body) return null;
    const at = now();
    await save({
      ...current,
      accessToken: body.access_token as string,
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : current.refreshToken,
      accessExpiresAt: seconds(body.expires_in) ? at + seconds(body.expires_in)! * 1000 : null,
      refreshExpiresAt: seconds(body.refresh_token_expires_in) ? at + seconds(body.refresh_token_expires_in)! * 1000 : current.refreshExpiresAt,
    });
    return credentials?.accessToken ?? null;
  }

  return {
    async load() {
      credentials = parseCredentials(await options.fs.read());
    },

    view(): GithubAuthView {
      return { configured: !!clientId, connected: !!credentials, login: credentials?.login ?? null };
    },

    async startDeviceFlow(): Promise<{ ok: true; flow: GithubDeviceFlow } | { ok: false; status: 400 | 502 | 503; error: string }> {
      if (!clientId) return { ok: false, status: 503, error: 'Configure STRUKT_GITHUB_CLIENT_ID no servidor para ativar o login com GitHub.' };
      let response: Response;
      try {
        response = await fetcher(DEVICE_URL, {
          method: 'POST',
          headers: { ...API_HEADERS, 'content-type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, scope: 'repo offline_access' }),
        });
      } catch {
        return { ok: false, status: 502, error: 'Não foi possível iniciar o login com GitHub.' };
      }
      const body = await responseJson(response);
      if (!response.ok || typeof body.device_code !== 'string' || typeof body.user_code !== 'string') {
        const error = body.error === 'device_flow_disabled'
          ? 'Ative o Device Flow nas configurações do app OAuth do GitHub.'
          : 'O GitHub não conseguiu iniciar o login. Confira o Client ID do servidor.';
        return { ok: false, status: 400, error };
      }
      const id = makeId();
      const at = now();
      const expiresIn = seconds(body.expires_in) ?? 900;
      const intervalSeconds = seconds(body.interval) ?? 5;
      flows.set(id, { deviceCode: body.device_code, intervalMs: intervalSeconds * 1000, expiresAt: at + expiresIn * 1000, lastPollAt: at });
      return {
        ok: true,
        flow: {
          id,
          userCode: body.user_code,
          verificationUri: typeof body.verification_uri === 'string' ? body.verification_uri : 'https://github.com/login/device',
          intervalSeconds,
          expiresAt: at + expiresIn * 1000,
        },
      };
    },

    async pollDeviceFlow(id: string): Promise<GithubPollResult> {
      const flow = flows.get(id);
      if (!flow) return { state: 'error', error: 'Este pedido de login expirou. Inicie a conexão de novo.' };
      const at = now();
      if (at >= flow.expiresAt) {
        flows.delete(id);
        return { state: 'error', error: 'O código de login expirou. Inicie a conexão de novo.' };
      }
      const wait = flow.intervalMs - (at - flow.lastPollAt);
      if (wait > 0) return { state: 'pending', retryAfter: Math.ceil(wait / 1000) };
      flow.lastPollAt = at;

      let response: Response;
      try {
        response = await fetcher(TOKEN_URL, {
          method: 'POST',
          headers: { ...API_HEADERS, 'content-type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, device_code: flow.deviceCode, grant_type: DEVICE_GRANT }),
        });
      } catch {
        return { state: 'error', error: 'Não foi possível verificar o login com GitHub. Tente de novo.' };
      }
      const body = await responseJson(response);
      if (body.error === 'authorization_pending') return { state: 'pending', retryAfter: Math.ceil(flow.intervalMs / 1000) };
      if (body.error === 'slow_down') {
        flow.intervalMs += 5_000;
        return { state: 'pending', retryAfter: Math.ceil(flow.intervalMs / 1000) };
      }
      if (body.error === 'access_denied') {
        flows.delete(id);
        return { state: 'error', error: 'O login foi cancelado no GitHub.' };
      }
      if (body.error === 'expired_token') {
        flows.delete(id);
        return { state: 'error', error: 'O código de login expirou. Inicie a conexão de novo.' };
      }
      if (!response.ok || typeof body.access_token !== 'string') return { state: 'error', error: 'O GitHub recusou o login. Tente conectar de novo.' };

      let userResponse: Response;
      try {
        userResponse = await fetcher(USER_URL, { headers: { ...API_HEADERS, authorization: `Bearer ${body.access_token}` } });
      } catch {
        flows.delete(id);
        return { state: 'error', error: 'O GitHub autorizou o login, mas não foi possível validar a conta.' };
      }
      const user = await responseJson(userResponse);
      if (!userResponse.ok || typeof user.login !== 'string') {
        flows.delete(id);
        return { state: 'error', error: 'O GitHub autorizou o login, mas não foi possível validar a conta.' };
      }
      await save({
        version: 1,
        accessToken: body.access_token,
        refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
        accessExpiresAt: seconds(body.expires_in) ? at + seconds(body.expires_in)! * 1000 : null,
        refreshExpiresAt: seconds(body.refresh_token_expires_in) ? at + seconds(body.refresh_token_expires_in)! * 1000 : null,
        login: user.login,
      });
      flows.delete(id);
      return { state: 'connected', login: user.login };
    },

    async token(): Promise<string | null> {
      if (!credentials) return null;
      if (credentials.accessExpiresAt === null || credentials.accessExpiresAt > now() + 60_000) return credentials.accessToken;
      if (!refreshInFlight) refreshInFlight = refresh().finally(() => { refreshInFlight = null; });
      try {
        const token = await refreshInFlight;
        if (!token && credentials?.accessExpiresAt !== null && credentials?.accessExpiresAt !== undefined && credentials.accessExpiresAt <= now() && !credentials.refreshToken) {
          await save(null);
        }
        return token;
      } catch {
        return null;
      }
    },

    async disconnect(): Promise<void> {
      await save(null);
      flows.clear();
    },
  };
}

export type GithubAuth = ReturnType<typeof createGithubAuth>;
