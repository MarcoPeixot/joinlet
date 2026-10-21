import { serializeWorkspaceWrite } from './workspaceWrite';
import { refreshGeneratedContext } from '@strukt/workspace/context-storage';
import { SELF_HOSTED_PLAN, type AccessPlan, BetaLimitError, assertBetaManifest, createBetaPresence } from '@strukt/workspace';
import { createHash, createHmac, randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { printDiagramJsonSchema } from '@strukt/json';
import { brokenDiagramText, collaborationRoomName, parseCollaborationItem } from '@strukt/workspace/collaboration';
import { checkCommentWrite, parseCommentsPath, pinCommentIdentity, validateComments } from '@strukt/workspace';
import { MANIFEST_PATH, deserializeDiagram, diagramPath, parseManifest, parseVersion, versionPath, LIBRARY_PATH, parseLibrary } from '@strukt/workspace';
import type { StorageAdapter } from '@strukt/workspace';
import { noAudit } from './audit';
import type { AuditLog, AuditReason } from './audit';
import { createFailureLimiter } from './failureLimiter';
import type { FailureLimiter } from './failureLimiter';
import type { Invite, InviteRegistry, InviteRole } from './invites';

/** What a guest may send in one request; longer bodies are refused while they stream (chunked ones too). */
export const COLLAB_BODY_LIMIT = 1_000_000;

const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** A plain page for a person who opened a link that does not work (the app itself cannot load without an invite). */
function refusalPage(message: string): string {
  const [headline, ...advice] = message.split(' Peça ');
  const hint = message.includes('Joinlet Beta') ? '' : advice.length ? `Peça ${advice.join(' Peça ')}` : 'Peça um novo link a quem compartilhou o workspace.';
  return `<!doctype html><html lang="${message.startsWith('This workspace') ? 'en' : 'pt-BR'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Joinlet</title><style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;box-sizing:border-box}main{max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{margin:0;opacity:.8}</style></head><body><main><h1>${escapeHtml(headline!)}</h1><p>${escapeHtml(hint)}</p></main></body></html>`;
}

/**
 * A refusal: JSON for the app and for scripts, a small page for a browser navigating to the link (what a guest sees
 * when an invite was revoked or has expired). `message` is always one of this file's own sentences.
 */
function refuse(request: Request, status: number, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response {
  const wantsPage = request.method === 'GET' && (request.headers.get('accept') ?? '').includes('text/html') && request.headers.get('upgrade') === null;
  if (!wantsPage) return Response.json({ error: message, ...extra }, { status, headers: { 'cache-control': 'no-store', ...headers } });
  return new Response(refusalPage(message), { status, headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'", 'x-content-type-options': 'nosniff', ...headers,
  } });
}

/** Constant-time on the digests, so neither the content nor the length of the secret shows in the timing. */
function matches(a: string | undefined | null, b: string): boolean {
  if (!a) return false;
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

function cookie(header: string | null): string | undefined {
  return header?.split(';').map((part) => part.trim()).find((part) => part.startsWith('strukt_collab='))?.slice('strukt_collab='.length);
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const LOOPBACK_ADDRESS = /^(127\.|::1$|::ffff:127\.)/;
const DENIAL_GAP_MS = 60_000;
/** Who owns a guest's comments for the write rule (`checkCommentWrite`); the session hands it to the app as `member`. */
const inviteOwner = (invite: Invite): string => `i:${invite.id}`;
const INVITE_ENDED = 'Este convite foi revogado ou expirou. Peça um novo link a quem compartilhou.';
const COOKIE_SECONDS = 86_400;
/** Writes one invite may make in a window (an editor's saves come in bursts; a flood is not). */
const WRITES_PER_WINDOW = 40;
const WRITE_WINDOW_MS = 10_000;

/** `http://<loopback name>:<port>` (Origin) or `<loopback name>:<port>` (Host), for exactly this port. */
function loopback(value: string | null, port: number, withScheme: boolean): boolean {
  if (!value) return false;
  try {
    const url = new URL(withScheme ? value : `http://${value}`);
    return url.protocol === 'http:' && LOOPBACK.has(url.hostname) && Number(url.port || 80) === port && (!withScheme || url.origin === value);
  } catch { return false; }
}

/**
 * One of the host's origins (the LAN invite's and, while a tunnel is up, the public one), or, for the owner on this
 * machine, a loopback alias of the LAN origin (`localhost`/`127.0.0.1`/`[::1]`, same port) when both the Origin and the
 * Host of the request are loopback names. A LAN request (Host = the LAN address) still needs the exact origin.
 */
export function allowedOrigin(request: Request, origin: string | readonly (string | null)[], port: number): boolean {
  const from = request.headers.get('origin');
  const origins = typeof origin === 'string' ? [origin] : origin;
  if (from !== null && origins.includes(from)) return true;
  return loopback(from, port, true) && loopback(request.headers.get('host'), port, false);
}

/** Reads the body up to `limit` bytes; null (and the stream is cancelled) past it, whatever the Content-Length says. */
export async function readLimited(request: Request, limit = COLLAB_BODY_LIMIT): Promise<string | null> {
  const declared = request.headers.get('content-length');
  if (declared !== null && !(Number(declared) <= limit)) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    // Bun's own `maxRequestBodySize` fails the read past the limit: the same refusal.
    const next = await reader.read().catch(() => null);
    if (!next) return null;
    if (next.done) break;
    size += next.value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(next.value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

const SLUG = '[A-Za-z0-9][A-Za-z0-9_-]*';
const json = (text: string) => { try { JSON.parse(text); return true; } catch { return false; } };

type Rule = {
  /** Removing it (a deleted item's files) is allowed. */
  removable: boolean;
  /** A pt-BR reason when `text` is not what this file holds, else null. */
  check(text: string, storage: StorageAdapter): Promise<string | null> | string | null;
};

const jsonFile = (removable: boolean): Rule => ({ removable, check: (text) => (json(text) ? null : 'O arquivo não é um JSON válido.') });

/**
 * The files a guest writes through the REST surface, by exact path pattern (slugs as the manifest's): the workspace's
 * own files and nothing else. Never `context/**` (generated by the Joinlet for agents), `agent.json`, other names or
 * extensions. JSON files must parse (a diagram through its parser); a version must be one, at its own path.
 */
export function guestWriteRule(path: string): Rule | null {
  if (path === MANIFEST_PATH) return { removable: false, check: (text) => { try { parseManifest(text); return null; } catch (error) { return (error as Error).message; } } };
  if (path === 'strukt.schema.json') return { removable: false, check: (text) => (text === printDiagramJsonSchema() ? null : 'strukt.schema.json é gerado pelo Joinlet.') };
  if (path === LIBRARY_PATH) return { removable: true, check: (text) => { try { parseLibrary(text); return null; } catch (error) { return (error as Error).message; } } };
  if (['board.json', 'evidence.json', 'model.json', 'concerns.json', 'assistants.json'].includes(path)) return jsonFile(true);
  let match = new RegExp(`^diagrams/(${SLUG})\\.strukt\\.json$`).exec(path);
  if (match) return {
    removable: true,
    check: (text) => (deserializeDiagram(text, null).diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? 'O diagrama tem erros e não foi salvo.' : null),
  };
  if (new RegExp(`^diagrams/${SLUG}\\.(layout|flows)\\.json$`).test(path)) return jsonFile(true);
  // Saved perspectives (one file per diagram, like the flows): JSON that is a list or `{ version, perspectives: [] }`.
  if (new RegExp(`^diagrams/${SLUG}\\.perspectives\\.json$`).test(path)) {
    return { removable: true, check: (text) => { try { const value = JSON.parse(text) as unknown; return Array.isArray(value) || (!!value && typeof value === 'object' && Array.isArray((value as { perspectives?: unknown }).perspectives)) ? null : 'As perspectivas precisam ser uma lista ou { "version": 1, "perspectives": [] }.'; } catch { return 'O arquivo não é um JSON válido.'; } } };
  }
  // The backup a load makes of a diagram file with errors: only a copy of that file as it is now, and never over a
  // different backup (a valid copy would destroy the broken original it keeps).
  match = new RegExp(`^diagrams/(${SLUG})\\.strukt\\.json\\.bak$`).exec(path);
  if (match) {
    const slug = match[1]!;
    return {
      removable: false,
      check: async (text, storage) => {
        const current = await storage.read(diagramPath(slug));
        if (text !== current || !brokenDiagramText({ kind: 'diagram', slug }, { [diagramPath(slug)]: current })) return 'O backup precisa ser uma cópia do diagrama com erros.';
        const existing = await storage.read(path);
        return existing === null || existing === text ? null : 'Já existe um backup deste diagrama.';
      },
    };
  }
  const comments = parseCommentsPath(path);
  if (comments) return { removable: true, check: (text) => validateComments(text, comments.kind) };
  if (new RegExp(`^docs/${SLUG}\\.md$`).test(path)) return { removable: true, check: () => null };
  if (new RegExp(`^sketches/${SLUG}\\.excalidraw$`).test(path)) return jsonFile(true);
  if (new RegExp(`^versions/${SLUG}/index\\.json$`).test(path)) return { removable: true, check: (text) => { try { return Array.isArray(JSON.parse(text)) ? null : 'O índice de versões precisa ser uma lista.'; } catch { return 'O arquivo não é um JSON válido.'; } } };
  match = new RegExp(`^versions/(${SLUG})/[A-Za-z0-9_-]+\\.json$`).exec(path);
  if (match) {
    const slug = match[1]!;
    return { removable: true, check: (text) => { const version = parseVersion(text); return version && versionPath(slug, version) === path ? null : 'O arquivo não é uma versão deste diagrama.'; } };
  }
  return null;
}

export interface CollaborationHandlerOptions {
  accessPlan?: AccessPlan;
  root: string;
  archDir: string;
  adapter(): StorageAdapter;
  /** Who may enter: named invites with a role and an expiry (see `invites.ts`). */
  invites: InviteRegistry;
  /** The invite's origin (`http://<LAN address>:<port>`). */
  origin: string;
  /** The tunnel's `https://` origin while public access is on, else null. */
  publicOrigin?(): string | null;
  port: number;
  /** The built web app (`apps/web/dist`). */
  dist: string;
  asset(file: string): Promise<Response | null>;
  newId(): string;
  /** A guest wrote or removed a file a room projects (`diagram:<slug>`/`doc:<slug>`): the host re-reads that room. */
  onRoomFile?(item: string): void;
  audit?: AuditLog;
  /** Caps invalid-token attempts per address (429); on by default. */
  limiter?: FailureLimiter;
  now?(): number;
  ownerInvite?(): string | undefined;
  presence?: ReturnType<typeof createBetaPresence>;
}

/** Where a request came from: Bun's socket address (absent in tests). */
export interface RequestInfo { ip?: string }

/** The room whose projection `path` is (`diagram:<slug>` or `doc:<slug>`), else null. */
function roomItemOf(path: string): string | null {
  const diagram = new RegExp(`^diagrams/(${SLUG})\\.(?:strukt|layout)\\.json$`).exec(path);
  if (diagram) return `diagram:${diagram[1]}`;
  const doc = new RegExp(`^docs/(${SLUG})\\.md$`).exec(path);
  return doc ? `doc:${doc[1]}` : null;
}

/** Hands the request to the WebSocket server (Bun's `server.upgrade`); false when it is not an upgrade. `refused`: no
 * room opens, the socket is closed with `COLLAB_CLOSE_NOT_FOUND` and this reason as soon as it opens. */
export type CollaborationUpgrade = (request: Request, data: { room: string; id: string; refused?: string; readOnly?: boolean; invite?: string; role?: InviteRole; participant?: string }) => boolean;

/**
 * The LAN host's HTTP surface for guests. It never answers with a stack or a path of the host: the workspace is
 * named by its folder name only, and a failure is a plain JSON `{ error }` (400 for a malformed URL, 500 otherwise).
 */
export function createCollaborationHandler(options: CollaborationHandlerOptions) {
  const plan = options.accessPlan ?? SELF_HOSTED_PLAN;
  const name = basename(options.root) || 'workspace';
  const dist = resolve(options.dist);
  const audit = options.audit ?? noAudit;
  const now = options.now ?? Date.now;
  const limiter = options.limiter ?? createFailureLimiter({ now });
  /** Writes per invite: a sliding window, so one guest cannot keep the host busy (or rotate the audit log away). */
  const writeLimiter = createFailureLimiter({ now, limit: WRITES_PER_WINDOW, windowMs: WRITE_WINDOW_MS });
  const publicOrigin = () => options.publicOrigin?.() ?? null;
  // Reserve the owner's slot even while the local editor is on the Overview.
  const presence = options.presence ?? createBetaPresence({ now, reserved: 1, plan: () => plan });
  const signingKey = randomBytes(32);
  const sign = (id: string, invite: string) => createHmac('sha256', signingKey).update(`${invite}:${id}`).digest('hex');
  const participant = (request: Request, invite: Invite) => {
    if (invite.id === options.ownerInvite?.()) return { id: 'owner', cookie: null };
    const held = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith('joinlet_participant='))?.slice(20);
    const [id, signature] = (held ?? '').split('.');
    const valid = !!id && !!signature && matches(signature, sign(id, invite.id));
    const identity = valid ? id! : randomUUID();
    presence.touch(identity);
    return { id: identity, cookie: valid ? null : `joinlet_participant=${identity}.${sign(identity, invite.id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_SECONDS}${originFor(request).startsWith('https:') ? '; Secure' : ''}` };
  };

  /** The origin this request used: the tunnel's when its Host is the tunnel's, else the LAN invite's. */
  const originFor = (request: Request): string => {
    const published = publicOrigin();
    return published && request.headers.get('host')?.toLowerCase() === new URL(published).host ? published : options.origin;
  };
  /**
   * Who is asking, for the attempt limit and the audit. Cloudflare's header is believed only while a tunnel is up and
   * only from a loopback socket (cloudflared itself): anyone else could write it, but could not be on loopback.
   */
  const addressOf = (request: Request, info?: RequestInfo): string => {
    const socket = info?.ip ?? 'unknown';
    if (publicOrigin() && LOOPBACK_ADDRESS.test(socket)) {
      const forwarded = request.headers.get('cf-connecting-ip');
      if (forwarded && /^[0-9a-fA-F:.]{2,45}$/.test(forwarded)) return forwarded;
    }
    return socket;
  };

  /** The same refusal for the same caller is audited once a minute: a revoked guest's open tab must not flood the log. */
  const denials = new Map<string, number>();
  const denied = (invite: Invite | null, ip: string, reason: AuditReason, path?: string) => {
    const key = `${ip}|${reason}|${invite?.id ?? ''}`;
    const last = denials.get(key);
    if (last !== undefined && now() - last < DENIAL_GAP_MS) return;
    denials.delete(key);
    denials.set(key, now());
    while (denials.size > 1000) denials.delete(denials.keys().next().value as string);
    audit.record({ type: 'denied', ip: audit.hashIp(ip), reason, ...(invite ? { invite: invite.name, inviteId: invite.id, role: invite.role } : {}), ...(path ? { path } : {}) });
  };

  /**
   * The invite a token opens, checked now (revoked and expired ones stop working on the very next request), or the
   * refusal to send. Unknown tokens past the attempt limit are refused; a valid invitation remains usable.
   */
  const authenticate = (request: Request, token: string | null | undefined, ip: string): { invite: Invite } | Response => {
    const found = options.invites.resolve(token);
    // A live invite is never turned away for what other tokens from the same address did (a stale cookie from before a
    // restart, another browser of the same person, a guesser behind the same NAT).
    if (found.status === 'live') return { invite: found.invite };
    if (found.status === 'dead') {
      denied(null, ip, 'ended_invite');
      return refuse(request, 401, INVITE_ENDED, { code: 'invite_ended' });
    }
    // Past the limit, tokens that open nothing are refused without counting; the same token is counted once.
    const wait = limiter.blocked(ip);
    if (wait) {
      denied(null, ip, 'rate_limited');
      return refuse(request, 429, 'Tentativas demais com convites inválidos. Aguarde e tente de novo.', {}, { 'retry-after': String(wait) });
    }
    limiter.fail(ip, token ?? '');
    denied(null, ip, 'invalid_token');
    return refuse(request, 401, 'Convite inválido.');
  };

  const inManifest = async (kind: string | null, slug: string | null): Promise<boolean> => {
    const text = await options.adapter().read(MANIFEST_PATH);
    if (text === null) return false;
    const { manifest } = parseManifest(text);
    const list = kind === 'diagram' ? manifest.diagrams : kind === 'doc' ? manifest.docs : [];
    return list.some((entry) => entry.slug === slug);
  };

  /**
   * A write through the REST surface. `view` writes nothing. `comment` writes only comment files (`comments/<kind>-<slug>.json`,
   * for an item of the manifest) and only as `checkCommentWrite` allows: it adds conversations and messages as itself,
   * edits and deletes its own, resolves and reopens, and leaves everything else of the file untouched. `edit` writes
   * every file of `guestWriteRule`.
   */
  const write = async (request: Request, invite: Invite, ip: string): Promise<Response> => {
    if (invite.role === 'view') {
      denied(invite, ip, 'read_only');
      return response({ error: 'Este link é somente leitura.' }, 403);
    }
    if (!matches(request.headers.get('x-strukt-csrf'), invite.token)) return response({ error: 'Sessão inválida.' }, 401);
    const wait = writeLimiter.blocked(invite.id);
    if (wait) {
      denied(invite, ip, 'rate_limited');
      return Response.json({ error: 'Gravações demais em pouco tempo. Aguarde um instante e tente de novo.' }, { status: 429, headers: { 'cache-control': 'no-store', 'retry-after': String(wait) } });
    }
    writeLimiter.fail(invite.id);
    const raw = await readLimited(request);
    if (raw === null) return response({ error: 'Arquivo grande demais para a colaboração.' }, 413);
    let body: { repo?: unknown; path?: unknown; text?: unknown; expected?: unknown; remove?: unknown };
    try { body = JSON.parse(raw); } catch { return response({ error: 'Corpo inválido.' }, 400); }
    if (!body || typeof body !== 'object' || body.repo !== name || typeof body.path !== 'string' || (body.text !== undefined && typeof body.text !== 'string')) return response({ error: 'Arquivo inválido.' }, 400);
    const path = body.path;
    const target = parseCommentsPath(path);
    if (invite.role === 'comment' && (!target || body.remove === true)) {
      denied(invite, ip, 'read_only', path);
      return response({ error: 'Este link só permite comentar.' }, 403);
    }
    const rule = guestWriteRule(path);
    if (!rule || (body.remove === true && !rule.removable)) {
      denied(invite, ip, 'path_not_allowed', path);
      return response({ error: 'Arquivo não permitido nesta sessão.' }, 403);
    }
    if (body.remove !== true && typeof body.text !== 'string') return response({ error: 'Envie o texto do arquivo ("text") ou "remove": true.' }, 400);
    if (body.expected !== null && typeof body.expected !== 'string') return response({ error: 'Informe o conteúdo esperado do arquivo (expected).' }, 428);
    // Comments belong to an item the workspace has: a file for any other name would be litter.
    if (target && body.remove !== true && !await inManifest(target.kind, target.slug).catch(() => false)) return response({ error: 'Este item não existe neste workspace.' }, 422);
    const storage = options.adapter();
    return serializeWorkspaceWrite(storage.label, async () => {
      // An invite revoked while the request waited its turn writes nothing.
      if (!options.invites.isLive(invite.id)) return response({ error: INVITE_ENDED, code: 'invite_ended' }, 401);
      const current = await storage.read(path);
      if (current !== body.expected) return response({ error: 'Arquivo alterado fora da sessão.' }, 409);
      if (body.remove === true) await storage.remove(path);
      else {
        const problem = await rule.check(body.text as string, storage);
        if (problem) return response({ error: problem }, 422);
        if (path === MANIFEST_PATH) assertBetaManifest(current, body.text as string, plan);
        // A comments file is stored in its canonical form, with the identity of what this guest wrote pinned to its invite.
        const stored = target ? pinCommentIdentity(current, body.text as string, target.kind, inviteOwner(invite), invite.name) : (body.text as string);
        if (invite.role === 'comment') {
          const refusal = checkCommentWrite(current, stored, target!.kind, inviteOwner(invite), now());
          if (refusal) {
            denied(invite, ip, 'comment_rule', path);
            return response({ error: refusal }, 403);
          }
        }
        await storage.write(path, stored);
      }
      await refreshGeneratedContext(storage);
      audit.record({ type: 'write', invite: invite.name, inviteId: invite.id, role: invite.role, path, op: body.remove === true ? 'remove' : 'write' });
      const item = roomItemOf(path);
      if (item) options.onRoomFile?.(item);
      return response({ ok: true, revision: Date.now() });
    });
  };

  const handle = async (request: Request, upgrade: CollaborationUpgrade, info: RequestInfo | undefined, admission: { cookie: string | null }): Promise<Response | undefined> => {
    const url = new URL(request.url);
    const ip = addressOf(request, info);
    if (url.pathname === '/join') {
      const entered = authenticate(request, url.searchParams.get('token'), ip);
      if (entered instanceof Response) return entered;
      const { invite } = entered;
      admission.cookie = participant(request, invite).cookie;
      audit.record({ type: 'join', invite: invite.name, inviteId: invite.id, role: invite.role, ip: audit.hashIp(ip) });
      // The cookie never outlives the invite (nor a day: the link opens it again).
      const lifetime = invite.expiresAt === null ? COOKIE_SECONDS : Math.max(1, Math.min(COOKIE_SECONDS, Math.floor((invite.expiresAt - now()) / 1000)));
      return new Response(null, { status: 302, headers: {
        location: '/app/',
        'set-cookie': `strukt_collab=${invite.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${lifetime}${originFor(request).startsWith('https:') ? '; Secure' : ''}`,
        'referrer-policy': 'no-referrer',
        'cache-control': 'no-store',
      } });
    }
    // No cookie is not a wrong guess: nothing to count (a browser without the invite just asks for it).
    const held = cookie(request.headers.get('cookie'));
    if (!held) return refuse(request, 401, 'Abra o convite de colaboração para entrar.');
    const entered = authenticate(request, held, ip);
    if (entered instanceof Response) return entered;
    const { invite } = entered;
    const enteredParticipant = participant(request, invite);
    admission.cookie = enteredParticipant.cookie;
    const role = invite.role;
    if (url.pathname === '/api/remote/plan') return response({ plan, accountPlan: SELF_HOSTED_PLAN, scope: 'shared', participants: presence.used() });
    if (url.pathname === '/api/collaboration/invite') return role !== 'edit' ? response({ error: 'Este link é somente leitura.' }, 403) : response({ url: `${originFor(request)}/join?token=${encodeURIComponent(invite.token)}` });
    if (url.pathname === '/api/collaboration' && request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      if (!allowedOrigin(request, [options.origin, publicOrigin()], options.port) || url.searchParams.get('repo') !== name) {
        denied(invite, ip, 'bad_origin');
        return response({ error: 'Sessão inválida.' }, 403);
      }
      const kind = url.searchParams.get('kind');
      const slug = url.searchParams.get('slug');
      const item = parseCollaborationItem(`${kind}:${slug}`);
      const who = { invite: invite.id, role, participant: enteredParticipant.id, ...(role === 'edit' ? {} : { readOnly: true }) };
      // Rooms only for the manifest's items: a room for any other slug would create files. The socket is accepted and
      // closed with a code the client reads (a refused upgrade reaches a browser as 1006, like a network failure).
      if (!item || !await inManifest(kind, slug).catch(() => false)) {
        return upgrade(request, { room: '', id: options.newId(), refused: 'Este item não está salvo no workspace do host.', ...who }) ? undefined : response({ error: 'Sala inválida.' }, 404);
      }
      const room = collaborationRoomName(options.root, `${kind}:${slug}`);
      return upgrade(request, { room, id: options.newId(), ...who }) ? undefined : response({ error: 'Falha na conexão.' }, 400);
    }
    if (url.pathname === '/api/remote/session') return response({ repo: name, csrf: invite.token, mcpUrl: originFor(request), mode: 'lan', role, member: inviteOwner(invite), ...(role === 'edit' ? {} : { readOnly: true }) });
    if (url.pathname === '/api/remote/init' && request.method === 'POST') return response({ ok: true, setup: { conflicts: [] } });
    if (url.pathname === '/api/remote/pr') return response({ url: null });
    if (url.pathname === '/api/remote/revision') {
      if (url.searchParams.get('repo') !== name) return response({ error: 'Sessão inválida.' }, 401);
      const files = await options.adapter().list();
      const times = await Promise.all(files.map((path) => stat(join(options.archDir, path)).then((file) => file.mtimeMs)));
      return response({ revision: Math.max(0, ...times) });
    }
    if (url.pathname === '/api/remote/workspace' && request.method === 'GET') {
      if (url.searchParams.get('repo') !== name) return response({ error: 'Sessão inválida.' }, 401);
      const path = url.searchParams.get('path');
      try { return path ? response({ text: await options.adapter().read(path) }) : response({ files: await options.adapter().list() }); }
      catch { return response({ error: 'Caminho inválido.' }, 400); }
    }
    if (url.pathname === '/api/remote/workspace' && request.method === 'POST') return write(request, invite, ip);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/mcp')) return response({ error: 'Endpoint indisponível nesta sessão.' }, 404);
    const path = url.pathname === '/' ? 'index.html' : /^\/app\/?$/.test(url.pathname) ? 'app/index.html' : /^\/setup\/?$/.test(url.pathname) ? 'setup/index.html' : /^\/docs(?:\/[a-zA-Z0-9-]+)*\/?$/.test(url.pathname) ? `${url.pathname.slice(1).replace(/\/$/, '')}/index.html` : decodeURIComponent(url.pathname.slice(1));
    const file = resolve(dist, path);
    if (file !== dist && !file.startsWith(`${dist}${sep}`)) return response({ error: 'Caminho inválido.' }, 400);
    if (path === 'index.html' || path === 'app/index.html') return new Response((await readFile(file, 'utf8')).replace('</head>', '<meta name="strukt-mode" content="remote"></head>'), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    if (path === 'setup/index.html') return new Response(await readFile(file, 'utf8'), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
    return await options.asset(file) ?? new Response('Não encontrado.', { status: 404 });
  };

  return async (request: Request, upgrade: CollaborationUpgrade, info?: RequestInfo): Promise<Response | undefined> => {
    const admission = { cookie: null as string | null };
    try {
      const result = await handle(request, upgrade, info, admission);
      if (result && admission.cookie) result.headers.append('set-cookie', admission.cookie);
      return result;
    }
    catch (error) {
      if (error instanceof BetaLimitError) {
        const portuguese = /^pt\b/i.test(request.headers.get('accept-language') ?? '') || new URL(request.url).searchParams.get('lang') === 'pt-BR';
        const message = error.resource === 'participants' && !portuguese ? `This workspace has reached the Joinlet Beta limit of ${error.limit} concurrent participants. Try again when someone leaves.` : error.message;
        return refuse(request, 403, message, { ...error.toJSON(), error: message });
      }
      if (error instanceof URIError) return response({ error: 'Caminho inválido.' }, 400);
      console.warn(`Colaboração: falha ao atender ${request.method} ${new URL(request.url).pathname.slice(0, 200)}: ${error instanceof Error ? error.message : String(error)}`);
      return response({ error: 'Erro interno.' }, 500);
    }
  };
}
