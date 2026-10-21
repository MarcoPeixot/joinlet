import { asArray, asString, cleanText, isRecord, pick } from '../common';
import { kindByType } from './kinds';
import { safeValue, secretKey } from './safe';
import type { CloudAttrs, CloudGraph, CloudOrigin, CloudResource, CloudScope } from './types';

/** `.arch/cloud.json`: which cloud resource each imported diagram element stands for, and what it looked like when imported. */
export const CLOUD_STATE_PATH = 'cloud.json';

export interface TrackedResource {
  /** Canonical id (ARN, Azure resource id, GCP full name). */
  id: string;
  type: string;
  name: string;
  /** Element id in the diagram; absent for resources that are tracked but not drawn (security groups…). */
  node?: string;
  attrs: CloudAttrs;
  links: string[];
}

export interface CloudSource {
  /** Diagram slug. */
  diagram: string;
  origin: CloudOrigin;
  /** Never holds a profile or any credential: only what narrows the listing (region, subscription, project). */
  scope: CloudScope;
  resources: TrackedResource[];
}

export interface CloudState {
  version: 1;
  sources: CloudSource[];
}

export const emptyCloudState = (): CloudState => ({ version: 1, sources: [] });

const MAX_STATE = 20_000_000;
const MAX_SOURCES = 200;
const MAX_TRACKED = 20_000;
const ORIGINS: readonly string[] = ['aws', 'azure', 'gcp', 'terraform'];

export function trackResources(graph: CloudGraph, nodes: ReadonlyMap<string, string>): TrackedResource[] {
  return graph.resources.map((resource) => ({
    id: resource.id,
    type: resource.type,
    name: resource.name,
    ...(nodes.has(resource.id) ? { node: nodes.get(resource.id)! } : {}),
    attrs: sortedAttrs(resource.attrs),
    links: [...resource.links].sort(),
  }));
}

function sortedAttrs(attrs: CloudAttrs): CloudAttrs {
  return Object.fromEntries(Object.entries(attrs).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** Replaces the source of the same diagram, or appends it; sources stay ordered by slug. */
export function withSource(state: CloudState, source: CloudSource): CloudState {
  const others = state.sources.filter((entry) => entry.diagram !== source.diagram);
  return { version: 1, sources: [...others, source].sort((a, b) => (a.diagram < b.diagram ? -1 : a.diagram > b.diagram ? 1 : 0)) };
}

export function printCloudState(state: CloudState): string {
  const sources = state.sources.map((source) => ({
    diagram: source.diagram,
    origin: source.origin,
    scope: Object.fromEntries(Object.entries(source.scope).filter(([, value]) => value !== undefined)),
    resources: [...source.resources].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((resource) => ({
      id: resource.id,
      type: resource.type,
      name: resource.name,
      ...(resource.node ? { node: resource.node } : {}),
      ...(Object.keys(resource.attrs).length ? { attrs: sortedAttrs(resource.attrs) } : {}),
      ...(resource.links.length ? { links: [...resource.links].sort() } : {}),
    })),
  }));
  return `${JSON.stringify({ version: 1, sources }, null, 2)}\n`;
}

/** Tolerant reader: whatever is valid is kept, and each problem becomes a pt-BR message instead of an exception. */
export function parseCloudState(text: string | null): { state: CloudState; errors: string[] } {
  if (text === null) return { state: emptyCloudState(), errors: [] };
  const errors: string[] = [];
  if (text.length > MAX_STATE) return { state: emptyCloudState(), errors: ['cloud.json grande demais.'] };
  let json: unknown;
  try { json = JSON.parse(text); } catch { return { state: emptyCloudState(), errors: ['cloud.json não é um JSON válido.'] }; }
  if (!isRecord(json) || pick(json, 'version') !== 1) return { state: emptyCloudState(), errors: ['cloud.json: versão desconhecida (esperado version 1).'] };
  const sources: CloudSource[] = [];
  for (const raw of asArray(pick(json, 'sources'), MAX_SOURCES)) {
    const diagram = asString(pick(raw, 'diagram'));
    const origin = asString(pick(raw, 'origin'));
    if (!diagram || !origin || !ORIGINS.includes(origin)) { errors.push('cloud.json: fonte sem diagrama ou com origem inválida foi ignorada.'); continue; }
    const scopeRaw = pick(raw, 'scope');
    const scope: CloudScope = {};
    for (const key of ['region', 'subscription', 'resourceGroup', 'project'] as const) {
      const value = asString(pick(scopeRaw, key));
      if (value) scope[key] = cleanText(value, 120);
    }
    const resources: TrackedResource[] = [];
    for (const entry of asArray(pick(raw, 'resources'), MAX_TRACKED)) {
      const id = asString(pick(entry, 'id'));
      const type = asString(pick(entry, 'type'));
      if (!id || !type || id === '__proto__') continue;
      const attrs: CloudAttrs = {};
      const rawAttrs = pick(entry, 'attrs');
      if (isRecord(rawAttrs)) for (const [key, value] of Object.entries(rawAttrs).slice(0, 50)) { const safe = safeValue(value); if (safe !== undefined && key !== '__proto__' && !secretKey(key)) attrs[key] = safe; }
      const node = asString(pick(entry, 'node'));
      resources.push({
        id, type, name: asString(pick(entry, 'name')) ?? id, attrs,
        ...(node ? { node } : {}),
        links: asArray(pick(entry, 'links'), 500).filter((link): link is string => typeof link === 'string'),
      });
    }
    sources.push({ diagram, origin: origin as CloudOrigin, scope, resources });
  }
  return { state: { version: 1, sources }, errors };
}

/** `truncated` is informational: it never fails `--strict`. */
export type CloudDriftKind = 'added' | 'removed' | 'changed' | 'truncated';

export interface CloudDriftFinding {
  kind: CloudDriftKind;
  diagram: string;
  id: string;
  type: string;
  message: string;
}

const MAX_FINDINGS = 500;

/** Live resources that belong to what the source imported: the same provider, and the region it was scoped to. */
function inScope(resource: CloudResource, source: CloudSource): boolean {
  if (source.origin !== 'terraform' && resource.provider !== source.origin) return false;
  const { scope } = source;
  if (scope.region && resource.region && resource.region !== scope.region) return false;
  if (resource.provider === 'azure') {
    if (scope.resourceGroup && resource.scope && resource.scope.toLowerCase() !== scope.resourceGroup.toLowerCase()) return false;
    const subscription = /^\/subscriptions\/([^/]+)\//.exec(resource.id)?.[1];
    if (scope.subscription && subscription && /^[0-9a-f-]{36}$/i.test(scope.subscription) && subscription !== scope.subscription.toLowerCase()) return false;
  }
  return !(resource.provider === 'gcp' && scope.project && resource.scope && resource.scope !== scope.project);
}

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Compares one imported diagram with a live graph. Resources a person deleted from the diagram (`curated`) are left
 * alone: that was a decision, not drift. Across origins (a Terraform file against a CLI import) only kinds both sides
 * know are compared, on the attributes both sides carry, and relations are skipped because each origin derives them
 * from different data.
 */
export function compareCloud(source: CloudSource, live: CloudGraph, curated: ReadonlySet<string> = new Set()): CloudDriftFinding[] {
  const cross = source.origin !== live.origin;
  const unreadable = new Set(live.unreadable ?? []);
  const keep = (type: string): boolean => !unreadable.has(type) && (!cross || kindByType(type) !== undefined);
  const tracked = new Map(source.resources.filter((resource) => keep(resource.type) && !curated.has(resource.id)).map((resource) => [resource.id, resource] as const));
  const current = new Map(live.resources.filter((resource) => inScope(resource, source) && keep(resource.type)).map((resource) => [resource.id, resource] as const));
  const findings: CloudDriftFinding[] = [];
  const push = (kind: CloudDriftKind, id: string, type: string, message: string) => { if (findings.length < MAX_FINDINGS) findings.push({ kind, diagram: source.diagram, id, type, message }); };
  const label = (name: string, id: string) => `${cleanText(name, 80)} (${cleanText(id, 160)})`;

  for (const resource of [...current.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const before = tracked.get(resource.id);
    if (!before) { push('added', resource.id, resource.type, `adicionado na nuvem e ausente do diagrama "${source.diagram}": ${resource.type} ${label(resource.name, resource.id)}`); continue; }
    const details: string[] = [];
    for (const key of [...new Set([...Object.keys(before.attrs), ...Object.keys(resource.attrs)])].sort()) {
      const was = Object.hasOwn(before.attrs, key) ? before.attrs[key] : undefined;
      const now = Object.hasOwn(resource.attrs, key) ? resource.attrs[key] : undefined;
      if (cross && (was === undefined || now === undefined)) continue;
      if (was !== now) details.push(`${key}: ${was === undefined ? '(ausente)' : String(was)} → ${now === undefined ? '(ausente)' : String(now)}`);
    }
    if (!cross) {
      const beforeLinks = before.links.filter((id) => tracked.has(id)).sort();
      const nowLinks = resource.links.filter((id) => current.has(id)).sort();
      if (!same(beforeLinks, nowLinks)) {
        const plus = nowLinks.filter((id) => !beforeLinks.includes(id)).length;
        const minus = beforeLinks.filter((id) => !nowLinks.includes(id)).length;
        details.push(`relações: +${plus} −${minus}`);
      }
    }
    if (details.length) push('changed', resource.id, resource.type, `alterado na nuvem: ${resource.type} ${label(resource.name, resource.id)} — ${details.join('; ')}`);
  }
  for (const resource of [...tracked.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!current.has(resource.id)) push('removed', resource.id, resource.type, `removido da nuvem, ainda no diagrama "${source.diagram}": ${resource.type} ${label(resource.name, resource.id)}`);
  }
  if (findings.length >= MAX_FINDINGS) findings.push({ kind: 'truncated', diagram: source.diagram, id: '', type: '', message: `Mais de ${MAX_FINDINGS} diferenças: o restante foi omitido.` });
  return findings;
}
