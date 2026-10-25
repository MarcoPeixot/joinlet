import type { Database } from 'bun:sqlite';
import type { RepositoryStatus } from '@strukt/workspace/repository-contracts';

export interface RepositoryConnection { id: string; owner: number; workspace: string; kind: 'local' | 'github'; data: string; status: string; updated: number; version: number }
export function repositoryQueue(db: Database, now = Date.now) {
  db.exec(`CREATE TABLE IF NOT EXISTS repository_connections(id TEXT PRIMARY KEY, owner INTEGER NOT NULL, workspace TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL, updated INTEGER NOT NULL, version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS repository_jobs(id TEXT PRIMARY KEY, connection TEXT NOT NULL, phase TEXT NOT NULL, lease INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS repository_jobs_connection ON repository_jobs(connection,phase);
    CREATE TABLE IF NOT EXISTS repository_pairing(code TEXT PRIMARY KEY, owner INTEGER NOT NULL, workspace TEXT NOT NULL, expires INTEGER NOT NULL, version INTEGER NOT NULL, locale TEXT NOT NULL DEFAULT 'en');
    CREATE TABLE IF NOT EXISTS repository_commands(id TEXT PRIMARY KEY, connection TEXT NOT NULL, data TEXT NOT NULL, created INTEGER NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0);`);
  const hasLocale = () => (db.query('PRAGMA table_info(repository_pairing)').all() as {name:string}[]).some(column => column.name === 'locale');
  if (!hasLocale()) {
    try { db.exec("ALTER TABLE repository_pairing ADD COLUMN locale TEXT NOT NULL DEFAULT 'en'"); }
    catch (error) { if (!hasLocale()) throw error; } // Another process may have migrated the same database.
  }
  const get = (id: string) => db.query('SELECT * FROM repository_connections WHERE id=?').get(id) as RepositoryConnection | null;
  const enqueue = db.transaction((id: string) => {
    if (!get(id)) throw Error('Repository connection not found.');
    const pending = db.query("SELECT id FROM repository_jobs WHERE connection=? AND phase='queued'").get(id) as { id: string } | null;
    if (pending) return pending.id;
    const connection=get(id)!;db.query('UPDATE repository_connections SET status=? WHERE id=?').run(JSON.stringify({...JSON.parse(connection.status),phase:'queued'}),id);
    const job = crypto.randomUUID(); db.query("INSERT INTO repository_jobs(id,connection,phase,created) VALUES (?,?,'queued',?)").run(job,id,now()); return job;
  });
  return {
    get,
    list: () => db.query('SELECT * FROM repository_connections ORDER BY updated').all() as RepositoryConnection[],
    forWorkspace: (workspace: string) => db.query('SELECT * FROM repository_connections WHERE workspace=?').get(workspace) as RepositoryConnection | null,
    put(c: RepositoryConnection) { db.query('INSERT INTO repository_connections(id,owner,workspace,kind,data,status,updated,version) VALUES (?,?,?,?,?,?,?,?)').run(c.id,c.owner,c.workspace,c.kind,c.data,c.status,c.updated,c.version); },
    update(id: string, status: Partial<RepositoryStatus>) { const c=get(id); if (c) db.query('UPDATE repository_connections SET status=?, updated=? WHERE id=?').run(JSON.stringify({...JSON.parse(c.status),...status}),now(),id); },
    enqueue,
    pending: (id:string) => (db.query("SELECT COUNT(*) AS n FROM repository_jobs WHERE connection=? AND phase IN ('queued','running')").get(id) as {n:number}).n,
    claim: db.transaction(() => {
      db.query("UPDATE repository_jobs SET phase='queued',lease=0 WHERE phase='running' AND lease<?").run(now());
      const job=db.query("SELECT j.id,j.connection FROM repository_jobs j JOIN repository_connections c ON c.id=j.connection WHERE c.kind='github' AND j.phase='queued' AND NOT EXISTS (SELECT 1 FROM repository_jobs r WHERE r.connection=j.connection AND r.phase='running') ORDER BY j.created LIMIT 1").get() as {id:string;connection:string}|null;
      if (!job) return null;
      db.query("UPDATE repository_jobs SET phase='running',lease=?,attempts=attempts+1 WHERE id=?").run(now()+300_000,job.id); return job;
    }),
    renew(id: string) { db.query("UPDATE repository_jobs SET lease=? WHERE id=? AND phase='running'").run(now()+300_000,id); },
    finish(id: string, phase: string) { db.query('UPDATE repository_jobs SET phase=?,lease=0 WHERE id=?').run(phase,id); },
    command(id: string, data: unknown) { const key=crypto.randomUUID(); db.query('INSERT INTO repository_commands(id,connection,data,created) VALUES (?,?,?,?)').run(key,id,JSON.stringify(data),now()); return key; },
    commands: (id: string) => db.query('SELECT id,data FROM repository_commands WHERE connection=? AND acknowledged=0 ORDER BY created,rowid LIMIT 100').all(id) as {id:string;data:string}[],
    ack(id: string, command: string) { db.query('DELETE FROM repository_commands WHERE connection=? AND id=?').run(id,command); },
    remove: db.transaction((id: string) => { db.query('DELETE FROM repository_jobs WHERE connection=?').run(id);db.query('DELETE FROM repository_commands WHERE connection=?').run(id); db.query('DELETE FROM repository_connections WHERE id=?').run(id); }),
  };
}
