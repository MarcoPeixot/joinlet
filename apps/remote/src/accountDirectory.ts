import type { RequestHandler } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { tokenHash } from './accounts';
import type { RemoteAuth } from './auth';

/** Minimal, read-only operator projection. The proxy must block this path on public ingress. */
export function accountDirectory(auth: RemoteAuth, token?: string): RequestHandler {
  return (req, res, next) => {
    if (!req.path.startsWith('/api/internal/')) return next();
    res.set('Cache-Control', 'no-store');
    if (!token) return res.sendStatus(404);
    const supplied = req.header('authorization') ?? '';
    if (!timingSafeEqual(Buffer.from(tokenHash(supplied)), Buffer.from(tokenHash('Bearer ' + token)))) return res.sendStatus(401);
    if (req.path !== '/api/internal/accounts' || req.method !== 'GET') return res.sendStatus(404);
    const query = req.query.q ?? '', rawPage = req.query.page ?? '1';
    if (typeof query !== 'string' || query.length > 120 || typeof rawPage !== 'string' || !/^[1-9]\d{0,6}$/.test(rawPage)) return res.status(400).json({ error: 'invalid_filter' });
    const page = Number(rawPage), pageSize = 25, search = query.trim();
    const where = "(?='' OR instr(lower(a.name),lower(?))>0 OR instr(lower(coalesce(a.email,'')),lower(?))>0 OR instr(lower(coalesce(a.github_login,'')),lower(?))>0 OR CAST(a.id AS TEXT)=?)";
    const params = [search, search, search, search, search];
    const count = auth.database.query(`SELECT COUNT(*) AS total FROM accounts a WHERE ${where}`).get(...params) as { total: number };
    // Never SELECT *: passwords, session material, personal AI settings and project content are excluded.
    const items = auth.database.query(`SELECT a.id,a.name,a.email,a.avatar,a.created_at AS createdAt,a.last_login_at AS lastLoginAt,
      a.verified AS emailVerified,a.github_login AS githubLogin,(a.password_hash IS NOT NULL) AS password,
      (SELECT COUNT(*) FROM hosted_workspaces w WHERE w.owner=a.id) AS workspaces
      FROM accounts a WHERE ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
    return res.json({ items, total: count.total, page, pageSize });
  };
}
