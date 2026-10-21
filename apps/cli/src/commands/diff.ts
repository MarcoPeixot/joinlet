import { dirname, join, resolve } from 'node:path';
import { openWorkspaceAt } from '@strukt/workspace/fs';
import { assignDiffSvgNames, diffSides, diffWorkspaces, renderDiffMarkdown, renderDiffSvgs, renderDiffText } from '@strukt/git';
import type { CommandRunner, DiagramSvg } from '@strukt/git';
import { parseStage } from '@strukt/workspace';
import type { CliArgs } from '../args';
import type { CliIo } from '../io';
import { writeFilesSafely } from '../safeWrite';
import { stageSides } from '../stageSides';
import type { OutFile, Saved } from '../safeWrite';

/** `joinlet diff <ref-a> [<ref-b>]`: 0 refs = HEAD × worktree, 1 ref = ref × worktree, 2 refs = ref × ref. */
export async function runDiff(args: CliArgs, io: CliIo, runner: CommandRunner): Promise<number> {
  const stage = args.stage === undefined ? null : parseStage(args.stage);
  const sides = stage ? await stageSides(args.dir, stage) : await diffSides(runner, args.dir, args.refs);
  if (!sides.ok) {
    io.err(sides.error);
    return 2;
  }
  const result = diffWorkspaces(sides.from, sides.to);
  let written: string[] = [];
  if (args.svg !== undefined) {
    const archDirs = [join(resolve(args.dir), '.arch'), join(resolve(args.dir), '.git')];
    const opened = await openWorkspaceAt(args.dir);
    if (opened) archDirs.push(opened.archDir, join(dirname(opened.archDir), '.git'));
    const saved = await writeSvgs(resolve(args.svg), renderDiffSvgs(sides.from, sides.to), archDirs);
    if (!saved.ok) {
      io.err(saved.error);
      return 2;
    }
    written = saved.paths;
  }
  if (args.json) io.out(JSON.stringify(result, null, 2));
  else if (args.markdown) io.out(renderDiffMarkdown(result));
  else io.out(renderDiffText(result));
  // stdout stays machine-readable with --json; the paths then go to stderr.
  for (const path of written) (args.json ? io.err : io.out)(`SVG: ${path}`);
  return 0;
}

/** Writes `<dir>/<slug>.diff.svg`; slugs come from untrusted manifests, so all are validated before anything is written. */
async function writeSvgs(dir: string, svgs: DiagramSvg[], archDirs: string[]): Promise<Saved> {
  const names = assignDiffSvgNames(svgs.map((s) => s.slug));
  const files: OutFile[] = [];
  for (const [i, { slug, name }] of names.entries()) {
    if (!name) return { ok: false, error: `Slug de diagrama inválido para nome de arquivo: ${JSON.stringify(slug)} (use só letras, números, ".", "_" e "-", sem começar com ponto). Nada foi gravado.` };
    files.push({ rel: name, content: svgs[i]!.svg });
  }
  return writeFilesSafely(dir, files, { forbidInside: archDirs });
}
