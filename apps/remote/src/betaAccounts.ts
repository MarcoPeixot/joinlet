import type { Database } from 'bun:sqlite';
import { ADMIN_PLAN, BETA_PLAN, assertBetaGrowth, createBetaPresence } from '@strukt/workspace';

/** Ownership survives OAuth session expiry, sign-out and process restarts. GitHub IDs never come from request bodies. */
export function createBetaAccounts(db: Database, now = Date.now, adminIds: ReadonlySet<number> = new Set()) {
  db.exec(`CREATE TABLE IF NOT EXISTS beta_workspaces (
    repo TEXT PRIMARY KEY COLLATE NOCASE, owner TEXT NOT NULL, created INTEGER NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS beta_workspaces_owner ON beta_workspaces(owner)');
  const usage = (userId: number) => (db.query('SELECT COUNT(*) AS count FROM beta_workspaces WHERE owner = ?').get(String(userId)) as { count: number }).count;
  const accountPlan = (userId: number) => adminIds.has(userId) ? ADMIN_PLAN : BETA_PLAN;
  const workspacePlan = (repo: string) => {
    const owner = db.query('SELECT owner FROM beta_workspaces WHERE repo = ?').get(repo) as { owner: string } | null;
    return owner ? accountPlan(Number(owner.owner)) : BETA_PLAN;
  };
  const rooms = new Map<string, ReturnType<typeof createBetaPresence>>();
  const presence = (repo: string) => {
    const key = repo.toLowerCase();
    let room = rooms.get(key);
    if (!room) { room = createBetaPresence({ now, plan: () => workspacePlan(repo) }); rooms.set(key, room); }
    return room;
  };
  return {
    /** Call only AFTER GitHub verified write access. Existing workspace members don't consume an ownership slot. */
    claim: db.transaction((userId: number, repo: string) => {
      if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('Invalid account identity.');
      const existing = db.query('SELECT owner FROM beta_workspaces WHERE repo = ?').get(repo) as { owner: string } | null;
      if (existing) return { owner: existing.owner === String(userId) };
      const used = usage(userId);
      assertBetaGrowth('workspaces', used, used + 1, accountPlan(userId));
      db.query('INSERT INTO beta_workspaces (repo, owner, created) VALUES (?, ?, ?)').run(repo.toLowerCase(), String(userId), now());
      return { owner: true };
    }).immediate,
    status(userId: number, repo: string) {
      const record = db.query('SELECT owner FROM beta_workspaces WHERE repo = ?').get(repo) as { owner: string } | null;
      return { plan: workspacePlan(repo), accountPlan: accountPlan(userId), scope: 'account' as const, ownedWorkspaces: usage(userId), workspaceOwner: record?.owner === String(userId), participants: presence(repo).used() };
    },
    presence, accountPlan, workspacePlan,
  };
}
