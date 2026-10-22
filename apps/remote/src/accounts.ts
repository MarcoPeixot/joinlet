import type { Database } from 'bun:sqlite';
import { createHash, randomBytes } from 'node:crypto';

export interface Account {
  id: number;
  name: string;
  github_id: number | null;
  github_login: string | null;
  email: string | null;
  verified: number;
  password_hash: string | null;
  session_version: number;
}
export class AccountError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const authToken = () => randomBytes(32).toString('base64url');
export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string' || value.length > 254 || /[\x00-\x1f\x7f-\x9f]/.test(value) || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim())) throw new AccountError(400, 'invalid_email');
  return value.trim().toLowerCase();
}
export function validatePassword(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 256 || [...value].length < 15 || [...value].length > 128) throw new AccountError(400, 'invalid_password');
}

/** Internal IDs are independent of provider subjects. Legacy IDs are reserved once, never guessed at login. */
export function createAccounts(db: Database) {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS account_migrations(version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS accounts(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        github_id INTEGER UNIQUE, github_login TEXT, email TEXT UNIQUE COLLATE NOCASE,
        verified INTEGER NOT NULL DEFAULT 0, password_hash TEXT, session_version INTEGER NOT NULL DEFAULT 0);`);
    if (db.query('SELECT 1 FROM account_migrations WHERE version=1').get()) return;
    const ids = new Set<number>();
    for (const [table, field] of [['beta_workspaces', 'owner'], ['hosted_workspaces', 'owner'], ['hosted_settings', 'user']] as const) {
      if (!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
      for (const row of db.query(`SELECT DISTINCT ${field} AS id FROM ${table}`).all() as { id: unknown }[]) {
        const id = Number(row.id);
        if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Cannot migrate an invalid legacy account identity.');
        ids.add(id);
      }
    }
    for (const row of db.query("SELECT value FROM records WHERE kind='web-session'").all() as { value: string }[]) {
      const id = JSON.parse(row.value).userId;
      if (Number.isSafeInteger(id) && id > 0) ids.add(id);
    }
    for (const id of ids) db.query('INSERT INTO accounts(id,name,github_id) VALUES (?,?,?)').run(id, 'Owner', id);
    db.query('INSERT INTO account_migrations(version) VALUES (1)').run();
  }).immediate();
  const get = (id: number) => db.query('SELECT * FROM accounts WHERE id=?').get(id) as Account | null;
  const byEmail = (email: string) => db.query('SELECT * FROM accounts WHERE email=? COLLATE NOCASE').get(email) as Account | null;
  const github = db.transaction((subject: number, login: string) => {
    if (!Number.isSafeInteger(subject) || subject <= 0) throw new AccountError(400, 'invalid_identity');
    const existing = db.query('SELECT * FROM accounts WHERE github_id=?').get(subject) as Account | null;
    if (existing) {
      db.query('UPDATE accounts SET github_login=?,name=CASE WHEN github_login IS NULL THEN ? ELSE name END WHERE id=?').run(login, login, existing.id);
      return get(existing.id)!;
    }
    const row = db.query('INSERT INTO accounts(name,github_id,github_login) VALUES (?,?,?) RETURNING *').get(login, subject, login) as Account;
    return row;
  }).immediate;
  return {
    get, byEmail, github,
    register(email: string, passwordHash: string) {
      return db.query('INSERT INTO accounts(name,email,password_hash) VALUES (?,?,?) ON CONFLICT(email) DO NOTHING RETURNING *')
        .get(email.split('@')[0]!, email, passwordHash) as Account | null;
    },
    replacePassword(id: number, expectedVersion: number, passwordHash: string) {
      const result = db.query('UPDATE accounts SET password_hash=?,session_version=session_version+1 WHERE id=? AND session_version=? AND password_hash IS NOT NULL').run(passwordHash, id, expectedVersion);
      if (!result.changes) throw new AccountError(401, 'sign_in_again');
    },
    clearSessions() { db.query('UPDATE accounts SET session_version=session_version+1').run(); },
  };
}
