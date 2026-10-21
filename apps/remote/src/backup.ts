import { Database } from 'bun:sqlite';
import { chmod, link, mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/** SQLite produces a consistent snapshot, including committed WAL data, without copying a live database file. */
export async function backupDatabase(source: string, destination: string): Promise<void> {
  if (resolve(source) === resolve(destination)) throw new Error('Backup must have a different destination.');
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(dirname(destination), '.joinlet-backup-'));
  const snapshot = join(temporary, 'snapshot.sqlite');
  try {
    const db = new Database(source, { readonly: true });
    try { db.query('VACUUM INTO ?').run(snapshot); } finally { db.close(); }
    const copy = new Database(snapshot, { readonly: true });
    try {
      const rows = copy.query('PRAGMA quick_check').all() as { quick_check: string }[];
      if (rows.length !== 1 || rows[0]?.quick_check !== 'ok') throw new Error('SQLite backup failed its integrity check.');
    } finally { copy.close(); }
    await chmod(snapshot, 0o600);
    const complete = await open(snapshot, 'r+');
    try { await complete.sync(); } finally { await complete.close(); }
    // Publish atomically without overwriting an existing backup. Same filesystem as destination.
    await link(snapshot, destination);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  const [source, destination] = args;
  if (!source || !destination) throw new Error('Usage: bun apps/remote/src/backup.ts <database.sqlite> <new-backup.sqlite>');
  await backupDatabase(source, destination);
  console.log('Joinlet SQLite backup verified. Keep the encryption key separately for restore.');
}
