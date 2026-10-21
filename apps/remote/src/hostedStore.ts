import { Database } from "bun:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  assertBetaManifest,
  checkCommentWrite,
  pinCommentIdentity,
  parseCommentsPath,
  MANIFEST_PATH,
  newWorkspace,
  workspaceFiles,
  type StorageAdapter,
} from "@strukt/workspace";
import { guestWriteRule } from "../../server/src/collaborationHttp";
import { privateValues } from "./secrets";
import type { RemoteAuth } from "./auth";

export type HostedRole = "edit" | "comment" | "view";
export interface HostedAccess {
  workspace: string;
  ownerId: number;
  userId?: number;
  member: string;
  csrf: string;
  role: HostedRole;
  owner: boolean;
  name: string;
  valid(): boolean;
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("base64url");
export class HostedError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
const validPath = (path: string) =>
  path.length < 500 &&
  !path.includes("..") &&
  !path.startsWith("/") &&
  !path.includes("\\") &&
  !/[\x00-\x1f]/.test(path) &&
  (!!guestWriteRule(path) ||
    /^context\/[A-Za-z0-9_./-]+\.(md|txt|json)$/.test(path));
const MAX_BYTES = 25 * 1024 * 1024;

export function createHostedStore(
  db: Database,
  auth: RemoteAuth,
  encryptionKey: string,
  now = Date.now,
) {
  db.exec(`CREATE TABLE IF NOT EXISTS hosted_workspaces(id TEXT PRIMARY KEY, owner INTEGER NOT NULL UNIQUE, created INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS hosted_files(workspace TEXT NOT NULL, path TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY(workspace,path));
    CREATE TABLE IF NOT EXISTS hosted_invites(id TEXT PRIMARY KEY, workspace TEXT NOT NULL, value TEXT NOT NULL, role TEXT NOT NULL, name TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER, revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS hosted_guests(id TEXT PRIMARY KEY, invite TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS hosted_settings(user INTEGER PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS hosted_audit(id INTEGER PRIMARY KEY AUTOINCREMENT, workspace TEXT NOT NULL, value TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS hosted_invites_workspace ON hosted_invites(workspace);`);
  const crypto = privateValues(encryptionKey);
  const audit = (
    workspace: string,
    type: string,
    extra: Record<string, unknown> = {},
  ) => {
    db.query("INSERT INTO hosted_audit(workspace,value) VALUES (?,?)").run(
      workspace,
      JSON.stringify({ t: new Date(now()).toISOString(), type, ...extra }),
    );
    db.query(
      "DELETE FROM hosted_audit WHERE workspace=? AND id NOT IN (SELECT id FROM hosted_audit WHERE workspace=? ORDER BY id DESC LIMIT 500)",
    ).run(workspace, workspace);
  };
  const owner = (workspace: string) => {
    const row = db
      .query("SELECT owner FROM hosted_workspaces WHERE id=?")
      .get(workspace) as { owner: number } | null;
    if (!row) throw new HostedError(404, "Workspace not found.");
    return row.owner;
  };
  const adapter = (workspace: string): StorageAdapter => {
    const ownerId = owner(workspace);
    const read = (path: string) => {
      if (!validPath(path))
        throw new HostedError(400, "Invalid workspace path.");
      return (
        (
          db
            .query("SELECT text FROM hosted_files WHERE workspace=? AND path=?")
            .get(workspace, path) as { text: string } | null
        )?.text ?? null
      );
    };
    return {
      kind: "folder",
      label: `Joinlet: ${workspace}`,
      read: async (path) => read(path),
      list: async () =>
        (
          db
            .query(
              "SELECT path FROM hosted_files WHERE workspace=? ORDER BY path",
            )
            .all(workspace) as { path: string }[]
        ).map((row) => row.path),
      write: async (path, text) => {
        if (!validPath(path) || Buffer.byteLength(text) > 1_000_000)
          throw new HostedError(413, "Workspace file is invalid or too large.");
        db.transaction(() => {
          const before = read(path);
          if (path === MANIFEST_PATH)
            assertBetaManifest(before, text, auth.beta.accountPlan(ownerId));
          const bytes = (
            db
              .query(
                "SELECT COALESCE(SUM(length(CAST(text AS BLOB))),0) AS bytes FROM hosted_files WHERE workspace=?",
              )
              .get(workspace) as { bytes: number }
          ).bytes;
          if (
            auth.beta.accountPlan(ownerId).id !== "administrator" &&
            bytes - Buffer.byteLength(before ?? "") + Buffer.byteLength(text) >
              MAX_BYTES
          )
            throw new HostedError(
              413,
              "Workspace storage limit reached (25 MB). Export or remove unused files.",
            );
          db.query(
            "INSERT OR REPLACE INTO hosted_files(workspace,path,text) VALUES (?,?,?)",
          ).run(workspace, path, text);
          db.query(
            "UPDATE hosted_workspaces SET revision=revision+1 WHERE id=?",
          ).run(workspace);
        }).immediate();
      },
      remove: async (path) => {
        if (!validPath(path) || path === MANIFEST_PATH)
          throw new HostedError(400, "Invalid workspace path.");
        db.transaction(() => {
          db.query("DELETE FROM hosted_files WHERE workspace=? AND path=?").run(
            workspace,
            path,
          );
          db.query(
            "UPDATE hosted_workspaces SET revision=revision+1 WHERE id=?",
          ).run(workspace);
        })();
      },
    };
  };
  const workspaceFor = db.transaction((userId: number) => {
    const row = db
      .query("SELECT id FROM hosted_workspaces WHERE owner=?")
      .get(userId) as { id: string } | null;
    if (row) return row.id;
    const id = `cloud:${randomUUID()}`;
    auth.beta.claim(userId, id);
    db.query(
      "INSERT INTO hosted_workspaces(id,owner,created) VALUES (?,?,?)",
    ).run(id, userId, now());
    for (const [path, text] of Object.entries(
      workspaceFiles(newWorkspace("My workspace")),
    ))
      db.query(
        "INSERT INTO hosted_files(workspace,path,text) VALUES (?,?,?)",
      ).run(id, path, text);
    return id;
  }).immediate;
  const inviteRow = (id: string) =>
    db.query("SELECT * FROM hosted_invites WHERE id=?").get(id) as {
      id: string;
      workspace: string;
      value: string;
      role: HostedRole;
      name: string;
      created: number;
      expires: number | null;
      revoked: number;
    } | null;
  const active = (invite: ReturnType<typeof inviteRow>) =>
    !!invite &&
    !invite.revoked &&
    (invite.expires === null || invite.expires > now());
  const online = new Map<
    string,
    { workspace: string; name: string; expires: number; valid: () => boolean }
  >();
  const api = {
    adapter,
    workspaceFor,
    owner,
    audit,
    touch(access: HostedAccess) {
      const presence = auth.beta.presence(access.workspace);
      presence.touch(`u:${access.ownerId}`);
      presence.touch(access.member);
      online.set(access.member, {
        workspace: access.workspace,
        name: access.name,
        expires: now() + 45_000,
        valid: access.valid,
      });
    },
    people(workspace: string) {
      for (const [id, person] of online)
        if (person.expires < now() || !person.valid()) online.delete(id);
      return [...online.values()]
        .filter((p) => p.workspace === workspace)
        .map((p) => ({ name: p.name, color: "#558d32" }));
    },
    access(user: {
      userId: number;
      csrf: string;
      login?: string;
    }): HostedAccess {
      const workspace = workspaceFor(user.userId);
      return {
        workspace,
        ownerId: user.userId,
        userId: user.userId,
        csrf: user.csrf,
        role: "edit",
        owner: true,
        name: user.login ?? "Owner",
        member: `u:${user.userId}`,
        valid: () => true,
      };
    },
    revision(workspace: string) {
      return (
        db
          .query("SELECT revision FROM hosted_workspaces WHERE id=?")
          .get(workspace) as { revision: number }
      ).revision;
    },
    invites(workspace: string, origin: string) {
      return (
        db
          .query(
            "SELECT id FROM hosted_invites WHERE workspace=? ORDER BY created",
          )
          .all(workspace) as { id: string }[]
      )
        .map((row) => inviteRow(row.id)!)
        .filter(active)
        .map((row) => {
          const secret = crypto.open(row.value, `invite:${row.id}`),
            url = `${origin}/join/${secret}`;
          return {
            id: row.id,
            name: row.name,
            role: row.role,
            createdAt: row.created,
            expiresAt: row.expires,
            url,
            publicUrl: url,
          };
        });
    },
    createInvite(
      access: HostedAccess,
      input: { name?: unknown; role?: unknown; ttl?: unknown },
    ) {
      if (!access.owner)
        throw new HostedError(403, "Only the workspace owner can share.");
      if (
        !["edit", "comment", "view"].includes(String(input.role)) ||
        !["1h", "24h", "7d", "never"].includes(String(input.ttl)) ||
        typeof input.name !== "string" ||
        !input.name.trim() ||
        input.name.length > 100
      )
        throw new HostedError(400, "Invalid invitation.");
      const used = (
        db
          .query(
            "SELECT COUNT(*) AS n FROM hosted_invites WHERE workspace=? AND revoked=0 AND (expires IS NULL OR expires>?)",
          )
          .get(access.workspace, now()) as { n: number }
      ).n;
      if (used >= 20)
        throw new HostedError(429, "Revoke unused links before creating more.");
      const value = token(),
        id = hash(value),
        duration = {
          "1h": 3600_000,
          "24h": 86400_000,
          "7d": 604800_000,
          never: null,
        }[input.ttl as "1h" | "24h" | "7d" | "never"];
      db.query(
        "INSERT INTO hosted_invites(id,workspace,value,role,name,created,expires) VALUES (?,?,?,?,?,?,?)",
      ).run(
        id,
        access.workspace,
        crypto.seal(value, `invite:${id}`),
        String(input.role),
        input.name.trim(),
        now(),
        duration === null ? null : now() + duration,
      );
      audit(access.workspace, "invite_created", {
        invite: input.name,
        inviteId: id,
        role: input.role,
      });
    },
    revoke(access: HostedAccess, id?: unknown) {
      if (!access.owner)
        throw new HostedError(
          403,
          "Only the workspace owner can revoke links.",
        );
      const guests = db
        .query(
          `SELECT g.id FROM hosted_guests g JOIN hosted_invites i ON g.invite=i.id WHERE i.workspace=?${typeof id === "string" ? " AND i.id=?" : ""}`,
        )
        .all(
          ...(typeof id === "string"
            ? [access.workspace, id]
            : [access.workspace]),
        ) as { id: string }[];
      for (const guest of guests)
        auth.beta.presence(access.workspace).leave(`g:${guest.id}`);
      db.query(
        `UPDATE hosted_invites SET revoked=1 WHERE workspace=?${typeof id === "string" ? " AND id=?" : ""}`,
      ).run(
        ...(typeof id === "string"
          ? [access.workspace, id]
          : [access.workspace]),
      );
      audit(
        access.workspace,
        "invite_revoked",
        typeof id === "string" ? { inviteId: id } : {},
      );
    },
    join(value: string, current?: string) {
      const invite = inviteRow(hash(value));
      if (!active(invite))
        throw new HostedError(
          401,
          "This invitation has expired or was revoked. Ask for a new link.",
          "invite_ended",
        );
      if (current) {
        const held = db
          .query("SELECT invite,expires FROM hosted_guests WHERE id=?")
          .get(hash(current)) as { invite: string; expires: number } | null;
        if (held && held.invite === invite!.id && held.expires > now())
          return current;
      }
      const cookie = token(),
        id = hash(cookie),
        csrf = token();
      const presence = auth.beta.presence(invite!.workspace);
      presence.touch(`u:${owner(invite!.workspace)}`);
      presence.touch(`g:${id}`);
      db.query(
        "INSERT INTO hosted_guests(id,invite,csrf,expires) VALUES (?,?,?,?)",
      ).run(id, invite!.id, csrf, now() + 86400_000);
      audit(invite!.workspace, "guest_joined", {
        inviteId: invite!.id,
        role: invite!.role,
      });
      return cookie;
    },
    guest(cookie: string): HostedAccess | null {
      const id = hash(cookie),
        row = db
          .query("SELECT invite,csrf,expires FROM hosted_guests WHERE id=?")
          .get(id) as { invite: string; csrf: string; expires: number } | null;
      if (!row || row.expires <= now()) return null;
      const invite = inviteRow(row.invite);
      if (!active(invite)) return null;
      return {
        workspace: invite!.workspace,
        ownerId: owner(invite!.workspace),
        csrf: row.csrf,
        member: `g:${id}`,
        owner: false,
        name: "Guest",
        role: invite!.role,
        valid: () => !!api.guest(cookie),
      };
    },
    leave(cookie: string) {
      const guest = api.guest(cookie);
      if (guest) auth.beta.presence(guest.workspace).leave(guest.member);
      db.query("DELETE FROM hosted_guests WHERE id=?").run(hash(cookie));
    },
    async write(
      access: HostedAccess,
      path: string,
      text: string | null,
      expected: unknown,
    ) {
      if (!access.valid())
        throw new HostedError(
          401,
          "This invitation has expired or was revoked.",
          "invite_ended",
        );
      const storage = adapter(access.workspace),
        rule = guestWriteRule(path);
      if (!rule)
        throw new HostedError(
          403,
          "This file cannot be changed through sharing.",
        );
      if (
        access.role === "view" ||
        (access.role === "comment" && !parseCommentsPath(path))
      )
        throw new HostedError(
          403,
          "This link does not allow editing this file.",
        );
      const current = await storage.read(path);
      if (
        expected !== undefined &&
        expected !== null &&
        typeof expected !== "string"
      )
        throw new HostedError(400, "Invalid expected revision.");
      if (!path.startsWith("context/") && expected === undefined)
        throw new HostedError(428, "Read the file before editing it.");
      if (expected !== undefined && current !== expected)
        throw new HostedError(409, "This file changed. Reload before saving.");
      if (text === null) {
        if (
          (
            db
              .query(
                "SELECT text FROM hosted_files WHERE workspace=? AND path=?",
              )
              .get(access.workspace, path) as { text: string } | null
          )?.text !== (current ?? undefined)
        )
          throw new HostedError(
            409,
            "This file changed. Reload before saving.",
          );
        if (!rule.removable)
          throw new HostedError(403, "This file cannot be removed.");
        await storage.remove(path);
      } else {
        const reason = await rule.check(text, storage);
        if (reason) throw new HostedError(400, reason);
        if (parseCommentsPath(path)) {
          const kind = parseCommentsPath(path)!.kind;
          const pinned = pinCommentIdentity(
            current,
            text,
            kind,
            access.member,
            access.owner ? "Workspace owner" : "Guest",
          );
          const failure =
            access.role === "comment"
              ? checkCommentWrite(current, pinned, kind, access.member)
              : null;
          if (failure) throw new HostedError(403, failure);
          text = pinned;
        }
        if (!access.valid())
          throw new HostedError(
            401,
            "This invitation has expired or was revoked.",
            "invite_ended",
          );
        const latest =
          (
            db
              .query(
                "SELECT text FROM hosted_files WHERE workspace=? AND path=?",
              )
              .get(access.workspace, path) as { text: string } | null
          )?.text ?? null;
        if (latest !== current)
          throw new HostedError(
            409,
            "This file changed. Reload before saving.",
          );
        await storage.write(path, text);
      }
      audit(access.workspace, "workspace_write", {
        op: text === null ? "remove" : "write",
        path,
      });
    },
    activity(workspace: string) {
      return (
        db
          .query(
            "SELECT value FROM hosted_audit WHERE workspace=? ORDER BY id DESC LIMIT 100",
          )
          .all(workspace) as { value: string }[]
      ).map((row) => JSON.parse(row.value));
    },
    settings(user: number) {
      const row = db
        .query("SELECT value FROM hosted_settings WHERE user=?")
        .get(user) as { value: string } | null;
      return row ? crypto.open(row.value, `settings:${user}`) : null;
    },
    saveSettings(user: number, text: string) {
      db.query(
        "INSERT OR REPLACE INTO hosted_settings(user,value) VALUES (?,?)",
      ).run(user, crypto.seal(text, `settings:${user}`));
    },
  };
  return api;
}
export type HostedStore = ReturnType<typeof createHostedStore>;
