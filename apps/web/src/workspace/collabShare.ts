import { own, reuseUnchanged } from '@strukt/core';
import type { NodeBox } from '@strukt/core';
import type { Snapshot } from '../state/diagramStore';

function reuseBoxes(prev: Record<string, NodeBox>, next: Record<string, NodeBox>): Record<string, NodeBox> {
  const out: Record<string, NodeBox> = {};
  let same = Object.keys(prev).length === Object.keys(next).length;
  for (const [id, box] of Object.entries(next)) {
    const old = own(prev, id);
    if (old && old.x === box.x && old.y === box.y && old.w === box.w && old.h === box.h) out[id] = old;
    else { out[id] = box; same = false; }
  }
  return same ? prev : out;
}

/** The remote snapshot re-expressed over `prev`: unchanged elements/boxes keep identity; unchanged routes are kept. */
export function shareWithPrevious(prev: Snapshot, next: Snapshot): Snapshot {
  const model = reuseUnchanged(prev.model, next.model);
  const nodes = reuseBoxes(prev.layout.nodes, next.layout.nodes);
  const routesStillValid = nodes === prev.layout.nodes && model.edges === prev.model.edges;
  const layout = nodes === prev.layout.nodes && routesStillValid ? prev.layout : { nodes, edges: routesStillValid ? prev.layout.edges : {} };
  return { model, layout };
}

