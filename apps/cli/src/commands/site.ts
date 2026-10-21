import { lstat, readFile, readdir, rmdir, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { renderDiagramSvg } from '@strukt/git';
import { buildSiteReport } from '@strukt/workspace';
import { openWorkspaceAt } from '@strukt/workspace/fs';
import type { CliArgs } from '../args';
import type { CliIo } from '../io';
import { isWithin, realResolve, writeFilesSafely } from '../safeWrite';

const DEFAULT_OUT = 'strukt-site';
/** Written into every generated site: proves we own the folder and lists the files to clean up on the next run. */
const MARKER = '.strukt-site';
const MAX_MARKER_FILES = 5000;

type Inspected = { ok: true; previous: string[]; ignored?: number } | { ok: false; error: string };

/** The only names `joinlet site` ever generates: the marker is repo content, so nothing else may be deleted. */
const GENERATED = /^(?:index\.html|style\.css|(?:diagrams|docs)\/[A-Za-z0-9._~-]+\.html)$/;

/** A manifest entry is only removed when it is a name this command generates (same slug rules as the pages). */
function ownedPath(rel: unknown): rel is string {
  if (typeof rel !== 'string' || !GENERATED.test(rel)) return false;
  if (!rel.includes('/')) return true;
  const name = rel.slice(rel.indexOf('/') + 1, -'.html'.length);
  return !name.startsWith('.') && !name.endsWith('.') && name !== '__proto__';
}

/** Refuses anything that is not an empty (or missing) folder or one our earlier run marked; returns the earlier run's file list. */
async function inspectOut(outDir: string, archDir: string): Promise<Inspected> {
  const realOut = await realResolve(outDir);
  const realArch = await realResolve(archDir);
  const repoGit = join(dirname(realArch), '.git');
  if (isWithin(realOut, realArch) || isWithin(realOut, repoGit) || isWithin(repoGit, realOut)) {
    return { ok: false, error: `Recusei gravar o site em "${outDir}": a pasta é (ou contém, ou fica dentro de) o ".arch/" ou o ".git" do repositório. Escolha outra pasta com --out.` };
  }
  const stat = await lstat(outDir).catch(() => null);
  if (!stat) return { ok: true, previous: [] };
  if (!stat.isDirectory()) return { ok: false, error: `Recusei gravar em "${outDir}": não é uma pasta comum (link simbólico?). Nada foi gravado.` };
  const entries = await readdir(outDir);
  if (entries.includes('.arch') || entries.includes('.git')) {
    return { ok: false, error: `Recusei gravar o site em "${outDir}": a pasta contém ".arch" ou ".git". Escolha outra pasta com --out.` };
  }
  if (!entries.length) return { ok: true, previous: [] };
  const refuse = { ok: false as const, error: `A pasta "${outDir}" não está vazia e não foi gerada pelo "joinlet site" (falta o arquivo ${MARKER}). Use uma pasta vazia ou nova com --out. Nada foi gravado.` };
  const marker = await lstat(join(outDir, MARKER)).catch(() => null);
  if (!marker?.isFile() || marker.size > 1_000_000) return refuse;
  try {
    const parsed = JSON.parse(await readFile(join(outDir, MARKER), 'utf8')) as { files?: unknown };
    if (!Array.isArray(parsed.files)) return refuse;
    const listed = parsed.files.slice(0, MAX_MARKER_FILES);
    const previous = listed.filter(ownedPath);
    return { ok: true, previous, ignored: listed.length - previous.length };
  } catch {
    return refuse;
  }
}

const fold = (rel: string): string => rel.normalize('NFKC').toLowerCase();

/** Deletes files an earlier run listed in the marker that this run no longer generates; never follows links. Returns how many went. */
async function removeStale(outDir: string, previous: string[], current: Set<string>): Promise<number> {
  let removed = 0;
  // Case-insensitive disks (macOS, Windows) treat `docs/Foo.html` and `docs/foo.html` as one file: compare folded names.
  const folded = new Set([...current].map(fold));
  for (const rel of previous) {
    if (current.has(rel) || folded.has(fold(rel))) continue;
    const parts = rel.split('/');
    let plain = true;
    for (let i = 1; i < parts.length && plain; i += 1) {
      const stat = await lstat(join(outDir, ...parts.slice(0, i))).catch(() => null);
      plain = stat?.isDirectory() ?? false;
    }
    const target = join(outDir, ...parts);
    if (!plain || !isWithin(outDir, target) || !(await lstat(target).catch(() => null))?.isFile()) continue;
    await unlink(target);
    removed += 1;
    for (let dir = dirname(target); dir !== outDir && isWithin(outDir, dir); dir = dirname(dir)) {
      try { await rmdir(dir); } catch { break; }
    }
  }
  return removed;
}

/** `joinlet site [--out <dir>]`: static HTML architecture site (no JavaScript). Reads `.arch/`, writes only under `--out`. */
export async function runSite(args: CliArgs, io: CliIo): Promise<number> {
  const opened = await openWorkspaceAt(args.dir);
  if (!opened) {
    io.err(`Nenhum workspace do Joinlet encontrado a partir de "${args.dir}" (procurei .arch/strukt.json).`);
    return 2;
  }
  const outDir = resolve(args.out ?? DEFAULT_OUT);
  if (isWithin(opened.archDir, outDir)) {
    io.err(`Recusei gravar o site dentro de ".arch/" ("${outDir}"): escolha outra pasta com --out.`);
    return 2;
  }
  const inspected = await inspectOut(outDir, opened.archDir);
  if (!inspected.ok) {
    io.err(inspected.error);
    return 2;
  }
  const { files, skipped } = buildSiteReport(opened.data, {
    renderDiagramSvg: (slug, model, layout) => renderDiagramSvg(model, layout, { title: opened.data.manifest.diagrams.find((d) => d.slug === slug)?.title }),
  });
  const generated = Object.keys(files).sort();
  const marker = `${JSON.stringify({ generator: 'joinlet site', files: generated }, null, 2)}\n`;
  const saved = await writeFilesSafely(outDir, [...generated.map((rel) => ({ rel, content: files[rel]! })), { rel: MARKER, content: marker }], { forbidInside: [opened.archDir, join(dirname(opened.archDir), '.git')] });
  if (!saved.ok) {
    io.err(saved.error);
    return 2;
  }
  if (inspected.ignored) io.err(`Aviso: ${inspected.ignored} ${inspected.ignored === 1 ? 'entrada' : 'entradas'} de ${MARKER} ignorada${inspected.ignored === 1 ? '' : 's'} (não ${inspected.ignored === 1 ? 'é' : 'são'} arquivo${inspected.ignored === 1 ? '' : 's'} gerado${inspected.ignored === 1 ? '' : 's'} pelo "joinlet site"); nada foi apagado por elas.`);
  const removed = await removeStale(outDir, inspected.previous, new Set(generated));
  for (const path of saved.paths) io.out(path);
  for (const note of skipped) io.err(`Aviso: ${note}`);
  if (removed) io.out(`${removed} ${removed === 1 ? 'arquivo antigo removido' : 'arquivos antigos removidos'}`);
  io.out(`Site gerado: ${saved.paths.length} arquivos em ${outDir}`);
  return 0;
}
