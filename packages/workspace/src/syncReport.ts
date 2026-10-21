import type { EdgeEl, ID } from '@strukt/core';
import { own } from '@strukt/core';
import { SOURCES_PATH, describeProblem } from './sources';
import type { DiagramSyncPlan, SyncPlan } from './sync';

const LIST_CAP = 30;

export type SyncReportFormat = 'text' | 'markdown';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

interface Writer {
  name(value: string): string;
  heading(level: 2 | 3, text: string): string;
  bullet(text: string): string;
}

const text: Writer = { name: (value) => value, heading: (_level, value) => value, bullet: (value) => `  ${value}` };
const markdown: Writer = {
  name: (value) => `\`${value.replace(/`/g, "'")}\``,
  heading: (level, value) => `${'#'.repeat(level)} ${value}`,
  bullet: (value) => `- ${value}`,
};

const ends = (edges: readonly EdgeEl[], id: ID) => {
  const edge = edges.find((candidate) => candidate.id === id);
  return edge ? `${edge.from} → ${edge.to}` : id;
};

function capped(items: string[], w: Writer): string[] {
  const shown = items.slice(0, LIST_CAP).map((item) => w.bullet(item));
  if (items.length > LIST_CAP) shown.push(w.bullet(`… e mais ${items.length - LIST_CAP}`));
  return shown;
}

function diagramLines(diagram: DiagramSyncPlan, w: Writer, format: SyncReportFormat): string[] {
  const { changes, before, model } = diagram;
  const lines: string[] = [w.heading(3, `${diagram.title} (${format === 'markdown' ? `\`${diagram.slug}\`` : diagram.slug})`)];
  if (diagram.blocked) return [...lines, w.bullet('não sincronizado (veja os erros acima)')];
  const items: string[] = [];
  for (const id of changes.elements.added) items.push(`+ ${w.name(id)}`);
  for (const id of changes.elements.removed) items.push(`- ${w.name(id)}`);
  for (const [from, to] of Object.entries(changes.renamed)) items.push(`~ ${w.name(from)} → ${w.name(to)} (renomeado)`);
  for (const id of changes.elements.changed) if (!own(changes.renamed, id)) items.push(`~ ${w.name(id)}`);
  for (const id of changes.edges.added) items.push(`+ conexão ${w.name(ends(model.edges, id))}`);
  for (const id of changes.edges.removed) items.push(`- conexão ${w.name(ends(before.edges, id))}`);
  for (const id of changes.edges.changed) items.push(`~ conexão ${w.name(ends(model.edges, id))}`);
  if (changes.style) items.push('~ estilo do diagrama');
  if (!items.length) return [...lines, w.bullet('em dia com as fontes')];
  return [...lines, ...capped(items, w)];
}

function sourceLine(source: SyncPlan['sources'][number], w: Writer): string {
  const where = `${source.kind} → ${w.name(source.diagram)} (${source.mode})`;
  if (source.error) return w.bullet(`${w.name(source.id)}: ${where}: ERRO — ${source.error}`);
  return w.bullet(`${w.name(source.id)}: ${where}, ${plural(source.files.length, 'arquivo', 'arquivos')}`);
}

/** pt-BR report of a sync plan; the same text drives the CLI, the Action summary and the MCP status. */
/** `applied`: the plan was just written, so a pending change reads as done. */
export function renderSyncReport(plan: SyncPlan, format: SyncReportFormat = 'text', options: { applied?: boolean } = {}): string {
  const w = format === 'markdown' ? markdown : text;
  if (!plan.configured) return `Nenhuma fonte configurada (.arch/${SOURCES_PATH}). Use "joinlet sources add" para ligar arquivos do repositório a um diagrama.\n`;
  const lines: string[] = [w.heading(2, 'Sincronização de fontes')];
  if (plan.problems.length) {
    lines.push('', ...plan.problems.map((problem) => w.bullet(describeProblem(problem))));
    return `${lines.join('\n')}\n`;
  }
  lines.push('', w.heading(3, 'Fontes'), ...plan.sources.map((source) => sourceLine(source, w)));
  for (const diagram of plan.diagrams) lines.push('', ...diagramLines(diagram, w, format));
  const notes = plan.diagrams.flatMap((diagram) => diagram.notes.map((note) => `${diagram.slug}: ${note.message}`));
  const warnings = [...plan.sources.flatMap((source) => source.warnings.map((warning) => `${source.id}: ${warning}`)), ...plan.stateWarnings];
  if (notes.length) lines.push('', w.heading(3, 'Preservado do trabalho manual'), ...capped(notes, w));
  if (warnings.length) lines.push('', w.heading(3, 'Avisos dos importadores'), ...capped(warnings, w));
  const stale = plan.diagrams.filter((diagram) => !diagram.blocked && diagram.ops.length).map((diagram) => diagram.slug);
  const pending = stale.length > 0 || plan.state.changed;
  let verdict = 'Tudo em dia com as fontes.';
  if (plan.errors.length) verdict = `${plural(plan.errors.length, 'erro impede', 'erros impedem')} a sincronização completa.`;
  else if (pending && options.applied) verdict = 'Sincronizado.';
  else if (pending) verdict = `Desatualizado${stale.length ? `: ${stale.join(', ')}` : ' (o registro da última sincronização mudaria)'}.`;
  lines.push('', verdict);
  return `${lines.join('\n')}\n`;
}
