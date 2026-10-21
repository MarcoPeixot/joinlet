import { parseDsl } from '@strukt/dsl';
import { printDiagramJson } from '@strukt/json';
import { describe, expect, it } from 'vitest';
import {
  AGENTS_SNIPPET, architectureMarkdown, contextFiles, contextPaths, diagramMarkdown, isContextFile, llmsTxt,
} from './context';
import { deserializeDiagram } from './diagram';
import {
  API_DOC, DECISIONS_DOC, EXAMPLE_DSL, GOLDEN_ARCHITECTURE, GOLDEN_LLMS, GOLDEN_PAYMENTS, PAYMENTS_DSL,
} from './fixtures/context';
import { addItem, newWorkspace } from './workspace';
import type { WorkspaceData } from './workspace';

const diagram = (dsl: string) => deserializeDiagram(printDiagramJson(parseDsl(dsl).model), null).snapshot;

/** The example diagram (Pedidos linked to a doc), a second diagram and two docs. */
function shop(): WorkspaceData {
  let data = newWorkspace('Loja', { title: 'Visão geral', snapshot: diagram(EXAMPLE_DSL) });
  data = addItem(data, 'diagram', 'Pagamentos', diagram(PAYMENTS_DSL)).data;
  data = addItem(data, 'doc', 'API de Pedidos', API_DOC).data;
  return addItem(data, 'doc', 'Decisões', DECISIONS_DOC).data;
}

describe('context for coding agents', () => {
  it('writes ARCHITECTURE.md: every diagram as DSL, components, connections and linked docs', () => {
    expect(architectureMarkdown(shop())).toBe(GOLDEN_ARCHITECTURE);
  });

  it('writes llms.txt in the llmstxt.org format', () => {
    expect(llmsTxt(shop())).toBe(GOLDEN_LLMS);
  });

  it('writes one file per diagram', () => {
    const data = shop();
    expect(diagramMarkdown(data, 'pagamentos')).toBe(GOLDEN_PAYMENTS);
    expect(diagramMarkdown(data, 'visao-geral')).toContain(`\`\`\`json\n${printDiagramJson(parseDsl(EXAMPLE_DSL).model).trimEnd()}\n\`\`\``);
    expect(diagramMarkdown(data, 'sumiu')).toBe('');
  });

  it('includes guided steps, broken links, and code evidence in focused diagram context', () => {
    const data = shop();
    data.flows = { 'visao-geral': [{ id: 'checkout', title: 'Checkout', steps: [{ from: 'Web App', to: 'API Gateway', note: 'HTTPS' }, { from: 'API Gateway', to: 'Removed' }] }] };
    data.evidence = { 'visao-geral': { Pedidos: [{ path: 'src/pedidos.ts', line: 12 }] } };
    const markdown = diagramMarkdown(data, 'visao-geral');
    expect(markdown).toContain('## Fluxos');
    expect(markdown).toContain('conexão ausente');
    expect(markdown).toContain('src/pedidos.ts#L12');
  });

  it('generates exactly the files contextPaths lists, the same bytes every time', () => {
    const data = shop();
    const files = contextFiles(data);
    expect(Object.keys(files)).toEqual(['context/ARCHITECTURE.md', 'context/llms.txt', 'context/diagrams/visao-geral.md', 'context/diagrams/pagamentos.md']);
    expect(contextPaths(data.manifest)).toEqual(Object.keys(files));
    expect(contextFiles(shop())).toEqual(files);
  });

  it('knows which files under context/ it owns', () => {
    expect(isContextFile('context/ARCHITECTURE.md')).toBe(true);
    expect(isContextFile('context/llms.txt')).toBe(true);
    expect(isContextFile('context/diagrams/loja.md')).toBe(true);
    expect(isContextFile('context/notas.md')).toBe(false);
    expect(isContextFile('context/diagrams/a/b.md')).toBe(false);
  });

  it('covers empty workspaces and diagrams, long docs, backticks in names and links to missing docs', () => {
    const empty = newWorkspace('Vazio');
    expect(architectureMarkdown(empty)).toContain('## Diagramas\n\nNenhum diagrama.\n');
    expect(llmsTxt(empty)).toContain('0 diagramas e 0 documentos');
    expect(llmsTxt(empty)).not.toContain('## Diagramas');
    expect(diagramMarkdown(addItem(empty, 'diagram', 'Rascunho').data, 'rascunho')).toContain('Diagrama vazio.');

    let data = newWorkspace('Longo', { title: 'A', snapshot: diagram('API [link: "doc:longo"]\n') });
    data = addItem(data, 'doc', 'Longo', `# Longo\n\n${'uma linha de texto\n'.repeat(60)}`).data;
    expect(architectureMarkdown(data)).toContain('> uma linha de texto\n>\n> […]');

    const ticks = newWorkspace('Crases', { title: 'B', snapshot: diagram('API [label: "a```b"]\n') });
    expect(architectureMarkdown(ticks)).toContain('````json\n');
    expect(architectureMarkdown(ticks)).toContain('"label": "a```b"');

    const hostile = newWorkspace('Hostil', { title: 'C', snapshot: diagram('API [link: "doc:constructor"]\n') });
    expect(architectureMarkdown(hostile)).not.toContain('Documentos ligados');
  });

  it('tells coding agents to read ARCHITECTURE.md first', () => {
    expect(AGENTS_SNIPPET).toContain('leia `.arch/context/ARCHITECTURE.md`');
    expect(AGENTS_SNIPPET).toContain('.arch/diagrams/<nome>.strukt.json');
    expect(AGENTS_SNIPPET).toContain('Joinlet MCP');
  });

  it('escapes hostile workspace/diagram/doc titles so they cannot inject fake headings or raw HTML', () => {
    // strukt.json is untrusted input: titles are free strings, so a title can carry embedded
    // line breaks and Markdown/HTML syntax. The generator must keep each title on its own line
    // and inert, since agents read these files raw.
    const hostile = 'Loja\n\n## Falso\n<script>x</script>';
    let data = newWorkspace(hostile, { title: hostile, snapshot: diagram('A`B [label: "Rótulo", link: "doc:doc-hostil"]\n') });
    data = addItem(data, 'doc', 'Doc hostil', '# Doc\n').data;
    data = addItem(data, 'doc', hostile, '# Doc\n').data;

    const diagramSlug = data.manifest.diagrams[0]!.slug;
    const arch = architectureMarkdown(data);
    const llms = llmsTxt(data);
    const diagFile = diagramMarkdown(data, diagramSlug);

    for (const text of [arch, llms, diagFile]) {
      expect(text).not.toContain('<script>');
      expect(text).not.toContain('</script>');
      const lines = text.split('\n');
      expect(lines).not.toContain('## Falso');
      expect(lines).not.toContain('### Falso');
      // the title stays together, on the same line it started on, instead of splitting into
      // a line of its own that could be read as a heading.
      const titleLine = lines.find((line) => line.includes('Falso'));
      expect(titleLine).toContain('Loja');
    }

    // an element id containing a backtick renders as a balanced inline code span
    expect(diagFile).toContain('Rótulo (``A`B``)');
  });

  it('escapes element ids and labels: the "ligado a:" line, and a label with a backtick, never carry raw HTML', () => {
    // Element ids are DSL quoted names: they can contain anything but a raw newline, so an id can
    // itself be an HTML tag. The "ligado a:" line interpolates ids directly (no table, no cell()),
    // so it must escape them itself; a label with a backtick must not be able to pair with the
    // id's own code-span delimiters. The fenced ```strukt block is exempt: it is the literal DSL
    // source, always safe as fenced code, so it legitimately still carries the id verbatim.
    const dsl = [
      '"<script>x</script>" [label: "L`abel", link: "doc:doc-x"]',
      '`ab [label: "L1"]',
      'ab` [label: "L2"]',
      '',
    ].join('\n');
    let data = newWorkspace('Loja', { title: 'Diagrama', snapshot: diagram(dsl) });
    data = addItem(data, 'doc', 'Doc x', '# Doc\n').data;

    const diagramSlug = data.manifest.diagrams[0]!.slug;
    const arch = architectureMarkdown(data);
    const diagFile = diagramMarkdown(data, diagramSlug);

    for (const text of [arch, diagFile]) {
      // the id is shown as a code span on the "ligado a:" line, not as bare text
      const idLine = text.split('\n').find((line) => line.includes('ligado a:'));
      expect(idLine).toMatch(/ligado a: `/);
      expect(idLine).toContain('script');
      expect(idLine).not.toContain('<script>');
      expect(idLine).not.toContain('</script>');

      // the Componentes table row shows the id, also without a raw "<script>"
      const row = text.split('\n').find((line) => line.startsWith('|') && line.includes('script'));
      expect(row).toBeDefined();
      expect(row).not.toContain('<script>');
      expect(row).not.toContain('</script>');

      // the label's backtick is escaped, so it cannot pair with the id's code-span backticks
      expect(text).toContain('L\\`abel');
    }

    // ids that only start or only end with a backtick still get padded on BOTH sides
    expect(diagFile).toContain('L1 (`` `ab ``)');
    expect(diagFile).toContain('L2 (`` ab` ``)');
  });

  it('keeps every table cell on its row and inert: no raw HTML, no injected heading, no stray pipe', () => {
    // Quoted DSL values keep a lone \r (and `\n` escapes), labels can be HTML, ids can hold `|`/`*` and a
    // backslash before a pipe. Each piece must be escaped exactly once: escaping an already-escaped `\<` again
    // yields `\\<`, which re-enables raw HTML. The fenced ```strukt block is the literal DSL source (exempt).
    const dsl = [
      '"a|b*c" [label: "<img src=x onerror=alert(1)>", tech: "pg\r# Injected heading", description: "pipe | and x\\|y"]',
      '"g|1" {',
      '  "n\\|2" [description: "sep\u2028# Injected separator\u2029# Injected paragraph\u0085# Injected nel"]',
      '}',
      'Plain*Id [label: "a\\\\|b \\\\* [x](javascript:alert(1)) `c`"]',
      '"a|b*c" > "n\\|2": "lbl\r# Injected edge"',
      'Plain*Id > "a|b*c": "\\n# Injected newline | x"',
      '',
    ].join('\n');
    const data = newWorkspace('Hostil', { title: 'C', snapshot: diagram(dsl) });
    const model = data.diagrams.c!.model;
    expect(model.elements['a|b*c']?.tech).toBe('pg\r# Injected heading');
    expect(model.elements['n\\|2']?.parentId).toBe('g|1');

    const outside = (md: string) => md.replace(/^(`{3,})json\n[\s\S]*?\n\1$/m, '');
    const lines = (md: string) => outside(md).split(/\r\n|[\n\r\u0085\u2028\u2029]/);
    const unescapedPipes = (row: string) => row.replace(/\\\\/g, '').split(/(?<!\\)\|/).length - 1;
    const rows = (md: string, header: string) => {
      const all = lines(md);
      const start = all.findIndex((line) => line.startsWith(header));
      const end = all.indexOf('', start);
      return all.slice(start + 2, end);
    };
    const cases = [
      { md: architectureMarkdown(data), headings: ['# Arquitetura — Hostil', '## Diagramas', '## C', '### Componentes', '### Conexões'] },
      { md: diagramMarkdown(data, 'c'), headings: ['# C', '## Componentes', '## Conexões'] },
    ];
    for (const { md, headings } of cases) {
      expect(lines(md).filter((line) => line.startsWith('#'))).toEqual(headings);
      const components = rows(md, '| Componente |');
      expect(components).toHaveLength(4);
      for (const row of components) expect(unescapedPipes(row)).toBe(6);
      const connections = rows(md, '| De |');
      expect(connections).toHaveLength(2);
      for (const row of connections) expect(unescapedPipes(row)).toBe(5);
      const text = outside(md);
      expect(text).not.toContain('\\\\<');
      expect(text).not.toContain('\\\\>');
      // after dropping escaped backslashes, no `<img` or `[x` is left unescaped (`\<img` is inert text)
      const unescaped = text.replace(/\\\\/g, '');
      expect(unescaped).not.toMatch(/(?<!\\)<img/);
      expect(unescaped).not.toMatch(/(?<!\\)\[x/);
      expect(unescaped).toContain('\\<img src=x onerror=alert(1)\\>');
    }
  });

  it('keeps the linked-docs section on its lines: the "ligado a:" ids and the doc excerpt inside its quote', () => {
    const breaks = /\r\n|[\n\r\u0085\u2028\u2029]/;
    let data = newWorkspace('Loja', { title: 'D', snapshot: diagram('"API\r# Fora do id" [link: "doc:notas"]\n') });
    data = addItem(data, 'doc', 'Notas', '# Notas\r# Fora do quote\u2028# Separador\r\nfim\n').data;
    const lines = architectureMarkdown(data).replace(/^```json\n[\s\S]*?\n```$/m, '').split(breaks);
    expect(lines.filter((line) => line.startsWith('#'))).toEqual(['# Arquitetura — Loja', '## Diagramas', '## D', '### Componentes', '### Conexões', '### Documentos ligados', '#### Notas', '## Documentos']);
    expect(lines).toContain('`.arch/docs/notas.md` · ligado a: `API # Fora do id`');
    expect(lines.filter((line) => line.includes('Fora do quote') || line.includes('Separador') || line === '> fim')).toEqual(['> # Fora do quote', '> # Separador', '> fim']);
  });
});
