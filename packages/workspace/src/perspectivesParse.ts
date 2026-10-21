import type { ID } from '@strukt/core';
import { LEVELS } from './levels';
import { PERSPECTIVE_ID_MAX } from './perspectives';
import type { Perspective } from './perspectives';

export const PERSPECTIVE_LIMITS = { perspectives: 40, id: PERSPECTIVE_ID_MAX, name: 60, description: 300, tags: 20, nodes: 500, nodeId: 128, bytes: 2_000_000 } as const;

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const TAG_PATTERN = /^[a-z][a-z0-9_-]*:[^:\s]{1,64}$/i;

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, max).trim();
  return trimmed || undefined;
};

function nodeIds(value: unknown): ID[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= PERSPECTIVE_LIMITS.nodeId && id !== '__proto__'))].slice(0, PERSPECTIVE_LIMITS.nodes);
  return ids.length ? ids : undefined;
}

/** One perspective from untrusted JSON, or null. Defaults and empty lists are left out, so printing is canonical. */
function clean(raw: unknown): Perspective | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== 'string') return null;
  const id = item.id.trim().toLowerCase();
  if (id.length > PERSPECTIVE_ID_MAX || !ID_PATTERN.test(id)) return null;
  const description = text(item.description, PERSPECTIVE_LIMITS.description);
  const tags = Array.isArray(item.tags) ? [...new Set(item.tags.filter((tag): tag is string => typeof tag === 'string' && TAG_PATTERN.test(tag)))].slice(0, PERSPECTIVE_LIMITS.tags) : [];
  const levels = Array.isArray(item.levels) ? LEVELS.filter((level) => (item.levels as unknown[]).includes(level)) : [];
  const include = nodeIds(item.include);
  const hide = nodeIds(item.hide);
  const collapsed = nodeIds(item.collapsed);
  return {
    id,
    name: text(item.name, PERSPECTIVE_LIMITS.name) ?? id,
    ...(description ? { description } : {}),
    ...(tags.length ? { tags } : {}),
    ...(levels.length ? { levels } : {}),
    ...(include ? { include } : {}),
    ...(hide ? { hide } : {}),
    ...(collapsed ? { collapsed } : {}),
    ...(item.mode === 'dim' ? { mode: 'dim' as const } : {}),
    ...(item.collapse === true ? { collapse: true } : {}),
  };
}

/** Never throws: bad text, a bad item or a duplicate id is dropped; over a limit is cut. */
export function parsePerspectives(source: string | null): Perspective[] {
  if (!source || source.length > PERSPECTIVE_LIMITS.bytes) return [];
  let raw: unknown;
  try { raw = JSON.parse(source); } catch { return []; }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? (raw as Record<string, unknown>).perspectives : undefined;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const result: Perspective[] = [];
  for (const item of list) {
    const perspective = clean(item);
    if (!perspective || seen.has(perspective.id)) continue;
    seen.add(perspective.id);
    result.push(perspective);
    if (result.length >= PERSPECTIVE_LIMITS.perspectives) break;
  }
  return result;
}

