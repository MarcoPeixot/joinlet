import { slugify } from './slug';
import { MAX_ASSISTANTS, MAX_INSTRUCTION, MAX_NAME } from './assistants';
import type { Assistant } from './assistants';

// Reading `assistants.json`, naming and checking assistants: loaded on demand (`loadWorkspace`, the editor), not with the app's first screen.

/** Built-in ids are reserved so a saved assistant can never pass for one. */
export const BUILTIN_PREFIX = 'builtin-';
export const isReservedAssistantId = (id: string) => id.toLowerCase().startsWith(BUILTIN_PREFIX);
export const ASSISTANT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** The file is read as text from a repo: beyond this it is not an assistants file. */
const MAX_FILE = 2_000_000;
/** Entries looked at, valid or not: a file of junk costs bounded work. */
const MAX_SCANNED = 500;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;

const cleanName = (raw: string) => raw.replace(/[\n\r\t]+/g, ' ').replace(CONTROL, '').trim().slice(0, MAX_NAME).trim();
const cleanInstruction = (raw: string) => raw.replace(CONTROL, '').trim().slice(0, MAX_INSTRUCTION).trim();
const reserved = isReservedAssistantId;

/** `base`, then `base-2`, `base-3`… until it is not in `taken`. */
function unique(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** An id for a new assistant: the name as a slug, numbered when taken, never one of the reserved built-in ids. */
export function newAssistantId(name: string, existing: readonly Pick<Assistant, 'id'>[]): string {
  const base = slugify(name);
  return unique(reserved(base) ? `meu-${base}` : base, new Set(existing.map((item) => item.id)));
}

/**
 * The saved assistants, tolerant of what a repo can hold: a broken or foreign file is "none", a bad entry is skipped
 * (the rest still load), texts are trimmed and bounded, only known fields are read, and ids come out valid, unique and
 * never reserved (a missing or unusable one is derived from the name).
 */
export function parseAssistants(text: string | null): Assistant[] {
  if (!text || text.length > MAX_FILE) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).assistants) ? ((raw as Record<string, unknown>).assistants as unknown[]) : [];
  const out: Assistant[] = [];
  const taken = new Set<string>();
  for (const item of list.slice(0, MAX_SCANNED)) {
    if (out.length >= MAX_ASSISTANTS) break;
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    const name = typeof entry.name === 'string' ? cleanName(entry.name) : '';
    const instruction = typeof entry.instruction === 'string' ? cleanInstruction(entry.instruction) : '';
    if (!name || !instruction) continue;
    const given = typeof entry.id === 'string' && ASSISTANT_ID.test(entry.id) && !reserved(entry.id) ? entry.id : null;
    const id = given ? unique(given, taken) : unique(newAssistantId(name, []), taken);
    taken.add(id);
    out.push({ id, name, instruction, scope: entry.scope === 'workspace' ? 'workspace' : 'diagram', ...(entry.changes === true ? { changes: true as const } : {}) });
  }
  return out;
}

/** A pt-BR reason when the editor must not save this list, else `null`. */
export function validateAssistants(assistants: readonly Assistant[]): string | null {
  if (assistants.length > MAX_ASSISTANTS) return `No máximo ${MAX_ASSISTANTS} assistentes por workspace.`;
  const seen = new Set<string>();
  for (const item of assistants) {
    if (!item.name.trim()) return 'Dê um nome ao assistente.';
    if (item.name.trim().length > MAX_NAME) return `O nome passa de ${MAX_NAME} caracteres.`;
    if (!item.instruction.trim()) return 'Escreva a instrução do assistente.';
    if (item.instruction.trim().length > MAX_INSTRUCTION) return `A instrução passa de ${MAX_INSTRUCTION} caracteres.`;
    if (!ASSISTANT_ID.test(item.id)) return `Id inválido: "${item.id}".`;
    if (isReservedAssistantId(item.id)) return `O id "${item.id}" é reservado.`;
    if (seen.has(item.id)) return 'Há dois assistentes com o mesmo id.';
    seen.add(item.id);
  }
  return null;
}
