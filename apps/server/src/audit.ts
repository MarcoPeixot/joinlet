import { createHash, randomBytes } from 'node:crypto';
import { appendFile, chmod, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

export type AuditType =
  | 'share.start' | 'share.stop' | 'invite.create' | 'invite.revoke' | 'invite.expire'
  | 'join' | 'write' | 'denied' | 'tunnel.start' | 'tunnel.stop';
const TYPES: ReadonlySet<string> = new Set<AuditType>(['share.start', 'share.stop', 'invite.create', 'invite.revoke', 'invite.expire', 'join', 'write', 'denied', 'tunnel.start', 'tunnel.stop']);

export type AuditReason = 'invalid_token' | 'ended_invite' | 'read_only' | 'path_not_allowed' | 'rate_limited' | 'bad_origin' | 'expired' | 'manual' | 'exited' | 'share_stopped' | 'comment_rule';
const REASONS: ReadonlySet<string> = new Set<AuditReason>(['invalid_token', 'ended_invite', 'read_only', 'path_not_allowed', 'rate_limited', 'bad_origin', 'expired', 'manual', 'exited', 'share_stopped', 'comment_rule']);

/**
 * What an event may say. Nothing here can hold a file's content, a token or free text: names are trimmed and stripped of
 * control characters, paths must look like workspace paths, the rest are fixed words or numbers.
 */
export interface AuditEvent {
  type: AuditType;
  /** The invite's name. */
  invite?: string;
  inviteId?: string;
  role?: string;
  /** `hashIp` of the address. */
  ip?: string;
  /** A workspace file path (never its content). */
  path?: string;
  op?: 'write' | 'remove';
  reason?: AuditReason;
  provider?: string;
  expiresAt?: number | null;
}
export interface AuditEntry extends AuditEvent { t: string }

const ROLES = new Set(['edit', 'comment', 'view']);
const OPS = new Set(['write', 'remove']);
const PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const SIMPLE = /^[A-Za-z0-9._:-]{1,64}$/;

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return cleaned || undefined;
};

/** Builds the stored form of an event; null for an unknown type. */
function clean(event: AuditEvent, at: string): AuditEntry | null {
  if (!event || typeof event !== 'object' || !TYPES.has(event.type)) return null;
  const entry: Record<string, unknown> = { t: at, type: event.type };
  const invite = text(event.invite, 60);
  if (invite) entry.invite = invite;
  if (typeof event.inviteId === 'string' && SIMPLE.test(event.inviteId)) entry.inviteId = event.inviteId;
  if (typeof event.role === 'string' && ROLES.has(event.role)) entry.role = event.role;
  if (typeof event.ip === 'string' && /^([0-9a-f]{8}|unknown)$/.test(event.ip)) entry.ip = event.ip;
  if (typeof event.path === 'string' && PATH.test(event.path) && !event.path.includes('..')) entry.path = event.path;
  if (typeof event.op === 'string' && OPS.has(event.op)) entry.op = event.op;
  if (typeof event.reason === 'string' && REASONS.has(event.reason)) entry.reason = event.reason;
  if (typeof event.provider === 'string' && SIMPLE.test(event.provider)) entry.provider = event.provider;
  if (typeof event.expiresAt === 'number' && Number.isFinite(event.expiresAt)) entry.expiresAt = event.expiresAt;
  return entry as unknown as AuditEntry;
}

const short = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 8);

/** `<folder name>-<8 hex of the absolute path>.jsonl`: readable, and two folders with one name never share a file. */
export function auditFileName(root: string): string {
  const absolute = resolve(root);
  const base = basename(absolute).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 40) || 'workspace';
  return `${base === '' ? 'workspace' : base}-${short(absolute)}.jsonl`;
}

export interface AuditOptions {
  /** `~/.config/strukt/audit` (0700). */
  dir: string;
  root: string;
  now?(): number;
  /** The file rotates past this many bytes (1 MB). */
  maxBytes?: number;
  /** Rotated files kept besides the current one. */
  keep?: number;
  warn?(message: string): void;
}

/**
 * Append-only JSONL of what happened in a share, for the owner: who joined, what path they wrote, what was refused.
 * Never content. Writes are serialized and never throw into the host; a failure is warned without the event.
 */
export function createAuditLog({ dir, root, now = Date.now, maxBytes = 1_000_000, keep = 3, warn = (message) => console.warn(message) }: AuditOptions) {
  const file = join(dir, auditFileName(root));
  const salt = randomBytes(16).toString('hex');
  let queue: Promise<void> = Promise.resolve();

  const rotate = async () => {
    const size = await stat(file).then((info) => info.size, () => 0);
    if (size < maxBytes) return;
    await rm(`${file}.${keep}`, { force: true });
    for (let index = keep - 1; index >= 1; index--) await rename(`${file}.${index}`, `${file}.${index + 1}`).catch(() => {});
    await rename(file, `${file}.1`);
  };

  const readEntries = async (path: string): Promise<AuditEntry[]> => {
    const raw = await readFile(path, 'utf8').catch(() => '');
    const entries: AuditEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as { t?: unknown };
        const entry = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.t === 'string' ? clean(parsed as unknown as AuditEvent, parsed.t) : null;
        if (entry) entries.push(entry);
      } catch { /* a damaged line is skipped */ }
    }
    return entries;
  };

  return {
    /** A short salted hash of an address: enough to tell guests apart in one session, useless to recover the address. */
    hashIp: (ip: string | undefined): string => (ip ? short(`${salt}:${ip}`) : 'unknown'),
    record(event: AuditEvent): void {
      const entry = clean(event, new Date(now()).toISOString());
      if (!entry) return;
      queue = queue.then(async () => {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await chmod(dir, 0o700);
        await rotate();
        await appendFile(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
        await chmod(file, 0o600);
      }).catch((error: unknown) => warn(`Auditoria: não foi possível gravar um evento (${error instanceof Error ? error.message.split('\n')[0] : 'erro'}).`));
    },
    /** Resolves when everything recorded so far is on disk. */
    flush: () => queue,
    /** The last `limit` events (default and maximum 100), newest first, across the rotated files. */
    async recent(limit = 100): Promise<AuditEntry[]> {
      await queue;
      const wanted = Math.max(1, Math.min(100, Math.floor(limit)));
      const found: AuditEntry[] = [];
      for (const path of [file, ...Array.from({ length: keep }, (_, index) => `${file}.${index + 1}`)]) {
        found.push(...(await readEntries(path)).reverse());
        if (found.length >= wanted) break;
      }
      return found.slice(0, wanted);
    },
  };
}

export type AuditLog = ReturnType<typeof createAuditLog>;

/** For hosts started without an owner (tests): records nothing. */
export const noAudit: AuditLog = {
  hashIp: () => 'unknown',
  record: () => {},
  flush: async () => {},
  recent: async () => [],
};
