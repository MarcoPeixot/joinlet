import type { DiagramModel } from '@strukt/core';
import { own } from '@strukt/core';
import { diagramSlugOf, docSlugOf } from '@strukt/workspace';

export interface HoverCardInfo {
  title: string;
  tech?: string;
  excerpt?: string;
  /** "doc" or "diagram" when the element links somewhere the workspace can open. */
  link?: 'doc' | 'diagram';
  connections: number;
}

const EXCERPT_MAX = 120;

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= EXCERPT_MAX ? flat : `${flat.slice(0, EXCERPT_MAX - 1).trimEnd()}…`;
}

/** What the hover card shows for `id`; null for an id that is not in the model (ghosts, removed elements). */
export function hoverCardInfo(model: DiagramModel, id: string): HoverCardInfo | null {
  const el = own(model.elements, id);
  if (!el) return null;
  const connections = model.edges.reduce((count, edge) => count + (edge.from === id || edge.to === id ? 1 : 0), 0);
  return {
    title: el.label ?? el.id,
    tech: el.tech?.trim() || undefined,
    excerpt: el.description?.trim() ? excerpt(el.description) : undefined,
    link: diagramSlugOf(el.link) ? 'diagram' : docSlugOf(el.link) ? 'doc' : undefined,
    connections,
  };
}
