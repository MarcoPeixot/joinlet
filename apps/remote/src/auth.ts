import { BETA_PLAN, SELF_HOSTED_PLAN } from '@strukt/workspace';
import { createBetaAccounts } from './betaAccounts';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import type { Response } from 'express';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidGrantError, InvalidRequestError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

const GH_HEADERS = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');

interface GithubCredentials {
  accessToken: string;
  refreshToken: string | null;
  accessExpiresAt: number | null;
  refreshExpiresAt: number | null;
  userId: number;
  login: string;
}

interface Flow {
  clientId: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  resource: string;
  scopes: string[];
  github?: string;
  repos?: string[];
}

interface Code {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scopes: string[];
  repo: string;
  githubSession: string;
}

interface Grant {
  clientId: string;
  resource: string;
  scopes: string[];
  repo: string;
  githubSession: string;
  expiresAt?: number;
}

interface BrowserGrant extends Grant { csrf: string; }

export interface RemoteAuthOptions {
  /** Trusted operator setting, never read from request bodies or workspace files. */
  deploymentMode?: 'self-hosted' | 'cloud';
  adminGithubIds?: ReadonlySet<number>;
  trustProxyHops?: number;
  publicUrl: string;
  /** Marketing origin; when present, the editor is served at publicUrl root. */
  siteUrl?: string;
  githubClientId: string;
  githubClientSecret: string;
  githubAppSlug?: string;
  encryptionKey: string;
  databasePath: string;
  fetch?: typeof fetch;
  now?: () => number;
}

/** GitHub handles sign-in; Joinlet issues distinct MCP tokens bound to one chosen repository. */
export function createRemoteAuth(options: RemoteAuthOptions) {
  const publicUrl = options.publicUrl.replace(/\/$/, '');
  const resource = `${publicUrl}/mcp`;
  const key = Buffer.from(options.encryptionKey, 'hex');
  if (!/^[0-9a-f]{64}$/i.test(options.encryptionKey) || key.length !== 32) throw new Error('STRUKT_REMOTE_ENCRYPTION_KEY precisa ter 64 caracteres hexadecimais.');
  if (!URL.canParse(publicUrl) || new URL(publicUrl).origin !== publicUrl || (!publicUrl.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(publicUrl))) {
    throw new Error('STRUKT_PUBLIC_URL precisa ser HTTPS (ou localhost para desenvolvimento).');
  }
  const db = new Database(options.databasePath, { create: true });
  if (options.databasePath !== ':memory:') chmodSync(options.databasePath, 0o600);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, expires INTEGER, PRIMARY KEY(kind, id))');
  const now = options.now ?? Date.now;
  const fetcher = options.fetch ?? fetch;
  const accessPlan = options.deploymentMode === 'cloud' ? BETA_PLAN : SELF_HOSTED_PLAN;
  const beta = createBetaAccounts(db, now, options.adminGithubIds, accessPlan);
  const put = (kind: string, id: string, value: unknown, expires?: number) => {
    db.query('INSERT OR REPLACE INTO records (kind, id, value, expires) VALUES (?, ?, ?, ?)').run(kind, id, JSON.stringify(value), expires ?? null);
  };
  const get = <T>(kind: string, id: string): T | null => {
    const row = db.query('SELECT value, expires FROM records WHERE kind = ? AND id = ?').get(kind, id) as { value: string; expires: number | null } | null;
    if (!row) return null;
    if (row.expires !== null && row.expires <= now()) {
      db.query('DELETE FROM records WHERE kind = ? AND id = ?').run(kind, id);
      return null;
    }
    return JSON.parse(row.value) as T;
  };
  const drop = (kind: string, id: string) => db.query('DELETE FROM records WHERE kind = ? AND id = ?').run(kind, id);
  const take = <T>(kind: string, id: string): T | null => db.transaction(() => {
    const value = get<T>(kind, id);
    if (value) drop(kind, id);
    return value;
  })();
  const encrypt = (value: GithubCredentials) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url')).join('.');
  };
  const decrypt = (value: string): GithubCredentials => {
    const [iv, tag, data] = value.split('.').map((part) => Buffer.from(part!, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', key, iv!);
    decipher.setAuthTag(tag!);
    return JSON.parse(Buffer.concat([decipher.update(data!), decipher.final()]).toString('utf8')) as GithubCredentials;
  };
  const githubJson = async <T>(url: string, init: RequestInit): Promise<T> => {
    const response = await fetcher(url, { ...init, headers: { ...GH_HEADERS, ...init.headers } });
    if (!response.ok) throw new Error(`GitHub respondeu ${response.status}.`);
    return response.json() as Promise<T>;
  };

  const clientsStore = {
    getClient: (id: string) => get<OAuthClientInformationFull>('client', id) ?? undefined,
    registerClient: (client: OAuthClientInformationFull) => {
      for (const redirect of client.redirect_uris) {
        const url = new URL(redirect);
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
          throw new InvalidRequestError('URI de retorno precisa ser HTTPS ou loopback local.');
        }
      }
      put('client', client.client_id, client);
      return client;
    },
  };

  const issue = (grant: Grant): OAuthTokens => {
    const access = secret();
    const refresh = secret();
    put('access', hash(access), { ...grant, expiresAt: Math.floor((now() + 60 * 60_000) / 1000) }, now() + 60 * 60_000);
    put('refresh', hash(refresh), grant, now() + 30 * 24 * 60 * 60_000);
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 3600, scope: grant.scopes.join(' ') };
  };

  const provider: OAuthServerProvider = {
    clientsStore,
    async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
      if (params.resource && params.resource.href !== resource) throw new InvalidRequestError('Recurso MCP diferente do Joinlet.');
      const scopes = params.scopes?.length ? params.scopes : ['strukt'];
      if (scopes.some((scope) => scope !== 'strukt')) throw new InvalidRequestError('Escopo MCP desconhecido.');
      const state = secret();
      put('flow', hash(state), {
        clientId: client.client_id, redirectUri: params.redirectUri, state: params.state,
        codeChallenge: params.codeChallenge, resource, scopes,
      } satisfies Flow, now() + 15 * 60_000);
      const github = new URL('https://github.com/login/oauth/authorize');
      github.searchParams.set('client_id', options.githubClientId);
      github.searchParams.set('redirect_uri', `${publicUrl}/github/callback`);
      github.searchParams.set('state', state);
      res.redirect(github.href);
    },
    async challengeForAuthorizationCode(client, code) {
      const grant = get<Code>('code', hash(code));
      if (!grant || grant.clientId !== client.client_id) throw new InvalidGrantError('Código expirado ou inválido.');
      return grant.codeChallenge;
    },
    async exchangeAuthorizationCode(client, code, _verifier, redirectUri, requestedResource) {
      const pending = get<Code>('code', hash(code));
      if (!pending || pending.clientId !== client.client_id || (redirectUri && redirectUri !== pending.redirectUri) || (requestedResource && requestedResource.href !== pending.resource)) {
        throw new InvalidGrantError('Código expirado ou associado a outro cliente.');
      }
      const grant = take<Code>('code', hash(code));
      if (!grant) throw new InvalidGrantError('Código já utilizado.');
      return issue(grant);
    },
    async exchangeRefreshToken(client, token, scopes, requestedResource) {
      const pending = get<Grant>('refresh', hash(token));
      if (!pending || pending.clientId !== client.client_id || (requestedResource && requestedResource.href !== pending.resource) || (scopes && scopes.some((scope) => !pending.scopes.includes(scope)))) {
        throw new InvalidGrantError('Refresh token expirado ou inválido.');
      }
      const grant = take<Grant>('refresh', hash(token));
      if (!grant) throw new InvalidGrantError('Refresh token já utilizado.');
      return issue({ ...grant, scopes: scopes ?? grant.scopes });
    },
    async verifyAccessToken(token): Promise<AuthInfo> {
      const grant = get<Grant>('access', hash(token));
      if (!grant) throw new InvalidTokenError('Token MCP expirado ou inválido.');
      return { token, clientId: grant.clientId, scopes: grant.scopes, expiresAt: grant.expiresAt, resource: new URL(grant.resource), extra: { repo: grant.repo, githubSession: grant.githubSession } };
    },
    async revokeToken(client, request) {
      const id = hash(request.token);
      if (get<Grant>('access', id)?.clientId === client.client_id) drop('access', id);
      if (get<Grant>('refresh', id)?.clientId === client.client_id) drop('refresh', id);
    },
  };

  const githubRefreshes = new Map<string, Promise<GithubCredentials>>();
  const revokedSessions = new Set<string>();
  const githubForGrant = async (grant: Grant): Promise<{ token: string; repo: string; userId: number }> => {
    if (revokedSessions.has(grant.githubSession)) throw new InvalidGrantError('Autorização revogada.');
    const encrypted = get<string>('github', grant.githubSession);
    if (!encrypted) throw new InvalidGrantError('Autorização GitHub expirada.');
    let credentials = decrypt(encrypted);
    if (credentials.accessExpiresAt !== null && credentials.accessExpiresAt < now() + 60_000) {
      let pending = githubRefreshes.get(grant.githubSession);
      if (!pending) {
        pending = (async () => {
          if (!credentials.refreshToken || (credentials.refreshExpiresAt !== null && credentials.refreshExpiresAt <= now())) throw new InvalidGrantError('Reconecte sua conta GitHub.');
          const fresh = await githubJson<{ access_token: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number }>(
            'https://github.com/login/oauth/access_token', {
              method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
              body: JSON.stringify({ client_id: options.githubClientId, client_secret: options.githubClientSecret, grant_type: 'refresh_token', refresh_token: credentials.refreshToken }),
            },
          );
          const updated = {
            ...credentials, accessToken: fresh.access_token,
            refreshToken: fresh.refresh_token ?? credentials.refreshToken,
            accessExpiresAt: fresh.expires_in ? now() + fresh.expires_in * 1000 : null,
            refreshExpiresAt: fresh.refresh_token_expires_in ? now() + fresh.refresh_token_expires_in * 1000 : credentials.refreshExpiresAt,
          };
          if (revokedSessions.has(grant.githubSession)) throw new InvalidGrantError('Autorização revogada.');
          put('github', grant.githubSession, encrypt(updated), now() + 30 * 24 * 60 * 60_000);
          return updated;
        })();
        githubRefreshes.set(grant.githubSession, pending);
        void pending.then(() => githubRefreshes.delete(grant.githubSession), () => githubRefreshes.delete(grant.githubSession));
      }
      credentials = await pending;
    }
    return { token: credentials.accessToken, repo: grant.repo, userId: credentials.userId };
  };

  return {
    database: db,
    accessPlan,
    provider,
    beta,
    publicUrl,
    resource,
    startWebLogin() {
      const state = secret();
      const verifier = secret();
      put('web-flow', hash(state), { verifier: hash(verifier) }, now() + 10 * 60_000);
      const url = new URL('https://github.com/login/oauth/authorize');
      url.searchParams.set('client_id', options.githubClientId);
      url.searchParams.set('redirect_uri', `${publicUrl}/github/callback`);
      url.searchParams.set('state', state);
      return { url: url.href, verifier };
    },
    isWebFlow(state: string) { return !!get('web-flow', hash(state)); },
    async finishWebLogin(code: string, state: string, verifier: string) {
      const flow = get<{ verifier: string }>('web-flow', hash(state));
      if (!flow || hash(verifier) !== flow.verifier) throw new InvalidGrantError('Sign-in expired. Please try again.');
      take('web-flow', hash(state));
      const body = await githubJson<{ access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number }>('https://github.com/login/oauth/access_token', {
        method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: options.githubClientId, client_secret: options.githubClientSecret, code, redirect_uri: `${publicUrl}/github/callback` }),
      });
      if (!body.access_token) throw new InvalidGrantError('GitHub did not authorize sign-in.');
      const user = await githubJson<{ id: number; login: string }>('https://api.github.com/user', { headers: { authorization: `Bearer ${body.access_token}` } });
      if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.login !== 'string') throw new InvalidGrantError('Invalid GitHub identity.');
      const token = secret();
      const existing = db.query("SELECT repo FROM beta_workspaces WHERE owner = ? AND repo NOT LIKE 'cloud:%' ORDER BY created LIMIT 1").get(String(user.id)) as { repo: string } | null;
      const session = { userId: user.id, login: user.login, csrf: secret(), ...(existing ? { repo: existing.repo } : {}) };
      put('web-session', hash(token), session, now() + 30 * 24 * 60 * 60_000);
      let browserToken: string | undefined;
      if (existing) {
        const githubSession = randomUUID();
        put('github', githubSession, encrypt({ userId: user.id, login: user.login, accessToken: body.access_token, refreshToken: body.refresh_token ?? null, accessExpiresAt: body.expires_in ? now() + body.expires_in * 1000 : null, refreshExpiresAt: body.refresh_token_expires_in ? now() + body.refresh_token_expires_in * 1000 : null }), now() + 30 * 24 * 60 * 60_000);
        browserToken = secret();
        put('browser', hash(browserToken), {clientId:'joinlet-web',resource,scopes:['strukt'],repo:existing.repo,githubSession,csrf:session.csrf} satisfies BrowserGrant, now() + 30 * 24 * 60 * 60_000);
      }
      return { token, browserToken, ...session };
    },
    webSession(token: string) { return get<{ userId: number; login: string; csrf: string; repo?: string }>('web-session', hash(token)); },
    revokeWebSession(token: string) { drop('web-session', hash(token)); },
    async githubCallback(code: string, state: string): Promise<{ state: string; repos: string[]; client: string; redirectOrigin: string }> {
      const flow = get<Flow>('flow', hash(state));
      if (!flow || flow.github) throw new InvalidGrantError('Autorização expirada ou já utilizada.');
      const client = clientsStore.getClient(flow.clientId);
      if (!client) throw new InvalidGrantError('Cliente MCP não encontrado.');
      const body = await githubJson<{ access_token: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number }>(
        'https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ client_id: options.githubClientId, client_secret: options.githubClientSecret, code, redirect_uri: `${publicUrl}/github/callback` }),
        },
      );
      if (!body.access_token) throw new InvalidGrantError('GitHub não concedeu acesso.');
      const user = await githubJson<{ id: number; login: string }>('https://api.github.com/user', { headers: { authorization: `Bearer ${body.access_token}` } });
      const credentials: GithubCredentials = {
        accessToken: body.access_token, refreshToken: body.refresh_token ?? null,
        accessExpiresAt: body.expires_in ? now() + body.expires_in * 1000 : null,
        refreshExpiresAt: body.refresh_token_expires_in ? now() + body.refresh_token_expires_in * 1000 : null,
        userId: user.id, login: user.login,
      };
      const repos: string[] = [];
      for (let page = 1; page <= 10; page++) {
        const batch = await githubJson<{ full_name: string; permissions?: { push?: boolean } }[]>(
          `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated`,
          { headers: { authorization: `Bearer ${body.access_token}` } },
        );
        repos.push(...batch.filter((repo) => repo.permissions?.push).map((repo) => repo.full_name));
        if (batch.length < 100) break;
      }
      put('flow', hash(state), { ...flow, github: encrypt(credentials), repos } satisfies Flow, now() + 15 * 60_000);
      return { state, repos, client: client.client_name ?? 'Agente MCP', redirectOrigin: new URL(flow.redirectUri).origin };
    },
    githubForFlow(state: string, repo: string): { token: string; repo: string; userId: number } {
      const flow = get<Flow>('flow', hash(state));
      if (!flow?.github || !flow.repos?.includes(repo)) throw new InvalidGrantError('Repositório não autorizado ou sessão expirada.');
      const credentials = decrypt(flow.github);
      return { token: credentials.accessToken, repo, userId: credentials.userId };
    },
    selectRepo(state: string, repo: string): { redirect: string; browserToken: string } {
      const pending = get<Flow>('flow', hash(state));
      if (!pending?.github || !pending.repos?.includes(repo)) throw new InvalidGrantError('Repositório não autorizado ou sessão expirada.');
      const flow = take<Flow>('flow', hash(state));
      if (!flow?.github || !flow.repos?.includes(repo)) throw new InvalidGrantError('Repositório não autorizado ou sessão expirada.');
      const githubSession = randomUUID();
      put('github', githubSession, flow.github, now() + 30 * 24 * 60 * 60_000);
      const code = secret();
      put('code', hash(code), {
        clientId: flow.clientId, redirectUri: flow.redirectUri, codeChallenge: flow.codeChallenge,
        resource: flow.resource, scopes: flow.scopes, repo, githubSession,
      } satisfies Code, now() + 5 * 60_000);
      const browserToken = secret();
      put('browser', hash(browserToken), {
        clientId: flow.clientId, redirectUri: flow.redirectUri, resource: flow.resource,
        scopes: flow.scopes, repo, githubSession, csrf: secret(),
      }, now() + 30 * 24 * 60 * 60_000);
      const redirect = new URL(flow.redirectUri);
      redirect.searchParams.set('code', code);
      if (flow.state) redirect.searchParams.set('state', flow.state);
      redirect.searchParams.set('iss', `${publicUrl}/`);
      return { redirect: redirect.href, browserToken };
    },
    browserGrant(token: string): BrowserGrant | null { return get<BrowserGrant>('browser', hash(token)); },
    revokeBrowser(token: string): void {
      const grant = get<BrowserGrant>('browser', hash(token));
      if (!grant) return;
      revokedSessions.add(grant.githubSession);
      const rows = db.query("SELECT kind, id, value FROM records WHERE kind IN ('access', 'refresh', 'browser')").all() as { kind: string; id: string; value: string }[];
      for (const row of rows) {
        const value = JSON.parse(row.value) as { githubSession?: string };
        if (value.githubSession === grant.githubSession) drop(row.kind, row.id);
      }
      drop('github', grant.githubSession);
    },
    githubForGrant,
    async githubToken(accessToken: string): Promise<{ token: string; repo: string; userId: number }> {
      const grant = get<Grant>('access', hash(accessToken));
      if (!grant) throw new InvalidGrantError('Token MCP inválido.');
      return githubForGrant(grant);
    },
    healthy: () => { db.query('SELECT 1').get(); },
    close: () => db.close(),
  };
}

export type RemoteAuth = ReturnType<typeof createRemoteAuth>;
