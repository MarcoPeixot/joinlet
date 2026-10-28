import type { RequestHandler } from 'express';
import { isPasswordInput } from '@strukt/workspace/password-policy';
import { AccountError, authToken, normalizeEmail, tokenHash, validatePassword } from './accounts';
import type { RemoteAuth, RemoteAuthOptions } from './auth';
import { publicProfile, validateProfile } from './profile';

/** Password-only accounts deliberately do not claim verified ownership of an email address. */
export function createPasswordAuth(options: RemoteAuthOptions, auth: RemoteAuth, onRevoked: (guest?: string) => void): RequestHandler {
  const now = options.now ?? Date.now;
  const attempts = new Map<string, { at: number; n: number }>();
  let hashing = 0;
  const hashOptions = { algorithm: 'argon2id' as const, memoryCost: 65536, timeCost: 2 };
  let dummy: Promise<string> | undefined;
  const limited = (key: string, count: number, window: number) => {
    const time = now();
    for (const [id, value] of attempts) if (value.at <= time) attempts.delete(id);
    const row = attempts.get(key) ?? { at: time + window, n: 0 };
    row.n++;
    if (attempts.size >= 10_000 && !attempts.has(key)) throw new AccountError(429, 'try_later');
    attempts.set(key, row);
    if (row.n > count) throw new AccountError(429, 'try_later');
  };
  const work = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (hashing >= 2) throw new AccountError(429, 'try_later');
    hashing++;
    try { return await fn(); } finally { hashing--; }
  };
  const cookieOptions = { httpOnly: true, secure: auth.publicUrl.startsWith('https:'), sameSite: 'lax' as const, path: '/' };
  const cookie = (header: string | undefined, name: string) => header?.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1);
  return async (req, res, next) => {
    if (!req.path.startsWith('/api/auth/')) return next();
    res.set('Cache-Control', 'no-store');
    try {
      if (req.path === '/api/auth/config' && req.method === 'GET') return res.json({ password: true, github: !!options.githubClientId && !!options.githubClientSecret });
      const token = cookie(req.headers.cookie, 'joinlet_session');
      const session = token ? auth.webSession(token) : null;
      if (req.path === '/api/auth/me' && req.method === 'GET') {
        const account = session ? auth.accounts.get(session.userId) : null;
        if (!session || !account) throw new AccountError(401, 'sign_in_again');
        return res.json({ ...publicProfile(account), password: !!account.password_hash, csrf: session.csrf });
      }
      if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
      if (req.header('origin') !== auth.publicUrl || req.header('sec-fetch-site') === 'cross-site') throw new AccountError(403, 'invalid_origin');
      if (!req.is('application/json')) throw new AccountError(415, 'send_json');
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Buffer.byteLength(JSON.stringify(req.body)) > (req.path === '/api/auth/profile' ? 104_000 : 4096)) throw new AccountError(400, 'invalid_request');
      limited('ip:' + (req.ip ?? 'unknown'), 30, 60_000);
      if (req.path === '/api/auth/profile') {
        if (!session || req.header('x-strukt-csrf') !== session.csrf) throw new AccountError(401, 'sign_in_again');
        limited('profile:' + session.userId, 15, 60_000);
        const profile = validateProfile(req.body);
        auth.accounts.profile(session.userId, profile.name, profile.avatar);
        return res.json(publicProfile(auth.accounts.get(session.userId)!));
      }
      if (['/api/auth/logout', '/api/auth/change-password'].includes(req.path)) {
        if (!session || req.header('x-strukt-csrf') !== session.csrf) throw new AccountError(401, 'sign_in_again');
        if (req.path === '/api/auth/change-password') {
          const account = auth.accounts.get(session.userId);
          if (!account?.password_hash) throw new AccountError(401, 'invalid_credentials');
          validatePassword(req.body.password);
          if (!isPasswordInput(req.body.currentPassword)) throw new AccountError(401, 'invalid_credentials');
          limited('account:' + account.id, 10, 15 * 60_000);
          const nextHash = await work(async () => {
            if (!await Bun.password.verify(req.body.currentPassword, account.password_hash!)) throw new AccountError(401, 'invalid_credentials');
            return Bun.password.hash(req.body.password, hashOptions);
          });
          auth.accounts.replacePassword(account.id, account.session_version, nextHash);
        }
        auth.revokeWebSession(token!);
        const browser = cookie(req.headers.cookie, 'strukt_session');
        if (browser) auth.revokeBrowser(browser);
        res.clearCookie('joinlet_session', { path: '/' });
        res.clearCookie('strukt_session', { path: '/' });
        res.clearCookie('joinlet_guest', { path: '/' });
        onRevoked(cookie(req.headers.cookie, 'joinlet_guest'));
        return res.json({ ok: true });
      }
      if (req.path !== '/api/auth/register' && req.path !== '/api/auth/login') return res.status(404).json({ error: 'not_found' });
      const email = normalizeEmail(req.body.email);
      if (req.path === '/api/auth/register') validatePassword(req.body.password);
      else if (!isPasswordInput(req.body.password)) throw new AccountError(401, 'invalid_credentials');
      limited('email:' + tokenHash(email), 10, 15 * 60_000);
      if (req.path === '/api/auth/register') {
        const hash = await work(() => Bun.password.hash(req.body.password, hashOptions));
        auth.accounts.register(email, hash);
        // Registration never replaces an existing password or reveals whether an address was registered.
        return res.json({ ok: true });
      }
      const account = auth.accounts.byEmail(email);
      const version = account?.session_version;
      const valid = await work(async () => {
        const hash = account?.password_hash ?? await (dummy ??= Bun.password.hash(authToken(), hashOptions));
        return Bun.password.verify(req.body.password, hash);
      });
      if (!valid || !account?.password_hash || auth.accounts.get(account.id)?.session_version !== version) throw new AccountError(401, 'invalid_credentials');
      const issued = auth.createWebSession(account.id);
      if (token) auth.revokeWebSession(token);
      const browser = cookie(req.headers.cookie, 'strukt_session');
      if (browser) auth.revokeBrowser(browser);
      res.clearCookie('strukt_session', { path: '/' });
      res.clearCookie('joinlet_guest', { path: '/' });
      onRevoked(cookie(req.headers.cookie, 'joinlet_guest'));
      res.cookie('joinlet_session', issued.token, { ...cookieOptions, maxAge: 30 * 24 * 60 * 60_000 });
      return res.json({ ok: true });
    } catch (error) {
      if (error instanceof AccountError) {
        if (error.status === 429) res.set('Retry-After', '60');
        return res.status(error.status).json({ error: error.code });
      }
      return res.status(500).json({ error: 'auth_unavailable' });
    }
  };
}
