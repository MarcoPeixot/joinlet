import { depthsOf, own } from '@strukt/core';
import type { DiagramModel, ID } from '@strukt/core';
import type { SharedModel } from './shared';

/**
 * C4 levels are a convention over the shared entities' tags (`nivel:contexto|container|componente`): no new
 * field in the model, so every file, diff and agent that already understands tags understands levels.
 */
export const LEVELS = ['contexto', 'container', 'componente'] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_KEY = 'nivel';
export const LEVEL_LABELS: Record<Level, string> = { contexto: 'Contexto', container: 'Container', componente: 'Componente' };

export const levelTag = (level: Level): string => `${LEVEL_KEY}:${level}`;

const isLevelTag = (tag: string) => tag.toLowerCase().startsWith(`${LEVEL_KEY}:`);

/** The level a tag list declares (the first valid `nivel:*` tag), if any. */
export function levelOf(tags: readonly string[] | undefined): Level | undefined {
  for (const tag of tags ?? []) {
    if (!isLevelTag(tag)) continue;
    const value = tag.slice(LEVEL_KEY.length + 1).toLowerCase();
    const level = LEVELS.find((candidate) => candidate === value);
    if (level) return level;
  }
  return undefined;
}

/** The tags with every `nivel:*` replaced by `level` (or dropped for null); other tags keep their order. */
export function withLevel(tags: readonly string[] | undefined, level: Level | null): string[] {
  const rest = (tags ?? []).filter((tag) => !isLevelTag(tag));
  return level ? [...rest, levelTag(level)] : rest;
}

export interface LevelProposal {
  id: ID;
  level: Level;
  /** Why, in words the person can disagree with. */
  reason: string;
}

/**
 * A level for every element that has none, from two things the diagram already says: how deep it sits in groups and
 * whether it names a technology.
 *
 * - a group at the top, or a loose top-level element without technology (a person, an external system): `contexto`;
 * - an element with technology at the top, a group or element one group deep: `container`;
 * - anything two or more groups deep: `componente`.
 *
 * It only proposes; the person accepts, changes or ignores each one. Elements that already have a level are skipped.
 */
export function suggestLevels(model: DiagramModel, current: (id: ID) => Level | undefined): LevelProposal[] {
  const depths = depthsOf(model);
  const proposals: LevelProposal[] = [];
  for (const id of model.order) {
    const el = own(model.elements, id);
    if (!el || current(id)) continue;
    const depth = depths.get(id) ?? 0;
    let level: Level;
    let reason: string;
    if (depth >= 2) {
      level = 'componente';
      reason = `Está dentro de ${depth} grupos: parte interna de um container.`;
    } else if (el.kind === 'group') {
      level = depth === 0 ? 'contexto' : 'container';
      reason = depth === 0 ? 'Grupo de topo: o sistema ou domínio inteiro.' : 'Grupo dentro de outro grupo: um container que reúne componentes.';
    } else if (depth === 1) {
      level = 'container';
      reason = 'Elemento dentro de um grupo de topo: uma parte executável do sistema.';
    } else if (el.tech) {
      level = 'container';
      reason = `Elemento solto com tecnologia (${el.tech}): um container.`;
    } else {
      level = 'contexto';
      reason = 'Elemento solto sem tecnologia: uma pessoa ou sistema externo.';
    }
    proposals.push({ id, level, reason });
  }
  return proposals;
}

/**
 * The shared model after giving each element its level (null clears it). An element not yet linked to an entity is
 * shared as a new one (`newId`), exactly as "Compartilhar" does, because tags live on entities; clearing a level of
 * an unlinked element changes nothing. Ids that are not in `model` are ignored.
 */
export function applyLevels(
  shared: SharedModel,
  slug: string,
  model: DiagramModel,
  levels: Readonly<Record<ID, Level | null>>,
  newId: () => string,
): SharedModel {
  const mapping = { ...own(shared.views, slug) };
  const entities = { ...shared.entities };
  let changed = false;
  for (const id of Object.keys(levels)) {
    const level = levels[id]!;
    const el = own(model.elements, id);
    if (!el) continue;
    let entityId = own(mapping, id);
    if (!entityId || !own(entities, entityId)) {
      if (!level) continue;
      entityId = newId();
      mapping[id] = entityId;
      entities[entityId] = { id: entityId, label: el.label ?? el.id, ...(el.tech ? { tech: el.tech } : {}), ...(el.description ? { description: el.description } : {}) };
    }
    const entity = entities[entityId]!;
    const tags = withLevel(entity.tags, level);
    const { tags: _old, ...rest } = entity;
    entities[entityId] = tags.length ? { ...rest, tags } : rest;
    changed = true;
  }
  return changed ? { ...shared, entities, views: { ...shared.views, [slug]: mapping } } : shared;
}
