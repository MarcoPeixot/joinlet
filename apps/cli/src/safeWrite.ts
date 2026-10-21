import { randomBytes } from 'node:crypto';
import { lstat, mkdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export type Saved = { ok: true; paths: string[] } | { ok: false; error: string };

/** `path` with every existing symlink resolved: `realpath` of the nearest existing ancestor plus the not-yet-created tail. */
export async function realResolve(path: string): Promise<string> {
  let head = resolve(path);
  const tail: string[] = [];
  for (;;) {
    try {
      return join(await realpath(head), ...tail);
    } catch {
      const parent = dirname(head);
      if (parent === head) return resolve(path);
      tail.unshift(head.slice(parent.length).replace(/^[\\/]+/, ''));
      head = parent;
    }
  }
}

/** True when `path` is `base` or lies below it (both already absolute and resolved). */
export function isWithin(base: string, path: string): boolean {
  const rel = relative(base, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export interface OutFile {
  /** Path relative to the output directory (already validated by the caller: no `..`, no absolute paths). */
  rel: string;
  content: string;
}

export interface WriteOptions {
  /** Folders the output must never resolve into (symlinks and `..` resolved), e.g. the workspace's `.arch/`. */
  forbidInside?: string[];
  /** Test seam: replaces `fs.writeFile` for the staged temp files. */
  write?: typeof writeFile;
}

/**
 * Writes generated files under `dir` without following links: the directory and every sub-directory must be plain
 * directories, the real location of `dir` (symlinked ancestors resolved) must not be inside a forbidden folder, and only
 * our own earlier regular files are replaced. Each file goes to an exclusive (`wx`) temp file in its folder and is renamed
 * over the target, so a reader never sees a half-written file and a link planted at the target name is replaced, not
 * followed. Everything is checked before the first write, so a refusal leaves the disk untouched.
 */
export async function writeFilesSafely(dir: string, files: OutFile[], opts: WriteOptions = {}): Promise<Saved> {
  if (!files.length) return { ok: true, paths: [] };
  const realDir = await realResolve(dir);
  for (const forbidden of opts.forbidInside ?? []) {
    if (isWithin(await realResolve(forbidden), realDir)) return { ok: false, error: `Recusei gravar em "${dir}": o destino resolve para dentro de "${forbidden}" (.arch é só do Joinlet). Nada foi gravado.` };
  }
  const targets = files.map((f) => ({ path: join(dir, f.rel), content: f.content }));
  const dirStat = await lstat(dir).catch(() => null);
  if (dirStat && !dirStat.isDirectory()) return { ok: false, error: `Recusei gravar em "${dir}": não é uma pasta comum (link simbólico?). Nada foi gravado.` };
  for (const sub of new Set(targets.map((t) => dirname(t.path)).filter((d) => d !== dir))) {
    const stat = await lstat(sub).catch(() => null);
    if (stat && !stat.isDirectory()) return { ok: false, error: `Recusei gravar em "${sub}": não é uma pasta comum (link simbólico?). Nada foi gravado.` };
  }
  for (const { path } of targets) {
    const existing = await lstat(path).catch(() => null);
    if (!existing) continue;
    if (!existing.isFile()) return { ok: false, error: `Recusei gravar em "${path}": já existe e não é um arquivo comum (link simbólico?). Nada foi gravado.` };
  }
  await mkdir(dir, { recursive: true });
  for (const sub of new Set(targets.map((t) => dirname(t.path)))) await mkdir(sub, { recursive: true });
  const staged: { temp: string; path: string }[] = [];
  try {
    for (const { path, content } of targets) {
      const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
      staged.push({ temp, path });
      await (opts.write ?? writeFile)(temp, content, { encoding: 'utf8', flag: 'wx' });
    }
    for (const { temp, path } of staged) await rename(temp, path);
  } catch (error) {
    for (const { temp } of staged) await unlink(temp).catch(() => undefined);
    return { ok: false, error: `Não consegui gravar os arquivos em "${dir}": ${error instanceof Error ? error.message : String(error)}` };
  }
  return { ok: true, paths: targets.map((t) => t.path) };
}
