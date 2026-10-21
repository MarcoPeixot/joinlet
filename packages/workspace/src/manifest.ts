import { STRUKT_FORMAT_VERSION } from '@strukt/core';
import { normalizeFolder } from './folders';
import { stableStringify } from './json';

export const ITEM_KINDS = ['diagram', 'doc', 'sketch'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export type ItemListKey = 'diagrams' | 'docs' | 'sketches';
export const ITEM_LIST: Record<ItemKind, ItemListKey> = { diagram: 'diagrams', doc: 'docs', sketch: 'sketches' };

export interface ItemEntry {
  slug: string;
  title: string;
  /** Sidebar folder as a slash path ("Backend/Dados"); absent = the root. Not a directory on disk. */
  folder?: string;
}

/** `.arch/strukt.json` (spec §9). List order is the sidebar order. */
export interface Manifest {
  version: number;
  name: string;
  /** Optional workspace identity, portable with the manifest. */
  description?: string;
  logo?: string;
  diagrams: ItemEntry[];
  docs: ItemEntry[];
  sketches: ItemEntry[];
  /** Folders that exist even when empty, per list (`folder` on items also creates folders implicitly). */
  folders?: Partial<Record<ItemListKey, string[]>>;
}

export const WORKSPACE_LOGO_MAX_LENGTH = 350_000;
/** Only bounded raster data URLs: no remote requests or executable SVG content. */
export function isWorkspaceLogo(value: unknown): value is string {
  return typeof value === 'string' && value.length <= WORKSPACE_LOGO_MAX_LENGTH && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export const MANIFEST_PATH = 'strukt.json';
export const BOARD_PATH = 'board.json';
/** The diagram JSON Schema, written to `.arch/` so external editors validate the files. */
export const SCHEMA_PATH = 'strukt.schema.json';
/** Slugs are file names: no separators, no leading dot. */
const SAFE_SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const diagramPath = (slug: string) => `diagrams/${slug}.strukt.json`;
/** The pre-JSON format: read once, converted to JSON, kept as `<slug>.strukt.bak`. */
export const legacyDiagramPath = (slug: string) => `diagrams/${slug}.strukt`;
export const layoutPath = (slug: string) => `diagrams/${slug}.layout.json`;
export const docPath = (slug: string) => `docs/${slug}.md`;
export const sketchPath = (slug: string) => `sketches/${slug}.excalidraw`;

export function itemPaths(kind: ItemKind, slug: string): string[] {
  if (kind === 'diagram') return [diagramPath(slug), layoutPath(slug)];
  return [kind === 'doc' ? docPath(slug) : sketchPath(slug)];
}

export function emptyManifest(name: string): Manifest {
  return { version: STRUKT_FORMAT_VERSION, name, diagrams: [], docs: [], sketches: [] };
}

export function printManifest(manifest: Manifest): string {
  return stableStringify(manifest);
}

function entries(value: unknown, key: ItemListKey, warnings: string[]): ItemEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: ItemEntry[] = [];
  for (const raw of value) {
    const entry = raw as Partial<ItemEntry> | null;
    if (!entry || typeof entry.slug !== 'string' || !SAFE_SLUG.test(entry.slug) || typeof entry.title !== 'string') {
      warnings.push(`strukt.json: uma entrada inválida de ${key} foi ignorada.`);
      continue;
    }
    if (seen.has(entry.slug)) {
      warnings.push(`strukt.json: "${entry.slug}" aparece duas vezes em ${key}; a repetição foi ignorada.`);
      continue;
    }
    seen.add(entry.slug);
    const folder = typeof entry.folder === 'string' ? normalizeFolder(entry.folder) : null;
    if (entry.folder !== undefined && !folder) warnings.push(`strukt.json: uma pasta inválida de ${key} foi ignorada.`);
    out.push(folder ? { slug: entry.slug, title: entry.title, folder } : { slug: entry.slug, title: entry.title });
  }
  return out;
}

function declaredFolders(value: unknown, key: ItemListKey, warnings: string[]): string[] {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined;
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const item of raw) {
    const path = typeof item === 'string' ? normalizeFolder(item) : null;
    if (path) out.add(path);
    else warnings.push(`strukt.json: uma pasta inválida de ${key} foi ignorada.`);
  }
  return [...out].sort();
}

/** Throws (pt-BR) when the file is not a Joinlet manifest; bad entries are skipped and reported. */
export function parseManifest(text: string): { manifest: Manifest; warnings: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('strukt.json não é um JSON válido.');
  }
  const raw = data as Partial<Record<keyof Manifest, unknown>> | null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.version !== 'number' || typeof raw.name !== 'string') {
    throw new Error('strukt.json não tem o formato de um workspace do Joinlet.');
  }
  if (raw.version > STRUKT_FORMAT_VERSION) throw new Error(`strukt.json é de uma versão mais nova do Joinlet (v${raw.version}).`);
  const warnings: string[] = [];
  const manifest: Manifest = {
    version: STRUKT_FORMAT_VERSION,
    name: raw.name,
    diagrams: entries(raw.diagrams, 'diagrams', warnings),
    docs: entries(raw.docs, 'docs', warnings),
    sketches: entries(raw.sketches, 'sketches', warnings),
  };
  if (typeof raw.description === 'string') manifest.description = raw.description.slice(0, 1000);
  if (isWorkspaceLogo(raw.logo)) manifest.logo = raw.logo;
  else if (raw.logo !== undefined) warnings.push('strukt.json: uma logo inválida foi ignorada.');
  const folders: NonNullable<Manifest['folders']> = {};
  for (const key of ['diagrams', 'docs', 'sketches'] as const) {
    const paths = declaredFolders(raw.folders, key, warnings);
    if (paths.length) folders[key] = paths;
  }
  if (Object.keys(folders).length) manifest.folders = folders;
  return { manifest, warnings };
}
