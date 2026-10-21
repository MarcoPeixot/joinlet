import { assertBetaGrowth } from './beta';
import { emptyLayout, emptyModel, own } from '@strukt/core';
import { printDiagramJson, printDiagramJsonSchema } from '@strukt/json';
import { emptyBoard, parseBoard, printBoard, reconcileBoard } from './board';
import type { Board } from './board';
import { defaultDoc, emptySketch } from './content';
import { CONCERNS_PATH, parseConcerns, printConcerns } from './concerns';
import type { Concern } from './concerns';
import { EVIDENCE_PATH, parseEvidence, printEvidence } from './evidence';
import type { EvidenceIndex } from './evidence';
import { flowsPath, parseFlows, printFlows } from './flows';
import type { Flow } from './flows';
import { perspectivesPath, printPerspectives } from './perspectives';
import type { Perspective } from './perspectives';
import { SHARED_PATH, applyEntity, applyRelation, parseShared, printShared } from './shared';
import type { SharedModel } from './shared';
import { deserializeDiagram, serializeDiagram, snapshotFromDsl } from './diagram';
import type { DiagramSnapshot } from './diagram';
import {
  BOARD_PATH, ITEM_LIST, MANIFEST_PATH, SCHEMA_PATH, diagramPath, docPath, emptyManifest, layoutPath, legacyDiagramPath, parseManifest,
  printManifest, sketchPath,
} from './manifest';
import type { ItemKind, Manifest } from './manifest';
import { uniqueSlug } from './slug';
import type { StorageAdapter } from './storage';
import { LIBRARY_PATH, parseLibrary, printLibrary } from './library';
import type { WorkspaceLibrary } from './library';
import { ASSISTANTS_PATH, printAssistants } from './assistants';
import type { Assistant } from './assistants';

/** A whole workspace in memory: workspaces are small, so every item is loaded up front. */
export interface WorkspaceData {
  manifest: Manifest;
  diagrams: Record<string, DiagramSnapshot>;
  docs: Record<string, string>;
  sketches: Record<string, string>;
  board: Board;
  flows?: Record<string, Flow[]>;
  /** Saved perspectives per diagram (`diagrams/<slug>.perspectives.json`); the built-in C4 ones are not stored. */
  perspectives?: Record<string, Perspective[]>;
  evidence?: EvidenceIndex;
  shared?: SharedModel;
  concerns?: Concern[];
  library?: WorkspaceLibrary;
  /** The workspace's saved chat assistants (`assistants.json`); the built-ins are not stored. */
  assistants?: Assistant[];
}

export const DEFAULT_WORKSPACE_NAME = 'Meu workspace';

export function emptyDiagram(): DiagramSnapshot {
  return { model: emptyModel(), layout: emptyLayout() };
}

/** A new workspace, optionally seeded with one diagram (the migrated scratch or the example). */
export function newWorkspace(name: string, first?: { title: string; snapshot: DiagramSnapshot }): WorkspaceData {
  const data: WorkspaceData = { manifest: emptyManifest(name), diagrams: {}, docs: {}, sketches: {}, board: emptyBoard() };
  return first ? addItem(data, 'diagram', first.title, first.snapshot).data : data;
}

type ItemContent = DiagramSnapshot | string;

/** Adds an item with a slug derived from its title (unique per kind) and gives it a Quadro card. */
export function addItem(data: WorkspaceData, kind: ItemKind, title: string, content?: ItemContent): { data: WorkspaceData; slug: string } {
  if (kind === 'diagram') assertBetaGrowth('diagrams', data.manifest.diagrams.length, data.manifest.diagrams.length + 1);
  const key = ITEM_LIST[kind];
  const slug = uniqueSlug(title, new Set(data.manifest[key].map((e) => e.slug)));
  const manifest = { ...data.manifest, [key]: [...data.manifest[key], { slug, title }] };
  const next: WorkspaceData = { ...data, manifest };
  if (kind === 'diagram') next.diagrams = { ...data.diagrams, [slug]: (content as DiagramSnapshot | undefined) ?? emptyDiagram() };
  if (kind === 'doc') next.docs = { ...data.docs, [slug]: (content as string | undefined) ?? defaultDoc(title) };
  if (kind === 'sketch') next.sketches = { ...data.sketches, [slug]: (content as string | undefined) ?? emptySketch() };
  next.board = reconcileBoard(data.board, manifest);
  return { data: next, slug };
}

/** Titles change freely; slugs (file names and `doc:` links) never do. */
export function renameItem(data: WorkspaceData, kind: ItemKind, slug: string, title: string): WorkspaceData {
  const key = ITEM_LIST[kind];
  return { ...data, manifest: { ...data.manifest, [key]: data.manifest[key].map((e) => (e.slug === slug ? { ...e, title } : e)) } };
}

export function removeItem(data: WorkspaceData, kind: ItemKind, slug: string): WorkspaceData {
  const key = ITEM_LIST[kind];
  const manifest = { ...data.manifest, [key]: data.manifest[key].filter((e) => e.slug !== slug) };
  const drop = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([s]) => s !== slug));
  return {
    manifest,
    diagrams: kind === 'diagram' ? drop(data.diagrams) : data.diagrams,
    docs: kind === 'doc' ? drop(data.docs) : data.docs,
    sketches: kind === 'sketch' ? drop(data.sketches) : data.sketches,
    board: reconcileBoard(data.board, manifest),
    ...(data.flows ? { flows: kind === 'diagram' ? drop(data.flows) : data.flows } : {}),
    ...(data.perspectives ? { perspectives: kind === 'diagram' ? drop(data.perspectives) : data.perspectives } : {}),
    ...(data.evidence ? { evidence: kind === 'diagram' ? drop(data.evidence) : data.evidence } : {}),
    ...(data.shared ? { shared: kind === 'diagram' ? { ...data.shared, views: drop(data.shared.views), ...(data.shared.viewRelations ? { viewRelations: drop(data.shared.viewRelations) } : {}) } : data.shared } : {}),
    ...(data.concerns ? { concerns: kind === 'diagram' ? data.concerns.filter((item) => item.diagram !== slug) : data.concerns } : {}),
    ...(data.library ? { library: data.library } : {}),
    ...(data.assistants ? { assistants: data.assistants } : {}),
  };
}

export function itemTitle(data: WorkspaceData, kind: ItemKind, slug: string): string | undefined {
  return data.manifest[ITEM_LIST[kind]].find((e) => e.slug === slug)?.title;
}

/** Every file of the workspace, as it goes to disk. */
export function workspaceFiles(data: WorkspaceData): Record<string, string> {
  const files: Record<string, string> = {
    [MANIFEST_PATH]: printManifest(data.manifest),
    [BOARD_PATH]: printBoard(data.board),
    [SCHEMA_PATH]: printDiagramJsonSchema(),
  };
  if (data.evidence && Object.keys(data.evidence).length) files[EVIDENCE_PATH] = printEvidence(data.evidence);
  if (data.shared && Object.keys(data.shared.entities).length) files[SHARED_PATH] = printShared(data.shared);
  if (data.concerns?.length) files[CONCERNS_PATH] = printConcerns(data.concerns);
  if (data.library && (data.library.components.length || data.library.templates.length)) files[LIBRARY_PATH] = printLibrary(data.library);
  if (data.assistants?.length) files[ASSISTANTS_PATH] = printAssistants(data.assistants);
  for (const { slug } of data.manifest.diagrams) {
    const { json, layout } = serializeDiagram(own(data.diagrams, slug) ?? emptyDiagram());
    files[diagramPath(slug)] = json;
    files[layoutPath(slug)] = layout;
    const flows = own(data.flows ?? {}, slug);
    if (flows?.length) files[flowsPath(slug)] = printFlows(flows);
    const perspectives = own(data.perspectives ?? {}, slug);
    if (perspectives?.length) files[perspectivesPath(slug)] = printPerspectives(perspectives);
  }
  for (const { slug } of data.manifest.docs) files[docPath(slug)] = own(data.docs, slug) ?? '';
  for (const { slug } of data.manifest.sketches) files[sketchPath(slug)] = own(data.sketches, slug) ?? emptySketch();
  return files;
}

const READ_CONCURRENCY = 8;

/** `Promise.all` over `items` with at most `limit` workers; results keep the input order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Reads a workspace; `null` when the adapter has no `strukt.json`. A diagram whose text has errors
 * is loaded with what could be read, and its original text is copied to `<file>.bak` first; one with
 * only warnings (constructs the Joinlet ignores) is reported, without a backup. A pre-JSON
 * `diagrams/<slug>.strukt` is converted to `.strukt.json` on the spot, keeping the original as
 * `<slug>.strukt.bak`.
 */
export async function loadWorkspace(adapter: StorageAdapter): Promise<{ data: WorkspaceData; warnings: string[] } | null> {
  const manifestText = await adapter.read(MANIFEST_PATH);
  if (manifestText === null) return null;
  const { manifest, warnings } = parseManifest(manifestText);
  const data: WorkspaceData = { manifest, diagrams: {}, docs: {}, sketches: {}, board: emptyBoard() };
  const evidenceText = await adapter.read(EVIDENCE_PATH);
  if (evidenceText !== null) data.evidence = parseEvidence(evidenceText);
  const sharedText = await adapter.read(SHARED_PATH);
  if (sharedText !== null) data.shared = parseShared(sharedText);
  const concernsText = await adapter.read(CONCERNS_PATH);
  if (concernsText !== null) data.concerns = parseConcerns(concernsText);
  const assistantsText = await adapter.read(ASSISTANTS_PATH);
  // Loaded on demand: most workspaces have no assistants, and the app's first screen never reads one.
  if (assistantsText !== null) data.assistants = (await import('./assistantsParse')).parseAssistants(assistantsText);
  const libraryText = await adapter.read(LIBRARY_PATH);
  if (libraryText !== null) {
    try { data.library = parseLibrary(libraryText); }
    catch (error) {
      await adapter.write(`${LIBRARY_PATH}.bak`, libraryText).catch(() => {});
      warnings.push(error instanceof Error ? error.message : 'library.json inválido.');
    }
  }
  const loadedDiagrams = await mapLimit(manifest.diagrams, READ_CONCURRENCY, async ({ slug }) => {
    const notes: string[] = [];
    const flowText = await adapter.read(flowsPath(slug));
    const flows = flowText !== null ? parseFlows(flowText) : null;
    const perspectiveText = await adapter.read(perspectivesPath(slug));
    // Loaded on demand, as the assistants are: most diagrams have none, and the first screen never reads one.
    const perspectives = perspectiveText !== null ? (await import('./perspectivesParse')).parsePerspectives(perspectiveText) : null;
    const layoutText = await adapter.read(layoutPath(slug));
    let json = await adapter.read(diagramPath(slug));
    if (json === null) {
      const legacy = await adapter.read(legacyDiagramPath(slug));
      if (legacy !== null) {
        const converted = snapshotFromDsl(legacy, layoutText);
        const error = converted.diagnostics.find((d) => d.severity === 'error');
        await adapter.write(diagramPath(slug), printDiagramJson(converted.snapshot.model));
        await adapter.write(`${legacyDiagramPath(slug)}.bak`, legacy);
        notes.push(
          error
            ? `${legacyDiagramPath(slug)} tem erros (linha ${error.line}: ${error.message}) e foi convertido para ${diagramPath(slug)}; o original virou ${legacyDiagramPath(slug)}.bak.`
            : `${legacyDiagramPath(slug)} foi convertido para ${diagramPath(slug)}; o original virou ${legacyDiagramPath(slug)}.bak.`,
        );
        return { slug, flows, perspectives, notes, snapshot: converted.snapshot };
      }
    }
    const { snapshot, diagnostics } = deserializeDiagram(json, layoutText);
    const error = diagnostics.find((d) => d.severity === 'error');
    const ignored = diagnostics.filter((d) => d.severity === 'warning');
    if (json !== null && error) {
      // Idempotent and never fatal: a collaboration host already wrote this backup, and a guest's write may be refused.
      const backup = `${diagramPath(slug)}.bak`;
      const copied = await adapter.read(backup).then(async (existing) => {
        if (existing !== json) await adapter.write(backup, json);
        return true;
      }).catch(() => false);
      notes.push(`${diagramPath(slug)} tem erros (linha ${error.line}: ${error.message}); ${copied ? 'o original foi copiado para' : 'não foi possível copiar o original para'} ${backup}.`);
    } else if (json !== null && ignored[0]) {
      // No backup for warnings: a merely Eraser-compatible file would leave `.bak` noise in the repo.
      const w = ignored[0];
      notes.push(
        `${diagramPath(slug)}: o Joinlet ignorou ${ignored.length} trecho(s) (linha ${w.line}: ${w.message}); eles saem do arquivo na próxima mudança do diagrama.`,
      );
    }
    return { slug, flows, perspectives, notes, snapshot };
  });
  // Merged in manifest order, so results and warnings are the same as a serial read.
  for (const { slug, flows, perspectives, notes, snapshot } of loadedDiagrams) {
    if (flows) {
      data.flows ??= {};
      data.flows[slug] = flows;
    }
    if (perspectives?.length) {
      data.perspectives ??= {};
      data.perspectives[slug] = perspectives;
    }
    warnings.push(...notes);
    data.diagrams[slug] = snapshot;
  }
  if (data.shared) for (const [slug, mapping] of Object.entries(data.shared.views)) {
    const snapshot = own(data.diagrams, slug);
    if (!snapshot) continue;
    let model = snapshot.model;
    for (const [local, entityId] of Object.entries(mapping)) {
      const entity = own(data.shared.entities, entityId);
      if (entity) model = applyEntity(model, local, entity);
    }
    data.diagrams[slug] = { ...snapshot, model };
  }
  if (data.shared?.relations && data.shared.viewRelations) for (const [slug, mapping] of Object.entries(data.shared.viewRelations)) {
    const snapshot = own(data.diagrams, slug);
    if (!snapshot) continue;
    let model = snapshot.model;
    for (const [edgeId, relationId] of Object.entries(mapping)) {
      const relation = own(data.shared.relations, relationId);
      if (relation) model = applyRelation(model, edgeId, relation);
    }
    data.diagrams[slug] = { ...snapshot, model };
  }
  const docTexts = await mapLimit(manifest.docs, READ_CONCURRENCY, ({ slug }) => adapter.read(docPath(slug)));
  manifest.docs.forEach(({ slug }, index) => { data.docs[slug] = docTexts[index] ?? ''; });
  const sketchTexts = await mapLimit(manifest.sketches, READ_CONCURRENCY, ({ slug }) => adapter.read(sketchPath(slug)));
  manifest.sketches.forEach(({ slug }, index) => { data.sketches[slug] = sketchTexts[index] ?? emptySketch(); });
  data.board = reconcileBoard(parseBoard(await adapter.read(BOARD_PATH)), manifest);
  return { data, warnings };
}
