import { DEFAULT_STYLE, emptyModel, normalizeEdgeIds } from '@strukt/core';
import type { Snapshot } from './diagramStore';

/** The single scratch diagram autosaved by M1–M3; M4 migrates it into the first workspace. */
const KEY = 'strukt:scratch:v1';

export function loadSnapshot(): Snapshot | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<Snapshot>;
    const model = data.model;
    if (!model?.elements || !Array.isArray(model.order) || !Array.isArray(model.edges) || !data.layout?.nodes) return null;
    return {
      model: normalizeEdgeIds({ ...emptyModel(), ...model, style: { ...DEFAULT_STYLE, ...model.style } }),
      layout: { nodes: data.layout.nodes, edges: {} },
    };
  } catch {
    return null;
  }
}

/** Called once the scratch diagram lives in a workspace. */
export function clearSnapshot(): void {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    // storage blocked: nothing to clear
  }
}
