/**
 * Presence of a collaborator (who they are, where their cursor is). Sent by each guest, validated by the host and
 * relayed to the room: a hostile peer can send anything, so nothing here is trusted until it passes these functions.
 */

export interface RelativePositionJson {
  type?: { client: number; clock: number } | null;
  tname?: string | null;
  item?: { client: number; clock: number } | null;
  assoc?: number;
}

export interface PresenceState {
  /** The selection in a Markdown doc, as Yjs relative positions (they survive concurrent edits). */
  doc?: { anchor: RelativePositionJson; head: RelativePositionJson };
  /** The pointer (flow coordinates) and the selected nodes in a diagram. */
  diagram?: { pointer?: { x: number; y: number }; nodes?: string[] };
}

export interface PresenceInfo {
  name: string;
  color: string;
  /** A client's stable id, so it can tell itself apart in the list the host announces. */
  cid?: string;
  state?: PresenceState;
}

export const PRESENCE_MAX_BYTES = 2000;
const MAX_NODES = 50;
const MAX_ID = 120;
const MAX_COORD = 10_000_000;
const MAX_CLOCK = 2 ** 48;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;

function structId(value: unknown): { client: number; clock: number } | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !isInt(value.client, 2 ** 32) || !isInt(value.clock, MAX_CLOCK)) return undefined;
  return { client: value.client, clock: value.clock };
}

/** A Yjs `RelativePosition` as JSON, or null when it is not one (only the four known keys, each well-formed). */
function relativePosition(value: unknown): RelativePositionJson | null {
  if (!isRecord(value)) return null;
  const out: RelativePositionJson = {};
  if ('type' in value) { const id = structId(value.type); if (id === undefined) return null; out.type = id; }
  if ('item' in value) { const id = structId(value.item); if (id === undefined) return null; out.item = id; }
  if ('tname' in value) {
    if (value.tname !== null && (typeof value.tname !== 'string' || value.tname.length > 60)) return null;
    out.tname = value.tname as string | null;
  }
  if ('assoc' in value) {
    if (typeof value.assoc !== 'number' || !Number.isFinite(value.assoc) || Math.abs(value.assoc) > 1) return null;
    out.assoc = value.assoc;
  }
  return out.type || out.item || out.tname ? out : null;
}

const coordinate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_COORD;

/** The part of a presence a peer may announce. `null` when the whole thing is unusable (not an object, too big). */
export function sanitizePresenceState(value: unknown): PresenceState | null {
  if (!isRecord(value)) return null;
  try { if (JSON.stringify(value).length > PRESENCE_MAX_BYTES) return null; } catch { return null; }
  const state: PresenceState = {};
  if (isRecord(value.doc)) {
    const anchor = relativePosition(value.doc.anchor);
    const head = relativePosition(value.doc.head);
    if (anchor && head) state.doc = { anchor, head };
  }
  if (isRecord(value.diagram)) {
    const diagram: NonNullable<PresenceState['diagram']> = {};
    const { pointer, nodes } = value.diagram;
    if (isRecord(pointer) && coordinate(pointer.x) && coordinate(pointer.y)) diagram.pointer = { x: pointer.x, y: pointer.y };
    if (Array.isArray(nodes)) {
      const ids = nodes.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= MAX_ID).slice(0, MAX_NODES);
      if (ids.length) diagram.nodes = ids;
    }
    if (diagram.pointer || diagram.nodes) state.diagram = diagram;
  }
  return state;
}

/** A presence announcement from a guest: a bad identity rejects it; a bad `cid` or `state` is just left out. */
export function sanitizePresence(value: unknown): PresenceInfo | null {
  if (!isRecord(value)) return null;
  const { name, color, cid, state } = value;
  if (typeof name !== 'string' || !name.trim() || name.length > 60 || typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) return null;
  const info: PresenceInfo = { name, color };
  if (typeof cid === 'string' && /^[A-Za-z0-9_-]{6,32}$/.test(cid)) info.cid = cid;
  const clean = state === undefined ? null : sanitizePresenceState(state);
  if (clean) info.state = clean;
  return info;
}
