import { compareModels, emptyModel, own } from '@strukt/core';
import type { DiagramModel, EdgeEl, ID, ModelChanges } from '@strukt/core';
import { createMemoryAdapter, loadWorkspace, openConcerns, stableStringify } from '@strukt/workspace';
import type { Concern } from '@strukt/workspace';
import type { WorkspaceData } from '@strukt/workspace';
import { openWorkspaceAt } from '@strukt/workspace/fs';
import { readArchAtRef } from './run';
import type { CommandRunner } from './run';

export interface Side {
  label: string;
  data: WorkspaceData;
}

export const WORKTREE = 'árvore de trabalho';

export async function sideFromRef(runner: CommandRunner, cwd: string, ref: string): Promise<Side | { error: string }> {
  const files = await readArchAtRef(runner, cwd, ref);
  if (!files) return { error: `Não foi possível ler .arch/ em "${ref}" (ref inexistente ou sem workspace).` };
  const loaded = await loadWorkspace(createMemoryAdapter(files));
  if (!loaded) return { error: `"${ref}" não tem .arch/strukt.json.` };
  return { label: ref, data: loaded.data };
}

export async function sideFromWorktree(dir: string): Promise<Side | { error: string }> {
  const opened = await openWorkspaceAt(dir);
  if (!opened) return { error: `Nenhum workspace do Joinlet encontrado a partir de "${dir}" (procurei .arch/strukt.json).` };
  return { label: WORKTREE, data: opened.data };
}

export interface DiagramDiff {
  slug: string;
  title: string;
  changes: ModelChanges;
  edges: { prev: Record<ID, EdgeEl>; next: Record<ID, EdgeEl> };
}

export interface DiffResult {
  from: string;
  to: string;
  diagrams: DiagramDiff[];
  docs: { added: string[]; removed: string[]; changed: string[] };
  concerns: { opened: Concern[]; resolved: Concern[] };
  shared: { entities: ChangeSet; relations: ChangeSet };
  flows: ChangeSet;
}

interface ChangeSet { added: string[]; removed: string[]; changed: string[] }

function recordChanges<T>(before: Readonly<Record<string, T>>, after: Readonly<Record<string, T>>): ChangeSet {
  const result: ChangeSet = { added: [], removed: [], changed: [] };
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (!Object.hasOwn(before, key)) result.added.push(key);
    else if (!Object.hasOwn(after, key)) result.removed.push(key);
    else if (stableStringify(before[key]) !== stableStringify(after[key])) result.changed.push(key);
  }
  return result;
}

function flowRecord(data: WorkspaceData) {
  return Object.fromEntries(Object.entries(data.flows ?? {}).flatMap(([slug, flows]) => flows.map((flow) => [`${slug}/${flow.id}`, flow])));
}

const hasRecordChanges = (result: ChangeSet) => result.added.length + result.removed.length + result.changed.length > 0;

export const anyChange = (changes: ModelChanges): boolean =>
  changes.style ||
  Object.keys(changes.renamed).length > 0 ||
  (['added', 'removed', 'changed'] as const).some((kind) => changes.elements[kind].length > 0 || changes.edges[kind].length > 0);

const edgeMap = (model: DiagramModel): Record<ID, EdgeEl> => Object.fromEntries(model.edges.map((edge) => [edge.id, edge]));

/** Semantic comparison between two workspace states: elements, connections, style and docs. */
export function diffWorkspaces(from: Side, to: Side): DiffResult {
  const slugs = [...new Set([...from.data.manifest.diagrams.map((d) => d.slug), ...to.data.manifest.diagrams.map((d) => d.slug)])].sort();
  const diagrams: DiagramDiff[] = slugs.map((slug) => {
    const title = from.data.manifest.diagrams.find((d) => d.slug === slug)?.title ?? to.data.manifest.diagrams.find((d) => d.slug === slug)!.title;
    const prev = own(from.data.diagrams, slug)?.model ?? emptyModel();
    const next = own(to.data.diagrams, slug)?.model ?? emptyModel();
    return { slug, title, changes: compareModels(prev, next), edges: { prev: edgeMap(prev), next: edgeMap(next) } };
  });
  const docSlugs = [...new Set([...from.data.manifest.docs.map((d) => d.slug), ...to.data.manifest.docs.map((d) => d.slug)])].sort();
  const docs = { added: [] as string[], removed: [] as string[], changed: [] as string[] };
  for (const slug of docSlugs) {
    const before = own(from.data.docs, slug);
    const after = own(to.data.docs, slug);
    if (before === undefined) docs.added.push(slug);
    else if (after === undefined) docs.removed.push(slug);
    else if (before !== after) docs.changed.push(slug);
  }
  const previous = new Map(openConcerns(from.data.concerns).map((item) => [item.id, item]));
  const current = new Map(openConcerns(to.data.concerns).map((item) => [item.id, item]));
  const concerns = {
    opened: [...current.values()].filter((item) => !previous.has(item.id)),
    resolved: [...previous.values()].filter((item) => !current.has(item.id)),
  };
  const shared = {
    entities: recordChanges(from.data.shared?.entities ?? {}, to.data.shared?.entities ?? {}),
    relations: recordChanges(from.data.shared?.relations ?? {}, to.data.shared?.relations ?? {}),
  };
  const flows = recordChanges(flowRecord(from.data), flowRecord(to.data));
  return { from: from.label, to: to.label, diagrams, docs, concerns, shared, flows };
}

export type DiffOutcome = { ok: true; result: DiffResult } | { ok: false; error: string };

export type SidesOutcome = { ok: true; from: Side; to: Side } | { ok: false; error: string };

/** Resolves the two sides of `joinlet diff`: 0 refs = HEAD × worktree, 1 ref = ref × worktree, 2 refs = ref × ref. */
export async function diffSides(runner: CommandRunner, cwd: string, refs: readonly string[]): Promise<SidesOutcome> {
  const a = await sideFromRef(runner, cwd, refs[0] ?? 'HEAD');
  if ('error' in a) return { ok: false, error: a.error };
  const b = refs.length >= 2 ? await sideFromRef(runner, cwd, refs[1]!) : await sideFromWorktree(cwd);
  if ('error' in b) return { ok: false, error: b.error };
  return { ok: true, from: a, to: b };
}

/** Semantic diff between two refs. */
export async function diffRefs(runner: CommandRunner, cwd: string, from: string, to: string): Promise<DiffOutcome> {
  const a = await sideFromRef(runner, cwd, from);
  if ('error' in a) return { ok: false, error: a.error };
  const b = await sideFromRef(runner, cwd, to);
  if ('error' in b) return { ok: false, error: b.error };
  return { ok: true, result: diffWorkspaces(a, b) };
}

/** Semantic diff between a ref and the working tree. */
export async function diffWorktree(runner: CommandRunner, cwd: string, from: string): Promise<DiffOutcome> {
  const a = await sideFromRef(runner, cwd, from);
  if ('error' in a) return { ok: false, error: a.error };
  const b = await sideFromWorktree(cwd);
  if ('error' in b) return { ok: false, error: b.error };
  return { ok: true, result: diffWorkspaces(a, b) };
}

const endsOf = (edge: EdgeEl | undefined, id: ID) => (edge ? `${edge.from} → ${edge.to}` : id);
const inlineText = (value: string) => value.replace(/\s+/g, ' ').trim().replace(/[\\`*_[\]<>#|]/g, '\\$&');

/** pt-BR text, one line per change. */
export function renderDiffText(result: DiffResult): string {
  const lines: string[] = [`Comparando "${result.from}" → "${result.to}":`, ''];
  let changes = 0;
  for (const diagram of result.diagrams) {
    const { changes: c } = diagram;
    if (!anyChange(c)) continue;
    changes++;
    lines.push(`${diagram.title} (${diagram.slug})`);
    for (const id of c.elements.added) lines.push(`  + ${id}`);
    for (const id of c.elements.removed) lines.push(`  - ${id}`);
    for (const [from, to] of Object.entries(c.renamed)) lines.push(`  ~ ${from} → ${to} (renomeado)`);
    for (const id of c.elements.changed) if (!Object.hasOwn(c.renamed, id)) lines.push(`  ~ ${id}`);
    for (const id of c.edges.added) lines.push(`  + conexão ${endsOf(diagram.edges.next[id], id)}`);
    for (const id of c.edges.removed) lines.push(`  - conexão ${endsOf(diagram.edges.prev[id], id)}`);
    for (const id of c.edges.changed) lines.push(`  ~ conexão ${endsOf(diagram.edges.next[id], id)}`);
    if (c.style) lines.push('  ~ estilo do diagrama');
    lines.push('');
  }
  for (const slug of result.docs.added) lines.push(`+ documento "${slug}"`);
  for (const slug of result.docs.removed) lines.push(`- documento "${slug}"`);
  for (const slug of result.docs.changed) lines.push(`~ documento "${slug}"`);
  for (const [name, changed] of [['entidade', result.shared.entities], ['relação', result.shared.relations], ['fluxo', result.flows]] as const) {
    for (const id of changed.added) lines.push(`+ ${name} ${id}`);
    for (const id of changed.removed) lines.push(`- ${name} ${id}`);
    for (const id of changed.changed) lines.push(`~ ${name} ${id}`);
  }
  for (const item of result.concerns.opened) lines.push(`! pendência aberta em ${item.diagram}${item.element ? `/${item.element}` : ''}: ${item.message.replace(/\s+/g, ' ')}`);
  for (const item of result.concerns.resolved) lines.push(`✓ pendência resolvida em ${item.diagram}${item.element ? `/${item.element}` : ''}: ${item.message.replace(/\s+/g, ' ')}`);
  if (!changes && !result.docs.added.length && !result.docs.removed.length && !result.docs.changed.length && !result.concerns.opened.length && !result.concerns.resolved.length && !hasRecordChanges(result.shared.entities) && !hasRecordChanges(result.shared.relations) && !hasRecordChanges(result.flows)) {
    lines.push('Sem mudanças de arquitetura.');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/** Markdown for a PR comment. */
export function renderDiffMarkdown(result: DiffResult): string {
  const lines: string[] = [`## Arquitetura — \`${result.from}\` → \`${result.to}\``, ''];
  let changes = 0;
  for (const diagram of result.diagrams) {
    const { changes: c } = diagram;
    if (!anyChange(c)) continue;
    changes++;
    lines.push(`### ${diagram.title} (\`${diagram.slug}\`)`, '');
    if (c.elements.added.length) lines.push(`- Adicionados: ${c.elements.added.map((id) => `\`${id}\``).join(', ')}`);
    if (c.elements.removed.length) lines.push(`- Removidos: ${c.elements.removed.map((id) => `\`${id}\``).join(', ')}`);
    const renamed = Object.entries(c.renamed);
    if (renamed.length) lines.push(`- Renomeados: ${renamed.map(([from, to]) => `\`${from}\` → \`${to}\``).join(', ')}`);
    const changed = c.elements.changed.filter((id) => !Object.hasOwn(c.renamed, id));
    if (changed.length) lines.push(`- Alterados: ${changed.map((id) => `\`${id}\``).join(', ')}`);
    if (c.edges.added.length) lines.push(`- Conexões adicionadas: ${c.edges.added.map((id) => `\`${endsOf(diagram.edges.next[id], id)}\``).join(', ')}`);
    if (c.edges.removed.length) lines.push(`- Conexões removidas: ${c.edges.removed.map((id) => `\`${endsOf(diagram.edges.prev[id], id)}\``).join(', ')}`);
    if (c.edges.changed.length) lines.push(`- Conexões alteradas: ${c.edges.changed.map((id) => `\`${endsOf(diagram.edges.next[id], id)}\``).join(', ')}`);
    if (c.style) lines.push('- Estilo do diagrama alterado');
    lines.push('');
  }
  for (const slug of result.docs.added) lines.push(`- Documento adicionado: \`${slug}\``);
  for (const slug of result.docs.removed) lines.push(`- Documento removido: \`${slug}\``);
  for (const slug of result.docs.changed) lines.push(`- Documento alterado: \`${slug}\``);
  for (const [title, changed] of [['Entidades', result.shared.entities], ['Relações', result.shared.relations], ['Fluxos', result.flows]] as const) {
    if (!hasRecordChanges(changed)) continue;
    lines.push(`### ${title}`, '');
    for (const id of changed.added) lines.push(`- Adicionado: ${inlineText(id)}`);
    for (const id of changed.removed) lines.push(`- Removido: ${inlineText(id)}`);
    for (const id of changed.changed) lines.push(`- Alterado: ${inlineText(id)}`);
    lines.push('');
  }
  if (result.concerns.opened.length || result.concerns.resolved.length) {
    lines.push('### Pendências de precisão', '');
    for (const item of result.concerns.opened) lines.push(`- Aberta em ${inlineText(`${item.diagram}${item.element ? `/${item.element}` : ''}`)}: ${inlineText(item.message)}`);
    for (const item of result.concerns.resolved) lines.push(`- Resolvida em ${inlineText(`${item.diagram}${item.element ? `/${item.element}` : ''}`)}: ${inlineText(item.message)}`);
  }
  if (!changes && !result.docs.added.length && !result.docs.removed.length && !result.docs.changed.length && !result.concerns.opened.length && !result.concerns.resolved.length && !hasRecordChanges(result.shared.entities) && !hasRecordChanges(result.shared.relations) && !hasRecordChanges(result.flows)) lines.push('Sem mudanças de arquitetura.');
  return `${lines.join('\n').trimEnd()}\n`;
}
