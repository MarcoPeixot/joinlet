import { KNOWLEDGE_HARNESS } from './agentHarness';
import { own } from '@strukt/core';
import type { Connector, DiagramElement, DiagramModel, ID } from '@strukt/core';
import { printDiagramJson } from '@strukt/json';
import { docExcerpt } from './content';
import { openConcerns } from './concerns';
import { flowStepIssue } from './flows';
import type { FlowStep } from './flows';
import { docSlugOf, referencesTo } from './links';
import { diagramPath, docPath } from './manifest';
import type { ItemEntry, Manifest } from './manifest';
import { ARCHITECTURE_PATH, LLMS_PATH, contextDiagramPath } from './contextPaths';
import type { WorkspaceData } from './workspace';

/**
 * Context for coding agents (spec §1, §9): generated from the workspace into `.arch/context/`, never edited by hand.
 * Pure and deterministic (no dates), so regenerating an unchanged workspace yields the same bytes.
 */
export * from './contextPaths';

/** Paste into AGENTS.md (or CLAUDE.md) at the root of the repository. */
export const AGENTS_SNIPPET = [
  '## Arquitetura (Joinlet)',
  '',
  'Antes de escrever código, leia `.arch/context/ARCHITECTURE.md`: é a arquitetura atual do sistema, gerada pelo Joinlet a partir dos diagramas em `.arch/diagrams/` (JSON do Joinlet). Um índice curto fica em `.arch/context/llms.txt`.',
  '',
  '- Não edite `.arch/context/` à mão: o Joinlet gera esses arquivos de novo a partir dos diagramas e documentos.',
  '- Se a sua mudança altera a arquitetura (serviço, fila, banco ou conexão novos), atualize na mesma mudança o diagrama em `.arch/diagrams/<nome>.strukt.json`.',
  '- Com o Joinlet MCP instalado, use as ferramentas dele (`get_diagram`, `apply_ops`, `write_doc`) em vez de editar o JSON à mão.',
  '',
  KNOWLEDGE_HARNESS,
  '',
].join('\n');

const CONNECTOR_TEXT: Record<Connector, string> = {
  '>': 'seta',
  '<': 'seta invertida (de Para para De)',
  '<>': 'seta dupla',
  '-': 'linha',
  '--': 'pontilhada',
  '-->': 'seta pontilhada',
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const stats = (model: DiagramModel) => `${plural(model.order.length, 'componente', 'componentes')}, ${plural(model.edges.length, 'conexão', 'conexões')}`;
const finish = (lines: string[]) => `${lines.join('\n').trimEnd()}\n`;

/**
 * Every line break a renderer or a raw reader may honour: CommonMark's `\n`, `\r` and `\r\n`, plus NEL and the
 * Unicode line/paragraph separators (U+0085, U+2028, U+2029), which some editors and terminals also break on.
 */
const LINE_BREAK = /\r\n|[\n\r\u0085\u2028\u2029]/g;
/** One line of text: every run of whitespace (line breaks included) becomes a single space. */
const flatten = (text: string) => text.replace(/[\s\u0085]+/g, ' ').trim();

/**
 * A title or name embedded in a heading, blockquote or list line: workspace/diagram/doc titles are free text
 * from untrusted `strukt.json`, so a newline could break out of its line and a `#`/`<`/`*`… could start a fake
 * heading or raw HTML. Flattens the text to one line, then backslash-escapes every Markdown/HTML-significant
 * character (CommonMark backslash escapes), so the text stays on one line and inert.
 */
function inline(text: string): string {
  return flatten(text).replace(/[\\`*_[\]<>#]/g, '\\$&');
}
const linkText = inline;

/**
 * Raw text as the content of one table cell, escaped exactly once: flattened to one line (a lone `\r` would end
 * the row), then `\` and every Markdown/HTML-significant character, `|` included, backslash-escaped in a single
 * pass. Callers pass raw text, never an already-escaped fragment: escaping `\<` again yields `\\<`, an escaped
 * backslash followed by a live `<`.
 */
const cellText = (text: string) => flatten(text).replace(/[\\`*_[\]<>#|]/g, '\\$&');

/** One table cell from raw text, "—" when empty. */
const cell = (text: string | undefined) => cellText(text ?? '') || '—';

/** A code fence longer than any run of backticks inside `text`. */
function fence(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * A Markdown inline code span that safely contains any backticks in `text` (CommonMark code spans). CommonMark
 * only strips a padding space when BOTH ends have one, so if the content starts or ends with a backtick (or a
 * space, which would otherwise fuse with the delimiter), pad BOTH sides — padding just one side would leave it
 * un-stripped and visible. Line breaks become spaces (what a code span renders them as anyway), so the span
 * cannot end its line early. `<`/`>` are backslash-escaped too: CommonMark itself never parses code-span content
 * as HTML, but nothing here should rely on that — the raw text must never carry a literal `<script>`-shaped run.
 */
function codeSpan(text: string): string {
  const flat = text.replace(LINE_BREAK, ' ');
  const longest = Math.max(0, ...[...flat.matchAll(/`+/g)].map((match) => match[0].length));
  const delim = '`'.repeat(longest + 1);
  const pad = /^`|`$|^ | $/.test(flat) ? ' ' : '';
  const safe = flat.replace(/[<>]/g, '\\$&');
  return `${delim}${pad}${safe}${pad}${delim}`;
}

/**
 * An element id in a table cell: a code span whose pipes are escaped, since GFM splits cells on unescaped pipes
 * even inside code spans. GFM renderers count the backslashes before a pipe (an even run escapes only itself), so a
 * run of backslashes the id puts before a pipe is doubled first; nothing else is re-escaped.
 */
const idCell = (id: string) => codeSpan(id).replace(/(\\*)\|/g, '$1$1\\|');

/** The Componente cell: "label (`id`)", or just the id when the element has no label of its own. */
const elementCell = (el: DiagramElement) => {
  const label = el.label && el.label !== el.id ? cellText(el.label) : '';
  return label ? `${label} (${idCell(el.id)})` : idCell(el.id);
};

/** Docs linked from the diagram's elements (`link: "doc:<slug>"`), in the order they are first referenced. */
function linkedDocs(data: WorkspaceData, model: DiagramModel): { entry: ItemEntry; ids: ID[] }[] {
  const refs = new Map<string, ID[]>();
  for (const id of model.order) {
    const slug = docSlugOf(model.elements[id]!.link);
    if (slug && own(data.docs, slug) !== undefined) refs.set(slug, [...(refs.get(slug) ?? []), id]);
  }
  return [...refs].flatMap(([slug, ids]) => {
    const entry = data.manifest.docs.find((doc) => doc.slug === slug);
    return entry ? [{ entry, ids }] : [];
  });
}

/** The start of a doc as a Markdown quote, with "[…]" when it goes on. */
function quote(markdown: string): string[] {
  const excerpt = docExcerpt(markdown).trimEnd();
  if (!excerpt.trim()) return ['_Documento vazio._'];
  const lines = excerpt.split(LINE_BREAK).map((line) => (line.trim() ? `> ${line}` : '>'));
  if (excerpt.length < markdown.trimEnd().length) lines.push('>', '> […]');
  return lines;
}

/** One diagram: JSON (the source of truth), components, connections and linked docs. `depth` 1 = its own file. */
function diagramSection(data: WorkspaceData, entry: ItemEntry, depth: number, intro: string[] = []): string[] {
  const h = (level: number) => '#'.repeat(depth + level);
  const model = own(data.diagrams, entry.slug)?.model;
  const lines = [`${h(0)} ${inline(entry.title)}`, '', ...intro];
  if (!model || !model.order.length) return [...lines, `\`.arch/${diagramPath(entry.slug)}\``, '', 'Diagrama vazio.', ''];
  const json = printDiagramJson(model).trimEnd();
  const code = fence(json);
  lines.push(`\`.arch/${diagramPath(entry.slug)}\` · ${stats(model)}`, '', `${code}json`, json, code, '');

  lines.push(`${h(1)} Componentes`, '', '| Componente | Tipo | Tecnologia | Descrição | Grupo |', '| --- | --- | --- | --- | --- |');
  for (const id of model.order) {
    const el = model.elements[id]!;
    lines.push(`| ${elementCell(el)} | ${el.kind === 'group' ? 'grupo' : 'nó'} | ${cell(el.tech)} | ${cell(el.description)} | ${el.parentId ? idCell(el.parentId) : '—'} |`);
  }
  const evidence = own(data.evidence ?? {}, entry.slug) ?? {};
  if (Object.keys(evidence).length) {
    lines.push('', `${h(1)} Evidências no código`, '');
    for (const [id, refs] of Object.entries(evidence).sort(([a],[b])=>a.localeCompare(b))) for (const ref of refs) {
      lines.push(`- ${codeSpan(id)}: ${codeSpan(`${ref.path}${ref.line ? `#L${ref.line}` : ''}`)}${ref.contains ? ` — trecho esperado: ${codeSpan(ref.contains)}` : ''}`);
    }
  }
  lines.push('', `${h(1)} Conexões`, '');
  if (!model.edges.length) {
    lines.push('Sem conexões.', '');
  } else {
    lines.push('| De | Para | Tipo | Rótulo |', '| --- | --- | --- | --- |');
    for (const edge of model.edges) {
      lines.push(`| ${idCell(edge.from)} | ${idCell(edge.to)} | \`${edge.connector}\` ${CONNECTOR_TEXT[edge.connector]} | ${cell(edge.label)} |`);
    }
    lines.push('');
  }

  const flows = own(data.flows ?? {}, entry.slug) ?? [];
  if (flows.length) {
    const stepLines = (steps: readonly FlowStep[], indent = ''): string[] => steps.flatMap((step): string[] => {
      const issue = flowStepIssue(model, step, data.flows ?? {});
      const suffix = `${step.note ? ` — ${inline(step.note)}` : ''}${issue ? ` (${inline(issue.toLowerCase())})` : ''}`;
      if ('from' in step) return [`${indent}- ${codeSpan(step.from)} → ${codeSpan(step.to)}${suffix}`];
      if (step.kind === 'process') return [`${indent}- Processo em ${codeSpan(step.node)}${suffix}`];
      if (step.kind === 'goto') return [`${indent}- Abrir fluxo ${codeSpan(step.flowId)} em ${codeSpan(step.diagram)}${suffix}`];
      return [`${indent}- ${step.kind === 'choice' ? 'Escolha' : 'Paralelo'}${step.title ? `: ${inline(step.title)}` : ''}${suffix}`, ...step.branches.flatMap((branch) => [`${indent}  - ${inline(branch.title)}`, ...stepLines(branch.steps, `${indent}    `)])];
    });
    lines.push(`${h(1)} Fluxos`, '');
    for (const flow of flows) {
      lines.push(`${h(2)} ${inline(flow.title)}`, '');
      if (flow.description) lines.push(inline(flow.description), '');
      lines.push(...stepLines(flow.steps));
      lines.push('');
    }
  }

  const concerns = openConcerns(data.concerns, entry.slug);
  if (concerns.length) {
    lines.push(`${h(1)} Pendências de precisão`, '');
    for (const concern of concerns) lines.push(`- ${concern.element ? `${codeSpan(concern.element)}: ` : ''}${inline(concern.message)}`);
    lines.push('');
  }

  const docs = linkedDocs(data, model);
  if (docs.length) {
    lines.push(`${h(1)} Documentos ligados`, '');
    for (const { entry: doc, ids } of docs) {
      lines.push(`${h(2)} ${inline(doc.title)}`, '', `\`.arch/${docPath(doc.slug)}\` · ligado a: ${ids.map(codeSpan).join(', ')}`, '', ...quote(data.docs[doc.slug]!), '');
    }
  }
  return lines;
}

/** `context/ARCHITECTURE.md`: every diagram of the workspace in one file. */
export function architectureMarkdown(data: WorkspaceData): string {
  const { manifest } = data;
  const lines = [
    `# Arquitetura — ${inline(manifest.name)}`,
    '',
    '> Gerado pelo Joinlet a partir de `.arch/`. Não edite à mão: mude os diagramas e os documentos no Joinlet e este arquivo se atualiza.',
    '',
    'Cada diagrama traz o código JSON do Joinlet, que é a fonte da verdade, seguido das tabelas de componentes e conexões e de trechos dos documentos ligados aos componentes.',
    '',
    '## Diagramas',
    '',
  ];
  if (!manifest.diagrams.length) lines.push('Nenhum diagrama.', '');
  for (const { slug, title } of manifest.diagrams) {
    const model = own(data.diagrams, slug)?.model;
    lines.push(`- [${linkText(title)}](diagrams/${slug}.md) — ${model ? stats(model) : 'vazio'}`);
  }
  if (manifest.diagrams.length) lines.push('');
  for (const entry of manifest.diagrams) lines.push(...diagramSection(data, entry, 2));
  if (data.shared && Object.keys(data.shared.entities).length) {
    lines.push('## Entidades compartilhadas', '');
    for (const entity of Object.values(data.shared.entities)) {
      const views = Object.entries(data.shared.views).flatMap(([slug, mapping]) => Object.entries(mapping).filter(([, id]) => id === entity.id).map(([local]) => `${slug}/${local}`));
      lines.push(`- ${codeSpan(entity.id)}${entity.label ? ` — ${inline(entity.label)}` : ''}: ${views.map(codeSpan).join(', ')}${entity.tags?.length ? ` · tags: ${entity.tags.map(codeSpan).join(', ')}` : ''}`);
    }
    lines.push('');
  }
  if (data.shared?.relations && Object.keys(data.shared.relations).length) {
    lines.push('## Relações compartilhadas', '');
    for (const relation of Object.values(data.shared.relations)) {
      lines.push(`- ${codeSpan(relation.id)}: ${codeSpan(relation.from)} ${codeSpan(relation.connector)} ${codeSpan(relation.to)}${relation.label ? ` — ${inline(relation.label)}` : ''}${relation.tech ? ` · ${inline(relation.tech)}` : ''}${relation.description ? ` · ${inline(relation.description)}` : ''}`);
    }
    lines.push('');
  }
  if (manifest.docs.length) {
    lines.push('## Documentos', '');
    for (const { slug, title } of manifest.docs) lines.push(`- ${inline(title)} — \`.arch/${docPath(slug)}\``);
  }
  return finish(lines);
}

/** `context/diagrams/<slug>.md`: one diagram on its own. */
export function diagramMarkdown(data: WorkspaceData, slug: string): string {
  const entry = data.manifest.diagrams.find((d) => d.slug === slug);
  if (!entry) return '';
  const intro = [`> Parte da arquitetura de “${inline(data.manifest.name)}” (visão completa em [ARCHITECTURE.md](../ARCHITECTURE.md)). Gerado pelo Joinlet: não edite à mão.`, ''];
  return finish(diagramSection(data, entry, 1, intro));
}

/** `context/llms.txt` in the llmstxt.org format: H1, summary quote, then H2 sections of links. */
export function llmsTxt(data: WorkspaceData): string {
  const { manifest } = data;
  const lines = [
    `# ${inline(manifest.name)}`,
    '',
    `> Arquitetura do workspace “${inline(manifest.name)}” no Joinlet: ${plural(manifest.diagrams.length, 'diagrama', 'diagramas')} e ${plural(manifest.docs.length, 'documento', 'documentos')}. Comece por ARCHITECTURE.md.`,
    '',
    'Os diagramas são JSON: cada item de `nodes` é um componente (com `type: "group"` e `children` para grupos) e cada item de `connections` liga `from` a `to`. As posições do desenho ficam em `.arch/diagrams/*.layout.json` e não mudam o significado. Arquivos gerados a partir de `.arch/`: não edite à mão.',
    '',
    '## Arquitetura',
    '',
    '- [ARCHITECTURE.md](ARCHITECTURE.md): todos os diagramas, com código, componentes, conexões e documentos ligados',
    '',
  ];
  if (manifest.diagrams.length) {
    lines.push('## Diagramas', '');
    for (const { slug, title } of manifest.diagrams) {
      const model = own(data.diagrams, slug)?.model;
      lines.push(`- [${linkText(title)}](diagrams/${slug}.md): ${model ? stats(model) : 'vazio'}`);
    }
    lines.push('');
  }
  if (manifest.docs.length) {
    lines.push('## Documentos', '');
    for (const { slug, title } of manifest.docs) {
      const refs = referencesTo(slug, data.diagrams, manifest.diagrams);
      const about = refs.length ? `ligado a ${refs.map((ref) => `${inline(ref.label)} (${inline(ref.diagramTitle)})`).join(', ')}` : 'documento do workspace';
      lines.push(`- [${linkText(title)}](../docs/${slug}.md): ${about}`);
    }
    lines.push('');
  }
  if (manifest.diagrams.length) {
    lines.push('## Optional', '');
    for (const { slug, title } of manifest.diagrams) lines.push(`- [${slug}.strukt.json](../diagrams/${slug}.strukt.json): código-fonte de “${inline(title)}”`);
  }
  return finish(lines);
}

/** Every generated file, keyed by its path under `.arch/`. */
export function contextFiles(data: WorkspaceData): Record<string, string> {
  const files: Record<string, string> = { [ARCHITECTURE_PATH]: architectureMarkdown(data), [LLMS_PATH]: llmsTxt(data) };
  for (const { slug } of data.manifest.diagrams) files[contextDiagramPath(slug)] = diagramMarkdown(data, slug);
  return files;
}
