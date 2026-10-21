import { uiText } from '../i18n';
import { COMMENT_LIMITS } from '@strukt/workspace';
import type { RemoteSession } from '../workspace/remote';

/** Who is writing comments: the name and color the others see in the presence list, and what they may do. */
export interface Who {
  name: string;
  color: string;
  /** A stable id of this browser (the same one the presence announces). */
  cid: string;
  /** What owns this person's messages for the host's write rule: the invite for a guest, this browser otherwise. */
  owner: string;
  /** May edit and delete other people's comments (the owner, or a guest who can edit). */
  moderator: boolean;
  canWrite: boolean;
  /** Has chosen a name (a guest always has one; someone working alone is asked before the first comment). */
  named: boolean;
}

export interface KeyValue { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface WhoEnvironment {
  session: Pick<RemoteSession, 'role' | 'readOnly' | 'member'> | null;
  /** The tab's storage: where the collaboration client keeps this session's presence. */
  tab: KeyValue;
  /** The browser's storage: a name that stays between sessions. */
  local: KeyValue;
  random(): number;
}

/** The same record `CollaborationClient` keeps, so the presence and the comments name one person. */
const TAB_KEY = 'strukt:collaborator';
const LOCAL_KEY = 'strukt:identity';
const COLORS = ['#3972dc', '#c75c8f', '#319b77', '#a572d4', '#c08235'];
const COLOR = /^#[0-9a-fA-F]{6}$/;

interface Record_ { name: string; color: string; cid: string; named?: boolean }

function read(store: KeyValue, key: string): Record_ | null {
  try {
    const raw = store.getItem(key);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const { name, color, cid, named } = value as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim() || name.length > COMMENT_LIMITS.name || typeof color !== 'string' || !COLOR.test(color) || typeof cid !== 'string' || !/^[A-Za-z0-9_-]{6,32}$/.test(cid)) return null;
    return { name, color, cid, ...(named === true ? { named: true } : {}) };
  } catch { return null; }
}

function write(store: KeyValue, key: string, value: Record_): void {
  try { store.setItem(key, JSON.stringify(value)); } catch { /* storage may be blocked */ }
}

function randomId(random: () => number): string {
  return Array.from({ length: 12 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(random() * 36)]).join('');
}

const fresh = (random: () => number): Record_ => ({
  name: uiText("Colaborador {0}", [Math.floor(random() * 90) + 10]),
  color: COLORS[Math.floor(random() * COLORS.length)]!,
  cid: randomId(random),
});

export function resolveWho(env: WhoEnvironment): Who {
  const { session } = env;
  const saved = read(env.local, LOCAL_KEY);
  let record: Record_;
  if (session) {
    const tab = read(env.tab, TAB_KEY);
    if (tab) record = tab;
    else {
      // The first run in this tab: a person who is named on this browser comes in with that name.
      record = saved?.named ? { name: saved.name, color: saved.color, cid: randomId(env.random) } : fresh(env.random);
      write(env.tab, TAB_KEY, record);
    }
  } else {
    record = saved ?? fresh(env.random);
    if (!saved) write(env.local, LOCAL_KEY, record);
  }
  const role = session?.role;
  return {
    name: record.name,
    color: record.color,
    cid: record.cid,
    owner: session?.member ?? `c:${record.cid}`,
    moderator: !session || role === 'edit' || (role === undefined && !session.readOnly),
    canWrite: !session || !session.readOnly || role === 'comment',
    named: session ? true : record.named === true,
  };
}

/** Sets the name (and keeps the color and id), in this tab and, for a guest, in the record the presence reads. */
export function renameWho(env: WhoEnvironment, name: string): void {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (!clean || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(clean) || clean === '__proto__') throw new Error(uiText("Informe um nome para aparecer nos comentários."));
  if (clean.length > COMMENT_LIMITS.name) throw new Error(uiText("O nome passa de {0} caracteres.", [COMMENT_LIMITS.name]));
  const who = resolveWho(env);
  const next = { name: clean, color: who.color, cid: who.cid };
  if (env.session) write(env.tab, TAB_KEY, next);
  write(env.local, LOCAL_KEY, { ...next, named: true });
}

/** The real storages, for the app. */
export function browserEnvironment(session: WhoEnvironment['session']): WhoEnvironment {
  const none: KeyValue = { getItem: () => null, setItem: () => {} };
  const pick = (kind: 'sessionStorage' | 'localStorage'): KeyValue => { try { return globalThis[kind] ?? none; } catch { return none; } };
  return { session, tab: pick('sessionStorage'), local: pick('localStorage'), random: Math.random };
}
