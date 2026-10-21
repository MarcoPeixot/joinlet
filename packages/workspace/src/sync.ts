import { applyOps, compareModels, own, renamesIn } from '@strukt/core';
import type { DiagramModel, DiagramOp, ModelChanges } from '@strukt/core';
import { SOURCES_PATH, describeProblem, parseSources, validateSourceTargets } from './sources';
import type { Source, SourceDiagnostic } from './sources';
import { importSource } from './syncFiles';
import type { ImportDeps } from './syncFiles';
import { mergeIntoDiagram, unionModels } from './syncMerge';
import type { MergeNote } from './syncMerge';
import { SYNC_PATH, emptySyncState, parseSyncState, printSyncState } from './syncState';
import type { SyncState } from './syncState';
import type { StorageAdapter } from './storage';
import type { WorkspaceData } from './workspace';

export { SOURCES_PATH, SYNC_PATH };
export { implementationPlan } from './implementationPlan';
export { collectSourceFiles, importSource, SKIPPED_DIRECTORIES } from './syncFiles';
export type { ImportDeps, SourceImport } from './syncFiles';
export { mergeIntoDiagram, unionModels } from './syncMerge';
export type { MergeNote, MergeNoteKind, MergeResult } from './syncMerge';
export { renderSyncReport } from './syncReport';
export type { SyncReportFormat } from './syncReport';
export { describeProblem } from './sources';
export { emptySyncState, parseSyncState, printSyncState } from './syncState';
export type { SyncState, SyncStateEntry } from './syncState';

export interface SourceReport {
  id: string;
  kind: Source['kind'];
  diagram: string;
  mode: Source['mode'];
  files: string[];
  /** Importer notices (`file:line: message`). */
  warnings: string[];
  /** Blocks the diagram this source feeds. */
  error?: string;
}

export interface DiagramSyncPlan {
  slug: string;
  title: string;
  mode: Source['mode'];
  sources: string[];
  /** A source failed: the diagram, and the base of its sources, stay as they are. */
  blocked: boolean;
  /** To apply on the diagram (`planSnapshot` also places the new nodes). */
  ops: DiagramOp[];
  /** The diagram as it is now. */
  before: DiagramModel;
  /** The diagram after `ops` (the current one when blocked). */
  model: DiagramModel;
  /** What `ops` change, classified the way `joinlet diff` and the app's draft overlay do. */
  changes: ModelChanges;
  notes: MergeNote[];
  /** Imported source and previous sync base, for an agent to inspect both directions without writing code. */
  sourceModel?: DiagramModel;
  baseline?: DiagramModel;
}

export interface SyncPlan {
  /** `.arch/sources.json` exists. */
  configured: boolean;
  /** Problems of the file itself; with any, nothing else is planned. */
  problems: SourceDiagnostic[];
  sources: SourceReport[];
  diagrams: DiagramSyncPlan[];
  /** Notices about `sync.json` (damaged entries read as new sources). */
  stateWarnings: string[];
  /** The next `sync.json`; `changed` when it differs from what is on disk. */
  state: { text: string; changed: boolean };
  /** Syncing would write something. */
  stale: boolean;
  /** Everything that blocks, flattened and in pt-BR. */
  errors: string[];
}

export interface SyncInput {
  /** Repository root (the folder that holds `.arch/`). */
  root: string;
  adapter: StorageAdapter;
  data: WorkspaceData;
}

const noChanges = (): ModelChanges => ({ elements: { added: [], removed: [], changed: [] }, edges: { added: [], removed: [], changed: [] }, renamed: {}, style: false });

const empty = (configured: boolean, problems: SourceDiagnostic[], errors: string[]): SyncPlan => ({
  configured, problems, sources: [], diagrams: [], stateWarnings: [], state: { text: '', changed: false }, stale: false, errors,
});

/**
 * Reads `.arch/sources.json` and the repository, and plans (without writing anything) what `joinlet sync` would do:
 * per diagram the ops to apply and the next `sync.json`. A source that cannot be read blocks only its diagram.
 */
export async function planSync(input: SyncInput, deps: ImportDeps = {}): Promise<SyncPlan> {
  const text = await input.adapter.read(SOURCES_PATH);
  if (text === null) return empty(false, [], []);
  const parsed = parseSources(text);
  const slugs = input.data.manifest.diagrams.map((entry) => entry.slug);
  const problems = [...parsed.diagnostics, ...(parsed.diagnostics.length ? [] : validateSourceTargets(parsed.sources, slugs))];
  if (problems.length) return empty(true, problems, problems.map(describeProblem));

  const stateText = await input.adapter.read(SYNC_PATH);
  const { state: previous, warnings: stateWarnings } = parseSyncState(stateText);
  const imports = await Promise.all(parsed.sources.map((source) => importSource(input.root, source, deps)));
  const sourceReports: SourceReport[] = imports.map(({ source, files, warnings, error }) => ({
    id: source.id, kind: source.kind, diagram: source.diagram, mode: source.mode, files, warnings, ...(error ? { error } : {}),
  }));

  const next: SyncState = emptySyncState();
  const diagrams: DiagramSyncPlan[] = [];
  const errors: string[] = [];
  for (const slug of [...new Set(parsed.sources.map((source) => source.diagram))]) {
    const group = imports.filter((item) => item.source.diagram === slug);
    const entry = input.data.manifest.diagrams.find((item) => item.slug === slug)!;
    const current = own(input.data.diagrams, slug)!.model;
    const mode = group[0]!.source.mode;
    const failing = group.filter((item) => item.error);
    const keepPrevious = () => {
      for (const { source } of group) {
        const old = own(previous.sources, source.id);
        if (old) next.sources[source.id] = old;
      }
    };
    if (failing.length) {
      for (const item of failing) errors.push(`Fonte "${item.source.id}" (${item.source.diagram}): ${item.error}`);
      keepPrevious();
      diagrams.push({ slug, title: entry.title, mode, sources: group.map((item) => item.source.id), blocked: true, ops: [], before: current, model: current, changes: noChanges(), notes: [] });
      continue;
    }
    const imported = unionModels(group.map((item) => item.model));
    const bases = group.flatMap((item) => {
      const old = own(previous.sources, item.source.id);
      return old && old.diagram === slug ? [old.base] : [];
    });
    const base = bases.length ? unionModels(bases) : undefined;
    if (!imported.order.length && base?.order.length) {
      errors.push(`As fontes de "${slug}" não produziram nenhum elemento, mas antes produziam ${base.order.length}. Se isso é intencional, remova-as com "joinlet sources remove"; senão confira os arquivos.`);
      keepPrevious();
      diagrams.push({ slug, title: entry.title, mode, sources: group.map((item) => item.source.id), blocked: true, ops: [], before: current, model: current, changes: noChanges(), notes: [] });
      continue;
    }
    const { ops, notes } = mergeIntoDiagram(current, imported, base, mode);
    const applied = applyOps(current, ops);
    if (!applied.ok) throw new Error(`Sincronização de "${slug}" gerou operações inválidas: ${applied.error.message}`);
    for (const item of group) next.sources[item.source.id] = { diagram: slug, base: item.model };
    diagrams.push({ slug, title: entry.title, mode, sources: group.map((item) => item.source.id), blocked: false, ops, before: current, model: applied.model, changes: compareModels(current, applied.model, renamesIn(current, ops)), notes, sourceModel: imported, baseline: base });
  }

  const nextText = Object.keys(next.sources).length ? printSyncState(next) : '';
  const changed = nextText !== (stateText ?? '');
  return {
    configured: true,
    problems: [],
    sources: sourceReports,
    diagrams,
    stateWarnings,
    state: { text: nextText, changed },
    stale: changed || diagrams.some((item) => !item.blocked && item.ops.length > 0),
    errors,
  };
}
