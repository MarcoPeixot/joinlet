import { Database } from 'bun:sqlite';

/** Run on an isolated restored snapshot before exposing it: old access must not revive after restore. */
export function invalidateRestoredAccess(db: Database): void {
  db.transaction(() => {
    db.query("DELETE FROM records WHERE kind <> 'client'").run();
    const exists = (name: string) => !!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
    if (exists('accounts')) db.query('UPDATE accounts SET session_version=session_version+1').run();
    if (exists('hosted_guests')) db.query('DELETE FROM hosted_guests').run();
    if (exists('hosted_invites')) db.query('UPDATE hosted_invites SET revoked=1').run();
  }).immediate();
}
if (import.meta.main) {
  const [path, flag] = process.argv.slice(2);
  if (!path || flag !== '--invalidate-access' || process.argv.length !== 4) throw new Error('Usage: bun apps/remote/src/recovery.ts <restored.sqlite> --invalidate-access');
  const db = new Database(path, { create: false });
  try { invalidateRestoredAccess(db); } finally { db.close(); }
  console.log('Restored Joinlet sessions, authorizations and invitations invalidated. Workspace data preserved.');
}
