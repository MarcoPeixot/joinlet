import { own } from '@strukt/core';
import type { ID, NodeBox } from '@strukt/core';
import { printDiagramJson } from '@strukt/json';
import type { JsonDiagnostic } from '@strukt/json';
import { deserializeDiagram, layoutNodes, parseLayoutNodes, snapshotFromDsl } from './diagram';
import type { DiagramSnapshot } from './diagram';
import { stableStringify } from './json';
import type { StorageAdapter } from './storage';
import { parseFlows } from './flows';
import type { Flow } from './flows';
import { stageMeta } from './versionStage';
import type { StageMeta } from './versionStage';
export * from './versionStage';

export type VersionAuthor = 'human' | 'ai' | 'agent';

/** A saved state of one diagram: `.arch/versions/<slug>/<stamp>-<id>.json`. */
export interface Version extends StageMeta {
  id: string;
  /** ISO 8601, UTC. */
  createdAt: string;
  message: string;
  author: VersionAuthor;
  /** The diagram as canonical JSON (`printDiagramJson`). */
  json: string;
  /** Positions of its elements (the sidecar's `nodes`). */
  layout: Record<ID, NodeBox>;
  flows?: Flow[];
}

/**
 * What the list needs from a version; the body (`json`, `layout`, `flows`) is read on demand with `readVersion`.
 * `stage` and `target` are absent on a plain version (read it as `atual`).
 */
export type VersionSummary = Pick<Version, 'id' | 'createdAt' | 'message' | 'author' | 'stage' | 'target'>;

/** A version's summary and the file it was read from or written to. */
export interface VersionEntry {
  path: string;
  version: VersionSummary;
}

/** One row of `versions/<slug>/index.json`. */
interface IndexRow extends VersionSummary {
  /** File name inside the diagram's version folder. */
  file: string;
}

const INDEX_FILE = 'index.json';
const SAFE_FILE = /^[A-Za-z0-9_.-]+\.json$/;

export const VERSIONS_DIR = 'versions';
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const versionsDir = (slug: string) => `${VERSIONS_DIR}/${slug}/`;

/** `20260923T140509123Z` for `2026-09-23T14:05:09.123Z`: sorts like the date and is a valid file name everywhere. */
export function versionStamp(createdAt: string): string {
  return createdAt.replace(/[-:.]/g, '');
}

export function versionPath(slug: string, version: Pick<Version, 'id' | 'createdAt'>): string {
  return `${versionsDir(slug)}${versionStamp(version.createdAt)}-${version.id}.json`;
}

export function createVersion(snapshot: DiagramSnapshot, meta: Omit<Version, 'json' | 'layout'>): Version {
  return { ...meta, json: printDiagramJson(snapshot.model), layout: layoutNodes(snapshot.model, snapshot.layout) };
}

export function printVersion(version: Version): string {
  return stableStringify(version);
}

/**
 * `null` when the file is not a version; a missing message or unknown author falls back to "" / "human".
 * Versions saved before the JSON format carry `dsl` and are converted on read, without rewriting the file.
 */
export function parseVersion(text: string): Version | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const raw = data as Partial<Record<keyof Version | 'dsl', unknown>>;
  if (typeof raw.id !== 'string' || !SAFE_ID.test(raw.id)) return null;
  if (typeof raw.createdAt !== 'string' || !Number.isFinite(Date.parse(raw.createdAt))) return null;
  const json = typeof raw.json === 'string' ? raw.json : typeof raw.dsl === 'string' ? printDiagramJson(snapshotFromDsl(raw.dsl, null).snapshot.model) : null;
  if (json === null) return null;
  return {
    id: raw.id,
    createdAt: raw.createdAt,
    message: typeof raw.message === 'string' ? raw.message : '',
    author: raw.author === 'ai' || raw.author === 'agent' ? raw.author : 'human',
    ...stageMeta(raw),
    json,
    layout: parseLayoutNodes(raw.layout),
    ...(Array.isArray(raw.flows) ? { flows: parseFlows(JSON.stringify(raw.flows)) } : {}),
  };
}

/** The diagram a version holds: its JSON parsed back, with the positions of the elements that exist. */
export function versionSnapshot(version: Version): { snapshot: DiagramSnapshot; diagnostics: JsonDiagnostic[] } {
  const { snapshot, diagnostics } = deserializeDiagram(version.json, null);
  const nodes = Object.fromEntries(Object.entries(version.layout).filter(([id]) => own(snapshot.model.elements, id)));
  return { snapshot: { model: snapshot.model, layout: { nodes, edges: {} } }, diagnostics };
}

const indexPath = (slug: string) => `${versionsDir(slug)}${INDEX_FILE}`;
const fileOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** Newest first; same-millisecond versions fall back to the path, descending. */
const byNewest = (a: IndexRow, b: IndexRow) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.file < b.file ? 1 : -1);

/** Valid rows of an index file; `null` when it is missing or not an array. Hostile rows are dropped, never trusted. */
function parseIndex(text: string | null): IndexRow[] | null {
  if (text === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  const rows: IndexRow[] = [];
  const seen = new Set<string>();
  for (const raw of data as unknown[]) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.id !== 'string' || !SAFE_ID.test(row.id)) continue;
    if (typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) continue;
    if (typeof row.file !== 'string' || !SAFE_FILE.test(row.file) || row.file === INDEX_FILE || seen.has(row.file)) continue;
    seen.add(row.file);
    rows.push({
      id: row.id,
      createdAt: row.createdAt,
      message: typeof row.message === 'string' ? row.message : '',
      author: row.author === 'ai' || row.author === 'agent' ? row.author : 'human',
      ...stageMeta(row),
      file: row.file,
    });
  }
  return rows;
}

/** The summary fields of a version, with `stage`/`target` only when set (the files and the index stay as they were for plain versions). */
const summaryOf = (version: VersionSummary): VersionSummary => ({
  id: version.id,
  createdAt: version.createdAt,
  message: version.message,
  author: version.author,
  ...(version.stage ? { stage: version.stage } : {}),
  ...(version.target ? { target: version.target } : {}),
});

const printIndex = (rows: IndexRow[]) => `${JSON.stringify([...rows].sort((a, b) => -byNewest(a, b)).map((row) => ({ ...summaryOf(row), file: row.file })), null, 2)}\n`;

const rowOf = (file: string, version: VersionSummary): IndexRow => ({ ...summaryOf(version), file });

/**
 * The rows of a diagram's version folder, checked against the folder listing: a missing, corrupt or stale index
 * (an agent or a checkout added or removed files) is repaired in memory by reading only the files it doesn't know.
 * Never writes. Files that are not versions are skipped and reported.
 */
async function loadRows(adapter: StorageAdapter, slug: string): Promise<{ rows: IndexRow[]; skipped: string[] }> {
  const dir = versionsDir(slug);
  const files = (await adapter.list())
    .filter((path) => path.startsWith(dir) && path.endsWith('.json') && !path.slice(dir.length).includes('/'))
    .map(fileOf)
    .filter((file) => file !== INDEX_FILE);
  const onDisk = new Set(files);
  const indexed = parseIndex(await adapter.read(indexPath(slug)));
  const rows = (indexed ?? []).filter((row) => onDisk.has(row.file));
  const known = new Set(rows.map((row) => row.file));
  const skipped: string[] = [];
  for (const file of files) {
    if (known.has(file)) continue;
    const version = await readVersion(adapter, `${dir}${file}`);
    if (version) {
      rows.push(rowOf(file, version));
    } else skipped.push(`${dir}${file}`);
  }
  return { rows, skipped };
}

/**
 * Writes the version file and adds it to the folder's index (written straight to the adapter, like versions; never pruned).
 * A missing or stale index is rebuilt from the listing first, so the written one is complete.
 */
export async function writeVersion(adapter: StorageAdapter, slug: string, version: Version): Promise<VersionEntry> {
  const path = versionPath(slug, version);
  const file = fileOf(path);
  const rows = (await loadRows(adapter, slug)).rows.filter((row) => row.file !== file);
  await adapter.write(path, printVersion(version));
  rows.push(rowOf(file, version));
  await adapter.write(indexPath(slug), printIndex(rows));
  return { path, version: summaryOf(version) };
}

/** The full version (body included) at `path`; `null` when the file is gone or is not a version. */
export async function readVersion(adapter: StorageAdapter, path: string): Promise<Version | null> {
  const text = await adapter.read(path);
  return text === null ? null : parseVersion(text);
}

/**
 * Versions of one diagram, newest first, from `versions/<slug>/index.json`: no version body is opened when the index is fresh.
 * A missing, corrupt or stale index is rebuilt in memory; listing never writes (a read-only open must not dirty `.arch/`).
 * Files that are not versions are skipped and reported, never thrown.
 */
export async function listVersions(adapter: StorageAdapter, slug: string): Promise<{ entries: VersionEntry[]; skipped: string[] }> {
  const { rows, skipped } = await loadRows(adapter, slug);
  const dir = versionsDir(slug);
  rows.sort(byNewest);
  return { entries: rows.map((row) => ({ path: `${dir}${row.file}`, version: summaryOf(row) })), skipped };
}

/** Deletes every version of a diagram (the diagram itself was deleted). Returns how many files went away. */
export async function removeVersions(adapter: StorageAdapter, slug: string): Promise<number> {
  const paths = (await adapter.list()).filter((path) => path.startsWith(versionsDir(slug)));
  for (const path of paths) await adapter.remove(path);
  return paths.length;
}
