import { stableStringify } from './json';

export interface Concern {
  id: string;
  diagram: string;
  element?: string;
  message: string;
  status: 'open' | 'resolved';
  createdAt: string;
  /** The Jira task created from this concern (Configurações › Integrações); only the key and its browse link. */
  issue?: { key: string; url: string };
}

/** A Jira link read from the repo is untrusted: only a `https://<site>.atlassian.net/browse/<KEY>` whose key matches survives. */
function parseIssue(value: unknown): Concern['issue'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { key, url } = value as Record<string, unknown>;
  if (typeof key !== 'string' || typeof url !== 'string' || !/^[A-Z][A-Z0-9_]{1,19}-\d{1,9}$/.test(key)) return undefined;
  const match = /^https:\/\/[a-z0-9][a-z0-9-]{0,62}\.atlassian\.net\/browse\/([A-Z][A-Z0-9_]{1,19}-\d{1,9})$/.exec(url);
  return match?.[1] === key ? { key, url } : undefined;
}

export const CONCERNS_PATH = 'concerns.json';

export function parseConcerns(text: string | null): Concern[] {
  if (!text) return [];
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.flatMap((item): Concern[] => {
    if (!item || typeof item !== 'object') return [];
    const value = item as Record<string, unknown>;
    if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.id) || seen.has(value.id)) return [];
    if (typeof value.diagram !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value.diagram)) return [];
    if (typeof value.message !== 'string' || !value.message.trim()) return [];
    seen.add(value.id);
    const issue = parseIssue(value.issue);
    return [{ id: value.id, diagram: value.diagram, ...(typeof value.element === 'string' ? { element: value.element } : {}), message: value.message.slice(0, 1000), status: value.status === 'resolved' ? 'resolved' : 'open', createdAt: typeof value.createdAt === 'string' && !Number.isNaN(Date.parse(value.createdAt)) ? value.createdAt : '1970-01-01T00:00:00.000Z', ...(issue ? { issue } : {}) }];
  });
}

export const printConcerns = (concerns: readonly Concern[]) => stableStringify(concerns);
export const openConcerns = (concerns: readonly Concern[] | undefined, diagram?: string) => (concerns ?? []).filter((item) => item.status === 'open' && (!diagram || item.diagram === diagram));
