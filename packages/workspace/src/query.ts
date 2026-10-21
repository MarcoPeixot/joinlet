import { own } from '@strukt/core';
import type { DiagramModel, EdgeEl } from '@strukt/core';
import { openConcerns } from './concerns';
import type { WorkspaceData } from './workspace';

export function diagramElement(data: WorkspaceData, diagram: string, id: string) {
  return own(own(data.diagrams, diagram)?.model.elements ?? {}, id);
}

export function graphNeighbors(model: DiagramModel, id: string, depth = 1): { nodes: string[]; edges: EdgeEl[] } {
  if (!own(model.elements, id)) return { nodes: [], edges: [] };
  const seen = new Set([id]);
  const found = new Set<string>();
  let frontier = [id];
  for (let step = 0; step < depth && frontier.length; step++) {
    const next: string[] = [];
    for (const edge of model.edges) {
      if (!frontier.includes(edge.from) && !frontier.includes(edge.to)) continue;
      found.add(edge.id);
      for (const endpoint of [edge.from, edge.to]) if (!seen.has(endpoint)) { seen.add(endpoint); next.push(endpoint); }
    }
    frontier = next;
  }
  return { nodes: model.order.filter((node) => seen.has(node)), edges: model.edges.filter((edge) => found.has(edge.id)) };
}

export function graphPath(model: DiagramModel, from: string, to: string): EdgeEl[] | null {
  if (!own(model.elements, from) || !own(model.elements, to)) return null;
  const queue = [from];
  const previous = new Map<string, EdgeEl>();
  const seen = new Set([from]);
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!;
    if (current === to) break;
    for (const edge of model.edges) {
      const forward = edge.connector !== '<';
      const backward = edge.connector === '<' || edge.connector === '<>' || edge.connector === '-' || edge.connector === '--';
      const next = forward && edge.from === current ? edge.to : backward && edge.to === current ? edge.from : null;
      if (!next || seen.has(next)) continue;
      seen.add(next);
      previous.set(next, edge);
      queue.push(next);
    }
  }
  if (!seen.has(to)) return null;
  const path: EdgeEl[] = [];
  for (let at = to; at !== from;) {
    const edge = previous.get(at)!;
    path.unshift(edge);
    at = edge.to === at ? edge.from : edge.to;
  }
  return path;
}

export function focusedContext(data: WorkspaceData, diagram: string, id?: string): string | null {
  const entry = data.manifest.diagrams.find((item) => item.slug === diagram);
  const model = own(data.diagrams, diagram)?.model;
  if (!entry || !model || (id && !own(model.elements, id))) return null;
  const selection = id ? graphNeighbors(model, id, 1) : { nodes: model.order, edges: model.edges };
  const lines = [`# ${entry.title}`, '', `Diagrama: .arch/diagrams/${diagram}.strukt.json`, '', '## Componentes', ''];
  for (const node of selection.nodes) {
    const el = model.elements[node]!;
    const entityId = own(data.shared?.views[diagram] ?? {}, node);
    lines.push(`- ${el.label ?? node}${entityId ? ` [entidade: ${entityId}]` : ''}${el.tech ? ` — ${el.tech}` : ''}${el.description ? `: ${el.description}` : ''}`);
  }
  lines.push('', '## Conexões', '');
  for (const edge of selection.edges) {
    const relation = own(data.shared?.viewRelations?.[diagram] ?? {}, edge.id);
    lines.push(`- ${edge.from} ${edge.connector} ${edge.to}${edge.label ? ` — ${edge.label}` : ''}${relation ? ` [relação: ${relation}]` : ''}`);
  }
  const refs = own(data.evidence ?? {}, diagram) ?? {};
  const selected = selection.nodes.flatMap((node) => (own(refs, node) ?? []).map((ref) => `${node}: ${ref.path}${ref.line ? `#L${ref.line}` : ''}`));
  if (selected.length) lines.push('', '## Evidências', '', ...selected.map((ref) => `- ${ref}`));
  const concerns = openConcerns(data.concerns, diagram).filter((item) => !id || item.element === id || !item.element);
  if (concerns.length) lines.push('', '## Pendências de precisão', '', ...concerns.map((item) => `- ${item.element ? `${item.element}: ` : ''}${item.message}`));
  return `${lines.join('\n')}\n`;
}

export interface ModelReference { diagram: string; localId: string }
export interface ModelDependency { key: string; label: string; diagram: string }
export interface ModelIndexEntry {
  key: string;
  label: string;
  tech?: string;
  description?: string;
  views: ModelReference[];
  incoming: ModelDependency[];
  outgoing: ModelDependency[];
  tags: string[];
}

export function modelIndex(data: WorkspaceData): ModelIndexEntry[] {
  const entries = new Map<string, ModelIndexEntry>();
  for (const entity of Object.values(data.shared?.entities ?? {})) {
    entries.set(entity.id, { key: entity.id, label: entity.label ?? entity.id, tech: entity.tech, description: entity.description, views: [], incoming: [], outgoing: [], tags: entity.tags ?? [] });
  }
  const keyOf = (diagram: string, localId: string) => own(data.shared?.views[diagram] ?? {}, localId) ?? `${diagram}:${localId}`;
  for (const { slug } of data.manifest.diagrams) {
    const model = own(data.diagrams, slug)?.model;
    if (!model) continue;
    for (const id of model.order) {
      const el = model.elements[id]!;
      const key = keyOf(slug, id);
      const entry = entries.get(key) ?? { key, label: el.label ?? id, tech: el.tech, description: el.description, views: [], incoming: [], outgoing: [], tags: [] };
      if (entry.label === key) entry.label = el.label ?? id;
      entry.views.push({ diagram: slug, localId: id });
      entries.set(key, entry);
    }
  }
  const seen = new Set<string>();
  for (const { slug } of data.manifest.diagrams) {
    const model = own(data.diagrams, slug)?.model;
    if (!model) continue;
    for (const edge of model.edges) {
      const from = keyOf(slug, edge.from);
      const to = keyOf(slug, edge.to);
      const relation = own(data.shared?.viewRelations?.[slug] ?? {}, edge.id);
      const identity = relation ?? `${slug}:${edge.id}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const left = entries.get(from);
      const right = entries.get(to);
      if (!left || !right) continue;
      left.outgoing.push({ key: to, label: edge.label ?? '', diagram: slug });
      right.incoming.push({ key: from, label: edge.label ?? '', diagram: slug });
    }
  }
  return [...entries.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR') || a.key.localeCompare(b.key));
}

export function impactedBy(index: readonly ModelIndexEntry[], key: string): string[] {
  const byKey = new Map(index.map((entry) => [entry.key, entry]));
  if (!byKey.has(key)) return [];
  const seen = new Set([key]);
  const queue = [key];
  for (let i = 0; i < queue.length; i++) {
    for (const dependency of byKey.get(queue[i]!)?.incoming ?? []) {
      if (seen.has(dependency.key)) continue;
      seen.add(dependency.key);
      queue.push(dependency.key);
    }
  }
  return queue.slice(1);
}

/** Lowercase, accent-free form used for matching (no regex is ever built from user text). */
export function foldSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Subsequence test ("pgto" in "pagamento"); only for needles of 3+ characters. */
function isSubsequence(needle: string, haystack: string): boolean {
  let at = 0;
  for (const char of haystack) if (char === needle[at] && ++at === needle.length) return true;
  return needle.length === 0;
}

export interface ModelSearchHit {
  diagram: string;
  id: string;
  kind: 'node' | 'group';
  label?: string;
  tech?: string;
  description?: string;
  tags: string[];
  evidence: number;
  degree: number;
  score: number;
}

export interface ModelSearchOptions { query: string; diagram?: string; limit?: number }

/**
 * Case/diacritics-insensitive search over the elements of every diagram (or one): id, label, tech,
 * description and shared-entity tags. Ordered by score (desc), then diagram slug, then id.
 */
export function searchModel(data: WorkspaceData, { query, diagram, limit = 20 }: ModelSearchOptions): ModelSearchHit[] {
  const needle = foldSearch(query.trim());
  if (!needle) return [];
  const slugs = diagram === undefined ? data.manifest.diagrams.map((item) => item.slug) : [diagram];
  const hits: ModelSearchHit[] = [];
  for (const slug of slugs) {
    const model = own(data.diagrams, slug)?.model;
    if (!model) continue;
    const views = own(data.shared?.views ?? {}, slug) ?? {};
    const refs = own(data.evidence ?? {}, slug) ?? {};
    const degree = new Map<string, number>();
    for (const edge of model.edges) for (const end of new Set([edge.from, edge.to])) degree.set(end, (degree.get(end) ?? 0) + 1);
    for (const id of model.order) {
      const el = own(model.elements, id);
      if (!el) continue;
      const entity = own(views, id);
      const tags = (entity ? own(data.shared?.entities ?? {}, entity)?.tags : undefined) ?? [];
      const score = scoreElement(needle, id, el.label, el.tech, el.description, tags);
      if (score === 0) continue;
      hits.push({ diagram: slug, id, kind: el.kind, label: el.label, tech: el.tech, description: el.description, tags: [...tags], evidence: (own(refs, id) ?? []).length, degree: degree.get(id) ?? 0, score });
    }
  }
  return hits.sort((a, b) => b.score - a.score || (a.diagram < b.diagram ? -1 : a.diagram > b.diagram ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, Math.max(0, limit));
}

function scoreElement(needle: string, id: string, label?: string, tech?: string, description?: string, tags: readonly string[] = []): number {
  const fields: [string | undefined, number][] = [[id, 100], [label, 100], [tech, 50], [tags.join(' '), 45], [description, 30]];
  let best = 0;
  for (const [raw, weight] of fields) {
    if (!raw) continue;
    const text = foldSearch(raw);
    const at = text.indexOf(needle);
    if (at < 0) continue;
    const bonus = text === needle ? 3 : at === 0 ? 2 : 1;
    best = Math.max(best, weight * bonus);
  }
  if (best > 0 || needle.length < 3) return best;
  return [id, label].some((raw) => raw && isSubsequence(needle, foldSearch(raw))) ? 10 : 0;
}
