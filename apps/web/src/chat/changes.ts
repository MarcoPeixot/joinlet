import { uiText } from '../i18n';
import { diffModels } from '@strukt/core';
import type { DiagramModel } from '@strukt/core';
import { latestCurrent, listVersions, readVersion, versionSnapshot } from '@strukt/workspace';
import { diagramStore } from '../state/appStore';
import { workspace } from '../workspace/appWorkspace';

/** The diff an assistant asks for; loaded on demand (only "changes" assistants need it). */
const CHANGES_CUT = 20_000;

/** What changed since a saved version, as the operations that turn it into the current diagram (the model reads them as JSON). */
export function describeChanges(saved: DiagramModel, current: DiagramModel): string {
  const ops = diffModels(saved, current);
  if (!ops.length) return uiText("Nenhuma mudança em relação à versão salva.");
  const json = JSON.stringify(ops, null, 1);
  return `\`\`\`json\n${json.length > CHANGES_CUT ? `${json.slice(0, CHANGES_CUT)}\n…` : json}\n\`\`\`${json.length > CHANGES_CUT ? '\n[lista cortada]' : ''}`;
}

const oneLine = (text: string, max: number) => text.replace(/\s+/g, ' ').replace(/"/g, "'").trim().slice(0, max);

/** The section the "changes" assistants read: the diff against the latest saved version (or why there is none). */
export function changesSection(title: string, version: { message: string; createdAt: string } | null, saved: DiagramModel | null, current: DiagramModel): string {
  const diagram = uiText("diagrama \"{0}\"", [oneLine(title, 80)]);
  if (!version || !saved) return uiText("## Mudanças desde a última versão salva ({0})\nEste diagrama ainda não tem versões salvas, então não há o que comparar: diga isso e resuma o diagrama como está.", [diagram]);
  const head = uiText("## Mudanças desde a última versão salva ({0}, versão \"{1}\" de {2})", [diagram, oneLine(version.message, 80), version.createdAt.slice(0, 10)]);
  return `${head}\nOperações que transformam a versão salva no diagrama atual:\n${describeChanges(saved, current)}`;
}

/** The diff section for the diagram in the workspace: its latest saved version against the canvas as it is now. */
export async function currentChanges(): Promise<string> {
  const { data, diagram } = workspace.store.getState();
  const title = data?.manifest.diagrams.find((item) => item.slug === diagram)?.title ?? diagram ?? '';
  const current = diagramStore.getState().model;
  const storage = workspace.storage();
  if (!diagram || !storage) return changesSection(title, null, null, current);
  // Planned and transition states are future designs, not "the last saved version".
  const latest = latestCurrent((await listVersions(storage, diagram)).entries);
  const version = latest ? await readVersion(storage, latest.path) : null;
  return changesSection(title, version, version ? versionSnapshot(version).snapshot.model : null, current);
}
