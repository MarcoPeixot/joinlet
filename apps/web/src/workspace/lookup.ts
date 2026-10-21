import { own } from '@strukt/core';
import type { Evidence, Flow, Perspective, WorkspaceData } from '@strukt/workspace';

/**
 * Name-keyed reads of the workspace maps. Diagram slugs and element ids are user text (`constructor`, `toString`
 * are valid), so a bare `map[key]` would answer with an Object.prototype member: always go through these.
 */
type Data = Pick<WorkspaceData, 'flows' | 'evidence' | 'perspectives'> | null | undefined;

export const flowsFor = (data: Data, slug: string | null | undefined): Flow[] | undefined =>
  data?.flows && slug != null ? own(data.flows, slug) : undefined;

export const perspectivesFor = (data: Data, slug: string | null | undefined): Perspective[] | undefined =>
  data?.perspectives && slug != null ? own(data.perspectives, slug) : undefined;

export const evidenceFor = (data: Data, slug: string | null | undefined): Record<string, Evidence[]> | undefined =>
  data?.evidence && slug != null ? own(data.evidence, slug) : undefined;

export const refsFor = (data: Data, slug: string | null | undefined, id: string): Evidence[] | undefined => {
  const byId = evidenceFor(data, slug);
  return byId ? own(byId, id) : undefined;
};
