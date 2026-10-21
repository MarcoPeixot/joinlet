import { RESERVED_NAME, own } from '@strukt/core';
import type { DiagramElement, DiagramModel, EdgeEl } from '@strukt/core';
import { parseDiagramJson, printDiagramJson } from '@strukt/json';
import { stableStringify } from './json';

/** `.arch/sync.json`: what the last `joinlet sync` imported from each source (the base of the three-way merge). */
export const SYNC_PATH = 'sync.json';
export const SYNC_STATE_VERSION = 1;

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export interface SyncStateEntry {
  /** Diagram the source fed when it was last synced; a source pointed elsewhere starts over. */
  diagram: string;
  /** The model the importers produced then (canonical diagram JSON in the file). */
  base: DiagramModel;
}

export interface SyncState {
  version: typeof SYNC_STATE_VERSION;
  sources: Record<string, SyncStateEntry>;
}

export const emptySyncState = (): SyncState => ({ version: SYNC_STATE_VERSION, sources: {} });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A model read back from the file carries parser spans; the base only needs meaning. */
function withoutSpans(model: DiagramModel): DiagramModel {
  const elements: Record<string, DiagramElement> = {};
  for (const id of model.order) {
    const el = own(model.elements, id);
    if (!el) continue;
    const { span: _span, ...rest } = el;
    elements[id] = rest as DiagramElement;
  }
  return { ...model, elements, edges: model.edges.map(({ span: _span, ...edge }): EdgeEl => edge), diagnostics: [] };
}

/** Lenient: a damaged file or entry becomes "never synced" (a warning), never a crash. */
export function parseSyncState(text: string | null): { state: SyncState; warnings: string[] } {
  const state = emptySyncState();
  if (text === null) return { state, warnings: [] };
  const warnings: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { state, warnings: [`${SYNC_PATH}: JSON inválido; a próxima sincronização trata as fontes como novas.`] };
  }
  if (!isRecord(raw) || raw.version !== SYNC_STATE_VERSION || !isRecord(raw.sources)) {
    return { state, warnings: [`${SYNC_PATH}: formato não reconhecido; a próxima sincronização trata as fontes como novas.`] };
  }
  for (const [id, entry] of Object.entries(raw.sources)) {
    if (id === RESERVED_NAME || !ID.test(id)) continue;
    if (!isRecord(entry) || typeof entry.diagram !== 'string' || !SLUG.test(entry.diagram) || !isRecord(entry.base)) {
      warnings.push(`${SYNC_PATH}: entrada "${id}" inválida; a fonte será tratada como nova.`);
      continue;
    }
    const parsed = parseDiagramJson(JSON.stringify(entry.base));
    if (parsed.diagnostics.some((d) => d.severity === 'error')) {
      warnings.push(`${SYNC_PATH}: a base de "${id}" está inválida; a fonte será tratada como nova.`);
      continue;
    }
    state.sources[id] = { diagram: entry.diagram, base: withoutSpans(parsed.model) };
  }
  return { state, warnings };
}

/** Canonical text: sources sorted by id, each base printed as canonical diagram JSON. */
export function printSyncState(state: SyncState): string {
  const sources: Record<string, unknown> = {};
  for (const id of Object.keys(state.sources).sort()) {
    const entry = state.sources[id]!;
    const { $schema: _schema, ...base } = JSON.parse(printDiagramJson(entry.base)) as Record<string, unknown>;
    sources[id] = { diagram: entry.diagram, base };
  }
  return stableStringify({ version: SYNC_STATE_VERSION, sources });
}
