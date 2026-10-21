import { applyOps, own } from '@strukt/core';
import type { Connector, DiagramModel } from '@strukt/core';
import { stableStringify } from './json';

export interface SharedEntity { id: string; label?: string; tech?: string; description?: string; tags?: string[] }
export interface SharedRelation { id: string; from: string; to: string; connector: Connector; label?: string; tech?: string; description?: string }
export interface SharedModel {
  version: 1;
  entities: Record<string, SharedEntity>;
  views: Record<string, Record<string, string>>;
  relations?: Record<string, SharedRelation>;
  viewRelations?: Record<string, Record<string, string>>;
}

export const SHARED_PATH = 'model.json';
export const emptyShared = (): SharedModel => ({ version: 1, entities: {}, views: {} });

export function parseShared(text: string | null): SharedModel {
  if (!text) return emptyShared();
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return emptyShared(); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyShared();
  const value = raw as Record<string, unknown>;
  if (value.version !== 1 || !value.entities || typeof value.entities !== 'object' || !value.views || typeof value.views !== 'object') return emptyShared();
  const entities: SharedModel['entities'] = {};
  for (const [id, item] of Object.entries(value.entities)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !item || typeof item !== 'object') continue;
    const entity = item as Record<string, unknown>;
    entities[id] = { id, ...(typeof entity.label === 'string' ? { label: entity.label } : {}), ...(typeof entity.tech === 'string' ? { tech: entity.tech } : {}), ...(typeof entity.description === 'string' ? { description: entity.description } : {}), ...(Array.isArray(entity.tags) ? { tags: [...new Set(entity.tags.filter((tag): tag is string => typeof tag === 'string' && /^[a-z][a-z0-9_-]*:[^:\s]{1,64}$/i.test(tag)))].slice(0, 40) } : {}) };
  }
  const views: SharedModel['views'] = {};
  for (const [slug, mapping] of Object.entries(value.views)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(slug) || !mapping || typeof mapping !== 'object' || Array.isArray(mapping)) continue;
    views[slug] = {};
    for (const [local, id] of Object.entries(mapping)) if (local !== '__proto__' && typeof id === 'string' && own(entities, id)) views[slug]![local] = id;
  }
  const relations: Record<string, SharedRelation> = {};
  if (value.relations && typeof value.relations === 'object' && !Array.isArray(value.relations)) {
    for (const [id, item] of Object.entries(value.relations)) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !item || typeof item !== 'object' || Array.isArray(item)) continue;
      const relation = item as Record<string, unknown>;
      if (typeof relation.from !== 'string' || typeof relation.to !== 'string' || !own(entities, relation.from) || !own(entities, relation.to)) continue;
      if (!['>', '<', '<>', '-', '--', '-->'].includes(String(relation.connector))) continue;
      relations[id] = { id, from: relation.from, to: relation.to, connector: relation.connector as Connector, ...(typeof relation.label === 'string' ? { label: relation.label } : {}), ...(typeof relation.tech === 'string' ? { tech: relation.tech } : {}), ...(typeof relation.description === 'string' ? { description: relation.description } : {}) };
    }
  }
  const viewRelations: Record<string, Record<string, string>> = {};
  if (value.viewRelations && typeof value.viewRelations === 'object' && !Array.isArray(value.viewRelations)) {
    for (const [slug, mapping] of Object.entries(value.viewRelations)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(slug) || !mapping || typeof mapping !== 'object' || Array.isArray(mapping)) continue;
      viewRelations[slug] = {};
      for (const [edgeId, id] of Object.entries(mapping)) if (edgeId !== '__proto__' && typeof id === 'string' && own(relations, id)) viewRelations[slug]![edgeId] = id;
    }
  }
  return { version: 1, entities, views, ...(Object.keys(relations).length ? { relations } : {}), ...(Object.keys(viewRelations).length ? { viewRelations } : {}) };
}

export const printShared = (model: SharedModel) => stableStringify(model);

export function applyEntity(model: DiagramModel, localId: string, entity: SharedEntity): DiagramModel {
  if (!own(model.elements, localId)) return model;
  const result = applyOps(model, [{ op: 'update', id: localId, set: { label: entity.label ?? null, tech: entity.tech ?? null, description: entity.description ?? null } }]);
  return result.ok ? result.model : model;
}

export function applyRelation(model: DiagramModel, edgeId: string, relation: SharedRelation): DiagramModel {
  if (!model.edges.some((edge) => edge.id === edgeId)) return model;
  const result = applyOps(model, [{ op: 'update_edge', edgeId, set: { connector: relation.connector, label: relation.label ?? null } }]);
  return result.ok ? result.model : model;
}

export function followRelationIds(before: DiagramModel, after: DiagramModel, mapping: Readonly<Record<string, string>>, renames: ReadonlyMap<string, string> = new Map()): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [edgeId, relationId] of Object.entries(mapping)) {
    const edge = before.edges.find((item) => item.id === edgeId);
    if (!edge) continue;
    const nth = before.edges.filter((item) => item.from === edge.from && item.to === edge.to).findIndex((item) => item.id === edgeId);
    const from = renames.get(edge.from) ?? edge.from;
    const to = renames.get(edge.to) ?? edge.to;
    const survivor = after.edges.filter((item) => item.from === from && item.to === to)[nth];
    if (survivor) next[survivor.id] = relationId;
  }
  return next;
}
