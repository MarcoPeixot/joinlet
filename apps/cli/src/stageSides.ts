import type { Side } from '@strukt/git';
import { WORKTREE } from '@strukt/git';
import { buildTimeline, listVersions, readVersion, stagePoint, versionSnapshot } from '@strukt/workspace';
import type { DiagramSnapshot, VersionStage } from '@strukt/workspace';
import { openWorkspaceAt } from '@strukt/workspace/fs';

export type StageSidesOutcome = { ok: true; from: Side; to: Side } | { ok: false; error: string };

/**
 * `joinlet diff --stage <estágio>`: the diagram on disk against the saved version that stands for the stage (per diagram:
 * the newest current one, or the nearest goal still ahead). It reads in the direction of time: a current version is the
 * past (version → disk), a planned or transition one is the future (disk → version). Diagrams without a version of the
 * stage compare equal; a chosen version whose JSON has errors stops the diff with a message.
 */
export async function stageSides(dir: string, stage: VersionStage, now: Date = new Date()): Promise<StageSidesOutcome> {
  const opened = await openWorkspaceAt(dir);
  if (!opened) return { ok: false, error: `Nenhum workspace do Joinlet encontrado a partir de "${dir}" (procurei .arch/strukt.json).` };
  const diagrams: Record<string, DiagramSnapshot> = { ...opened.data.diagrams };
  let found = 0;
  for (const { slug } of opened.data.manifest.diagrams) {
    const point = stagePoint(buildTimeline((await listVersions(opened.adapter, slug)).entries, now), stage);
    if (!point?.entry) continue;
    const version = await readVersion(opened.adapter, point.entry.path);
    if (!version) return { ok: false, error: `Não foi possível ler a versão "${point.entry.version.id}" de "${slug}".` };
    const { snapshot, diagnostics } = versionSnapshot(version);
    const broken = diagnostics.find((d) => d.severity === 'error');
    if (broken) return { ok: false, error: `A versão "${point.entry.version.id}" de "${slug}" tem erros (linha ${broken.line}: ${broken.message}) e não pode ser comparada.` };
    diagrams[slug] = snapshot;
    found++;
  }
  if (!found) return { ok: false, error: `Nenhuma versão com estágio "${stage}" neste workspace.` };
  const disk: Side = { label: WORKTREE, data: opened.data };
  const saved: Side = { label: stage, data: { ...opened.data, diagrams } };
  return stage === 'atual' ? { ok: true, from: saved, to: disk } : { ok: true, from: disk, to: saved };
}
