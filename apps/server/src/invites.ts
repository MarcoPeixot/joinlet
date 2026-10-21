import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { UserError } from './userError';

/** `comment` reads like `view` and also writes comments (and only those, as `checkCommentWrite` allows). */
export type InviteRole = 'edit' | 'comment' | 'view';
export const INVITE_ROLES: readonly InviteRole[] = ['edit', 'comment', 'view'];
export const INVITE_TTLS = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000, never: null } as const;
export type InviteTtl = keyof typeof INVITE_TTLS;

export interface Invite {
  id: string;
  name: string;
  role: InviteRole;
  /** The secret of the link. Lives only in the host's memory; never logged. */
  token: string;
  createdAt: number;
  expiresAt: number | null;
}

/** What the owner's screen shows of an invite: the links carry the token, so this goes only to the loopback caller. */
export interface InviteView {
  id: string;
  name: string;
  role: InviteRole;
  createdAt: number;
  expiresAt: number | null;
  url: string;
  /** The same link on the tunnel's address while public access is on. */
  publicUrl: string | null;
}

export type InviteEvent = { type: 'create' | 'revoke' | 'expire'; invite: Invite };

/** `dead`: the token belonged to an invite that was revoked or has expired (told apart from a made-up one). */
export type InviteResolution =
  | { status: 'live'; invite: Invite }
  | { status: 'dead'; reason: 'revoked' | 'expired'; name: string }
  | { status: 'unknown' };

export interface InviteRegistryOptions {
  now?(): number;
  newId?(): string;
  newToken?(): string;
  onEvent?(event: InviteEvent): void;
  maxInvites?: number;
}

export const INVITE_NAME_MAX = 60;
const MAX_INVITES = 50;
const MAX_DEAD = 500;
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/u;

/** 256 bits, URL-safe. */
export const newInviteToken = () => randomBytes(32).toString('base64url');

const digest = (value: string) => createHash('sha256').update(value).digest();

function cleanName(value: unknown): string {
  if (typeof value !== 'string') throw new UserError('Informe o nome do convite.');
  const name = value.replace(/\s+/g, ' ').trim();
  if (CONTROL.test(value.replace(/[\t\n\r]/g, ' '))) throw new UserError('O nome do convite não pode ter caracteres de controle.');
  if (!name) throw new UserError('Informe o nome do convite.');
  if (name.length > INVITE_NAME_MAX) throw new UserError(`O nome do convite pode ter até ${INVITE_NAME_MAX} caracteres.`);
  return name;
}

/**
 * The invites of one running host, in memory only (they live and die with it). Every lookup is made on the clock, so
 * a revoked or expired invite stops working on the very next request; `sweep` lets the host notice the ones that
 * expire while idle and drop their sockets.
 */
export function createInviteRegistry({ now = Date.now, newId = randomUUID, newToken = newInviteToken, onEvent, maxInvites = MAX_INVITES }: InviteRegistryOptions = {}) {
  const live = new Map<string, { invite: Invite; digest: Buffer }>();
  /** SHA-256 of tokens that were revoked or expired (bounded), to tell "ended" from "never existed". */
  const dead = new Map<string, { reason: 'revoked' | 'expired'; name: string }>();
  let compared = 0;

  const bury = (entry: { invite: Invite; digest: Buffer }, reason: 'revoked' | 'expired') => {
    live.delete(entry.invite.id);
    dead.set(entry.digest.toString('hex'), { reason, name: entry.invite.name });
    if (dead.size > MAX_DEAD) dead.delete(dead.keys().next().value as string);
    onEvent?.({ type: reason === 'revoked' ? 'revoke' : 'expire', invite: entry.invite });
  };
  const sweep = () => {
    const at = now();
    for (const entry of [...live.values()]) if (entry.invite.expiresAt !== null && entry.invite.expiresAt <= at) bury(entry, 'expired');
  };

  return {
    create(input: { name: unknown; role: unknown; ttl: unknown; token?: string }): Invite {
      const name = cleanName(input.name);
      if (typeof input.role !== 'string' || !INVITE_ROLES.includes(input.role as InviteRole)) throw new UserError('Escolha um papel: editar, comentar ou ver.');
      if (typeof input.ttl !== 'string' || !Object.hasOwn(INVITE_TTLS, input.ttl)) throw new UserError('Escolha a validade do convite: 1 hora, 24 horas, 7 dias ou sem prazo.');
      sweep();
      if (live.size >= maxInvites) throw new UserError(`Limite de ${maxInvites} convites ativos. Revogue algum antes de criar outro.`);
      const ttl = INVITE_TTLS[input.ttl as InviteTtl];
      const createdAt = now();
      const invite: Invite = { id: newId(), name, role: input.role as InviteRole, token: input.token ?? newToken(), createdAt, expiresAt: ttl === null ? null : createdAt + ttl };
      live.set(invite.id, { invite, digest: digest(invite.token) });
      onEvent?.({ type: 'create', invite });
      return invite;
    },
    /** Compares against every live invite (no early exit, digests of equal length), then checks the clock. */
    resolve(token: unknown): InviteResolution {
      if (typeof token !== 'string' || !token) return { status: 'unknown' };
      const given = digest(token);
      let found: { invite: Invite; digest: Buffer } | null = null;
      for (const entry of live.values()) {
        compared++;
        if (timingSafeEqual(given, entry.digest)) found = entry;
      }
      if (found) {
        if (found.invite.expiresAt !== null && found.invite.expiresAt <= now()) {
          bury(found, 'expired');
          return { status: 'dead', reason: 'expired', name: found.invite.name };
        }
        return { status: 'live', invite: found.invite };
      }
      const ended = dead.get(given.toString('hex'));
      return ended ? { status: 'dead', ...ended } : { status: 'unknown' };
    },
    isLive(id: string): boolean {
      const entry = live.get(id);
      if (!entry) return false;
      if (entry.invite.expiresAt !== null && entry.invite.expiresAt <= now()) {
        bury(entry, 'expired');
        return false;
      }
      return true;
    },
    /** The live invite with this id (not checked against the clock: use `isLive` for that). */
    get(id: string): Invite | undefined {
      return live.get(id)?.invite;
    },
    revoke(id: string): boolean {
      const entry = live.get(id);
      if (!entry) return false;
      bury(entry, 'revoked');
      return true;
    },
    list(): Invite[] {
      sweep();
      return [...live.values()].map((entry) => entry.invite);
    },
    sweep,
    /** Test hook: how many token comparisons the registry has made. */
    comparisons: () => compared,
    deadCount: () => dead.size,
  };
}

export type InviteRegistry = ReturnType<typeof createInviteRegistry>;
