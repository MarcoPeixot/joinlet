import type { Database } from 'bun:sqlite';
import * as Y from 'yjs';
import type { CollaborationPersistence, PersistedCollaborationRoom } from './collaborationStore';

type Stored = { snapshot: Uint8Array; baseline: string };

/**
 * Append-only updates keep a keystroke cheap; every 128 are merged into the snapshot to bound the row count. A merge
 * keeps what later edits overwrote, so the size is bounded by the store, which `replace`s the room with its live
 * (garbage-collected) state when the stored bytes grow past 4× that state, and on release.
 */
export function createSqliteCollaborationPersistence(db: Database): CollaborationPersistence {
  db.exec('CREATE TABLE IF NOT EXISTS collaboration_rooms (name TEXT PRIMARY KEY, snapshot BLOB NOT NULL, baseline TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS collaboration_updates (id INTEGER PRIMARY KEY, name TEXT NOT NULL, update_data BLOB NOT NULL)');
  db.exec('CREATE INDEX IF NOT EXISTS collaboration_updates_room ON collaboration_updates (name, id)');

  const snapshot = db.query('SELECT snapshot, baseline FROM collaboration_rooms WHERE name = ?');
  const updates = db.query('SELECT update_data FROM collaboration_updates WHERE name = ? ORDER BY id');
  const insertUpdate = db.query('INSERT INTO collaboration_updates (name, update_data) VALUES (?, ?)');
  const upsert = db.query('INSERT INTO collaboration_rooms (name, snapshot, baseline) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET snapshot = excluded.snapshot, baseline = excluded.baseline');
  const setBaseline = db.query('UPDATE collaboration_rooms SET baseline = ? WHERE name = ?');
  const count = db.query('SELECT COUNT(*) AS count FROM collaboration_updates WHERE name = ?');
  const removeUpdates = db.query('DELETE FROM collaboration_updates WHERE name = ?');
  const removeRoom = db.query('DELETE FROM collaboration_rooms WHERE name = ?');

  return {
    async load(room): Promise<PersistedCollaborationRoom | null> {
      const row = snapshot.get(room) as Stored | null;
      if (!row) return null;
      const tail = updates.all(room) as { update_data: Uint8Array }[];
      return { updates: [row.snapshot, ...tail.map((item) => item.update_data)], baseline: JSON.parse(row.baseline) as Record<string, string | null> };
    },
    async append(room, update) {
      db.transaction(() => {
        insertUpdate.run(room, update);
        const n = (count.get(room) as { count: number }).count;
        if (n < 128) return;
        const row = snapshot.get(room) as Stored;
        const tail = updates.all(room) as { update_data: Uint8Array }[];
        upsert.run(room, Y.mergeUpdates([row.snapshot, ...tail.map((item) => item.update_data)]), row.baseline);
        removeUpdates.run(room);
      })();
    },
    async replace(room, state, baseline) {
      db.transaction(() => {
        upsert.run(room, state, JSON.stringify(baseline));
        removeUpdates.run(room);
      })();
    },
    async baseline(room, files) { setBaseline.run(JSON.stringify(files), room); },
    async drop(room) {
      db.transaction(() => {
        removeRoom.run(room);
        removeUpdates.run(room);
      })();
    },
  };
}
