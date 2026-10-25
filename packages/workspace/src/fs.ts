import { journaledBatch, recoverJournal } from './repository/journal';
import { assertBetaManifest } from './beta';
import { mkdir, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import type { StorageAdapter } from './storage';
import { loadWorkspace, workspaceFiles } from './workspace';
import { MANIFEST_PATH, printManifest, SCHEMA_PATH } from './manifest';
import type { WorkspaceData } from './workspace';

const ERRNO = (err: unknown) => (err as NodeJS.ErrnoException).code;

/** Adapter paths are posix, relative and inside the workspace: no absolute path, no `..`, no empty part. */
function checkPath(path: string): string {
  const parts = path.split('/');
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0') || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Caminho inválido no workspace: "${path}".`);
  }
  return path;
}

const isFile = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
};

/**
 * A `StorageAdapter` over a real `.arch/` directory, confined to it: every path is relative, `..` is
 * refused and the nearest existing ancestor must resolve (through symlinks) to a directory inside the
 * workspace. `list()` skips symlinks, so a link to outside can never be read back.
 */
export function createFsAdapter(archDir: string): StorageAdapter & { recover():Promise<void> } {
  const root = resolve(archDir);
  const under = (path: string) => path === root || path.startsWith(root + sep);
  const full = (path: string) => join(root, checkPath(path));
  // The workspace root itself may sit behind a symlink (`/tmp` → `/private/tmp` on macOS): compare the
  // resolved ancestors against its resolved path, never against the unresolved one.
  let realRoot: string | null = null;
  const rootReal = async (): Promise<string> => {
    if (realRoot === null) {
      try {
        realRoot = await realpath(root);
      } catch {
        realRoot = root;
      }
    }
    return realRoot;
  };

  /** Refuses a target whose existing ancestor is not inside the workspace (symlink escape). */
  async function guard(target: string): Promise<void> {
    if (!under(target)) throw new Error('Caminho fora do .arch/.');
    const base = await rootReal();
    const inside = (path: string) => path === base || path.startsWith(base + sep);
    try {
      // The target itself may be a symlink to outside: resolve it when it exists.
      const real = await realpath(target);
      if (!inside(real)) throw new Error('Caminho fora do .arch/ (link simbólico).');
      return;
    } catch (err) {
      if (ERRNO(err) !== 'ENOENT') throw err;
    }
    let dir = dirname(target);
    for (;;) {
      try {
        const real = await realpath(dir);
        if (!inside(real)) throw new Error('Caminho fora do .arch/ (link simbólico).');
        return;
      } catch (err) {
        if (ERRNO(err) !== 'ENOENT') throw err;
      }
      const parent = dirname(dir);
      if (parent === dir) return;
      dir = parent;
    }
  }

  const adapter: StorageAdapter = {
    kind: 'folder',
    label: archDir,
    async read(path) {
      const target = full(path);
      await guard(target);
      try {
        return await readFile(target, 'utf8');
      } catch (err) {
        if (ERRNO(err) === 'ENOENT' || ERRNO(err) === 'EISDIR') return null;
        throw err;
      }
    },
    async write(path, text) {
      const target = full(path);
      await guard(target);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, text, 'utf8');
    },
    async remove(path) {
      const target = full(path);
      await guard(target);
      await rm(target, { force: true, recursive: true });
    },
    async list() {
      const out: string[] = [];
      const walk = async (dir: string): Promise<void> => {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const abs = join(dir, entry.name);
          if (entry.isSymbolicLink() || entry.name.startsWith('.joinlet-')) continue;
          if (entry.isDirectory()) await walk(abs);
          else if (entry.isFile()) out.push(relative(root, abs).split(sep).join('/'));
        }
      };
      try {
        await walk(root);
      } catch (err) {
        if (ERRNO(err) !== 'ENOENT') throw err;
      }
      return out.sort();
    },
  };
  adapter.stamps=async()=>{const files=await adapter.list();return Object.fromEntries(await Promise.all(files.map(async path=>[path,(await stat(full(path))).mtimeMs] as const)));};
  adapter.batch = journaledBatch(adapter, root, guard);
  return Object.assign(adapter,{recover:()=>recoverJournal(adapter,root,guard)});
}

/** Walks up from `start` (or the `.arch/` itself) until it finds `.arch/strukt.json`. */
export async function findArchDir(start: string): Promise<{ root: string; archDir: string } | null> {
  let dir = resolve(start);
  for (;;) {
    const inArch = basename(dir) === '.arch';
    const archDir = inArch ? dir : join(dir, '.arch');
    if (await isFile(join(archDir, 'strukt.json'))) return { root: inArch ? dirname(dir) : dir, archDir };
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export interface OpenedWorkspace {
  root: string;
  archDir: string;
  adapter: StorageAdapter;
  data: WorkspaceData;
  warnings: string[];
}

/** The workspace that contains `start`, loaded (and migrated) from disk. `null` when there is none. */
export async function openWorkspaceAt(start: string): Promise<OpenedWorkspace | null> {
  const found = await findArchDir(start);
  if (!found) return null;
  const adapter = createFsAdapter(found.archDir);
  const loaded = await loadWorkspace(adapter);
  if (!loaded) return null;
  return { ...found, adapter, data: loaded.data, warnings: loaded.warnings };
}

/**
 * Saves a workspace the way the app's autosave does: only files whose text changed since `previous` are
 * written, and files the workspace generated before and no longer generates are removed. Files the
 * workspace never owned (a migrated `.strukt.bak`, a user's extra file) are left alone.
 */
export async function writeWorkspace(
  adapter: StorageAdapter,
  data: WorkspaceData,
  previous?: WorkspaceData,
): Promise<string[]> {
  assertBetaManifest(await adapter.read(MANIFEST_PATH), printManifest(data.manifest));
  const files = workspaceFiles(data);
  const before = previous ? workspaceFiles(previous) : {};
  const touched: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    if (Object.hasOwn(before, path) && before[path] === text && (path !== SCHEMA_PATH || await adapter.read(path) === text)) continue;
    await adapter.write(path, text);
    touched.push(path);
  }
  for (const path of Object.keys(before)) {
    if (Object.hasOwn(files, path)) continue;
    await adapter.remove(path);
    touched.push(path);
  }
  return touched.sort();
}
