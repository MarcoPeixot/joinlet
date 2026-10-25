import { requestAuthHeaders } from '../workspace/requestAuth';
import { uiText } from '../i18n';
export interface SharePerson { name: string; color: string }
export type InviteRole = 'edit' | 'comment' | 'view';
export type InviteTtl = '1h' | '24h' | '7d' | 'never';
export type TunnelTtl = '30m' | '2h' | '24h';

export interface InviteView {
  id: string;
  name: string;
  role: InviteRole;
  createdAt: number;
  expiresAt: number | null;
  /** The invite's link on the local network. */
  url: string;
  /** The same link on the public address while public access is on. */
  publicUrl: string | null;
}

export type TunnelStatus = { active: false } | { active: true; provider: 'cloudflared'; url: string; expiresAt: number };
export type ShareStatus = { active: false } | { active: true; hosted?: boolean; root: string; people: SharePerson[]; invites: InviteView[]; tunnel: TunnelStatus; startedAt: number };

/** One line of the owner's audit log (never content): what the host recorded, already trimmed. */
export interface AuditEntry {
  t: string;
  type: string;
  invite?: string;
  inviteId?: string;
  role?: string;
  path?: string;
  op?: 'write' | 'remove';
  reason?: string;
  provider?: string;
  expiresAt?: number | null;
}

/** `offline`: the local server is not running (or has no share routes): the dialog explains and stops. */
export type ShareReply = { kind: 'ok'; status: ShareStatus } | { kind: 'offline'; reason: string } | { kind: 'error'; message: string };
export type ActivityReply = { kind: 'ok'; entries: AuditEntry[] } | { kind: 'offline'; reason: string } | { kind: 'error'; message: string };

export interface NewInvite { name: string; role: InviteRole; ttl: InviteTtl }

export interface ShareClient {
  status(): Promise<ShareReply>;
  prepare?(input: { dir?: string; files?: Record<string, string> }): Promise<ShareReply>;
  start(dir: string): Promise<ShareReply>;
  stop(): Promise<ShareReply>;
  createInvite(invite: NewInvite): Promise<ShareReply>;
  revokeInvite(id: string): Promise<ShareReply>;
  startTunnel(options: { ttl: TunnelTtl }): Promise<ShareReply>;
  stopTunnel(): Promise<ShareReply>;
  activity(): Promise<ActivityReply>;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const UNREACHABLE = uiText("O servidor local (bun run dev) precisa estar rodando para compartilhar.");
const ROLES = new Set(['edit', 'comment', 'view']);

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function isInvite(value: unknown): value is InviteView {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.role === 'string' && ROLES.has(value.role)
    && typeof value.createdAt === 'number' && (value.expiresAt === null || typeof value.expiresAt === 'number')
    && typeof value.url === 'string' && (value.publicUrl === null || typeof value.publicUrl === 'string');
}

function isTunnel(value: unknown): value is TunnelStatus {
  return isRecord(value) && (value.active === false || (value.active === true && value.provider === 'cloudflared' && typeof value.url === 'string' && typeof value.expiresAt === 'number'));
}

function isStatus(value: unknown): value is ShareStatus {
  if (!isRecord(value)) return false;
  if (value.active === false) return true;
  return value.active === true && Array.isArray(value.people) && Array.isArray(value.invites) && value.invites.every(isInvite) && isTunnel(value.tunnel) && typeof value.root === 'string';
}

function isEntry(value: unknown): value is AuditEntry {
  return isRecord(value) && typeof value.t === 'string' && typeof value.type === 'string';
}

export function createShareClient(fetchFn: Fetch = (input, init) => globalThis.fetch(input, init)): ShareClient {
  type Raw = { kind: 'ok'; json: unknown } | { kind: 'offline'; reason: string } | { kind: 'error'; message: string };
  async function request(path: string, init: RequestInit): Promise<Raw> {
    let res: Response;
    try {
      res = await fetchFn(path, {...init,headers:{...requestAuthHeaders(),...init.headers}});
    } catch {
      return { kind: 'offline', reason: UNREACHABLE };
    }
    const json = (res.headers.get('content-type') ?? '').includes('application/json') ? await res.json().catch(() => null) : null;
    // The dev proxy answers non-JSON when our server is down.
    if (!json || typeof json !== 'object') return { kind: 'offline', reason: UNREACHABLE };
    if (res.status === 503) return { kind: 'offline', reason: typeof (json as { error?: unknown }).error === 'string' ? (json as { error: string }).error : UNREACHABLE };
    if (res.status >= 400) {
      const error = (json as { error?: unknown }).error;
      return { kind: 'error', message: typeof error === 'string' ? error : uiText("O servidor respondeu {0}.", [res.status]) };
    }
    return { kind: 'ok', json };
  }
  async function call(path: string, init: RequestInit): Promise<ShareReply> {
    const raw = await request(path, init);
    if (raw.kind !== 'ok') return raw;
    return isStatus(raw.json) ? { kind: 'ok', status: raw.json } : { kind: 'error', message: uiText("Resposta inválida do servidor.") };
  }
  const post = (path: string, body?: unknown) => call(path, { method: 'POST', headers: { 'content-type': 'application/json', ...requestAuthHeaders() }, body: JSON.stringify(body ?? {}) });
  return {
    status: () => call('/api/share', { method: 'GET' }),
    prepare: (input) => post('/api/share/prepare', input),
    start: (dir) => post('/api/share/start', { dir }),
    stop: () => post('/api/share/stop'),
    createInvite: (invite) => post('/api/share/invites', invite),
    revokeInvite: (id) => post('/api/share/invites/revoke', { id }),
    // The warning is shown before this button exists; the server requires the acknowledgement as well.
    startTunnel: ({ ttl }) => post('/api/share/tunnel/start', { ttl, acknowledged: true }),
    stopTunnel: () => post('/api/share/tunnel/stop'),
    async activity() {
      const raw = await request('/api/share/audit', { method: 'GET' });
      if (raw.kind !== 'ok') return raw;
      const entries = isRecord(raw.json) && Array.isArray(raw.json.entries) ? raw.json.entries.filter(isEntry) : null;
      return entries ? { kind: 'ok', entries } : { kind: 'error', message: uiText("Resposta inválida do servidor.") };
    },
  };
}

export const shareClient = createShareClient();
