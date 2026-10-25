import { COMPONENT_LIBRARIES, COMPONENT_PRESETS } from '@strukt/core/catalog';
import { catalogMatches } from '@strukt/core';
import { randomUUID } from 'node:crypto';
import { BASIC_SHAPES, applyOps, computeRects, defaultSize, emptyModel, labelBox, labelLines, nodeVariant, own, shapeGeometry, syncLayout, visualBox, tableSize, participantSize } from '@strukt/core';
import { CLOUD_COMPONENT_PRESETS } from '@strukt/core/cloud';
import type { DiagramOp } from '@strukt/core';
import { parseDiagramJson, printDiagramJson } from '@strukt/json';
import { autoLayout, compositionOps, suggestComposition, sequenceMessages } from '@strukt/layout';
import { checkProposal, planSnapshot } from '@strukt/ops';
import { addItem, applyEntity, applyRelation, architectureMarkdown, checkStageMeta, createVersion, diagramElement, focusedContext, followRelationIds, graphNeighbors, graphPath, renameFlowSteps, renameItem, searchModel, exceedsDriftBytes, validEvidencePath, withSnippet, writeVersion, TEMPLATES, emptyLibrary, templateFromDiagram, parseLibrary, printLibrary } from '@strukt/workspace';
import type { Evidence } from '@strukt/workspace';
import { readRepositoryFile } from '@strukt/workspace/health';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { diagramSummary, flush, refresh, save, withDiagram, writeContext } from './workspace';
import type { McpWorkspace } from './workspace';
import { DIAGRAM_UI_URI } from './view';

const LIMITS = { doc: 200_000, json: 200_000, ops: 500, query: 200, title: 200, message: 500, evidenceRefs: 20, evidencePath: 500, evidenceContains: 200, evidenceLine: 10_000_000 };

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] });
const fail = (message: string) => ({ isError: true as const, content: [{ type: 'text' as const, text: message }] });

const notFound = (ws: McpWorkspace, slug: string): string =>
  `Diagrama "${slug}" não existe. Disponíveis: ${ws.data.manifest.diagrams.map((d) => d.slug).join(', ') || '(nenhum)'}.`;

function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length]!;
}

/** The existing id closest to `wanted` (case-insensitive containment or a small edit distance), if any. */
function closestId(ids: readonly string[], wanted: string): string | undefined {
  const lower = wanted.toLowerCase();
  const exact = ids.find((id) => id.toLowerCase() === lower);
  if (exact) return exact;
  const scored = ids.map((id) => ({ id, d: editDistance(id.toLowerCase(), lower.slice(0, 100)) })).sort((x, y) => x.d - y.d);
  const best = scored[0];
  return best && best.d <= Math.max(2, Math.floor(lower.length / 3)) ? best.id : undefined;
}

/** A failed global layout must not be presented as a finished diagram. */
async function layoutOf(model: Parameters<typeof autoLayout>[0]) {
  try {
    return await autoLayout(model);
  } catch (error) {
    throw new Error(`Não foi possível organizar o diagrama: ${error instanceof Error ? error.message : String(error)}. Nenhum layout de emergência foi salvo.`);
  }
}

function readabilityNotes(model: Parameters<typeof autoLayout>[0]): string {
  const nodes = model.order.filter((id) => model.elements[id]?.kind === 'node').length;
  return nodes > 24 && model.edges.length > nodes
    ? '\nRevisão visual: esta vista tem muitas relações individuais. Agregue relações entre grupos e leve dependências detalhadas para vistas específicas. Use cards, títulos curtos e metadados para nomes técnicos.'
    : '';
}

/** Applies AI ops to a diagram in the workspace and saves; returns the touched paths. */
async function applyOpsToDiagram(ws: McpWorkspace, slug: string, ops: DiagramOp[]): Promise<{ ok: true; touched: string[] } | { ok: false; error: string }> {
  const snapshot = own(ws.data.diagrams, slug);
  if (!snapshot) return { ok: false, error: notFound(ws, slug) };
  const plan = planSnapshot(snapshot.model, snapshot.layout, ops);
  if (!plan.ok) return { ok: false, error: plan.error };
  let layout = plan.planned.layout;
  if (plan.planned.autoLayout) layout = syncLayout(snapshot.layout, plan.planned.model, ops, await layoutOf(plan.planned.model));
  const before = ws.data;
  withDiagram(ws, slug, { model: plan.planned.model, layout });
  let flows = ws.data.flows;
  let evidence = ws.data.evidence;
  let concerns = ws.data.concerns;
  let shared = ws.data.shared;
  for (const op of ops) if (op.op === 'rename') {
    if (flows?.[slug]) flows = { ...flows, [slug]: renameFlowSteps(flows[slug], op.id, op.to) };
    if (evidence?.[slug]?.[op.id]) {
      const refs = { ...evidence[slug], [op.to]: evidence[slug][op.id] };
      delete refs[op.id];
      evidence = { ...evidence, [slug]: refs };
    }
    if (concerns) concerns = concerns.map((item) => item.diagram === slug && item.element === op.id ? { ...item, element: op.to } : item);
    if (shared?.views[slug]?.[op.id]) {
      const refs = { ...shared.views[slug], [op.to]: shared.views[slug][op.id] };
      delete refs[op.id];
      shared = { ...shared, views: { ...shared.views, [slug]: refs } };
    }
  }
  if (evidence?.[slug]) {
    const refs = evidence[slug];
    const surviving = Object.fromEntries(Object.entries(refs).filter(([id]) => !id.startsWith('edge:') && (own(plan.planned.model.elements, id) || !own(snapshot.model.elements, id))));
    const mapping = followRelationIds(snapshot.model, plan.planned.model, Object.fromEntries(snapshot.model.edges.map((edge) => [edge.id, edge.id])), new Map(ops.filter((op) => op.op === 'rename').map((op) => [op.id, op.to])));
    for (const [next, previous] of Object.entries(mapping)) if (refs[`edge:${previous}`]) surviving[`edge:${next}`] = refs[`edge:${previous}`]!;
    evidence = { ...evidence, [slug]: surviving };
  }
  if (shared?.views[slug]) {
    const entities = { ...shared.entities };
    const diagrams = { ...ws.data.diagrams };
    for (const [local, entityId] of Object.entries(shared.views[slug])) {
      const priorId = ops.filter((op) => op.op === 'rename').find((op) => op.to === local)?.id;
      const old = snapshot.model.elements[local] ?? snapshot.model.elements[priorId ?? ''];
      const el = plan.planned.model.elements[local];
      if (!el || !old || !entities[entityId] || el.label === old.label && el.tech === old.tech && el.description === old.description) continue;
      const entity = { ...entities[entityId]!, label: el.label, tech: el.tech, description: el.description };
      entities[entityId] = entity;
      for (const [otherSlug, view] of Object.entries(shared.views)) for (const [other, ref] of Object.entries(view)) {
        if (ref !== entityId || otherSlug === slug) continue;
        const otherSnapshot = diagrams[otherSlug];
        if (otherSnapshot) diagrams[otherSlug] = { ...otherSnapshot, model: applyEntity(otherSnapshot.model, other, entity) };
      }
    }
    shared = { ...shared, entities };
    ws.data = { ...ws.data, diagrams };
  }
  if (shared?.viewRelations?.[slug]) {
    const renames = new Map(ops.filter((op) => op.op === 'rename').map((op) => [op.id, op.to]));
    const mapping = followRelationIds(snapshot.model, plan.planned.model, shared.viewRelations[slug], renames);
    const relations = { ...shared.relations };
    const diagrams = { ...ws.data.diagrams };
    for (const [edgeId, relationId] of Object.entries(mapping)) {
      const edge = plan.planned.model.edges.find((item) => item.id === edgeId);
      const previousId = Object.entries(shared.viewRelations[slug]).find(([, id]) => id === relationId)?.[0];
      const old = snapshot.model.edges.find((item) => item.id === previousId);
      const relation = relations[relationId];
      if (!edge || !old || !relation || edge.label === old.label && edge.connector === old.connector) continue;
      const updated = { ...relation, connector: edge.connector, ...(edge.label ? { label: edge.label } : {}) };
      if (!edge.label) delete updated.label;
      relations[relationId] = updated;
      for (const [viewSlug, view] of Object.entries(shared.viewRelations)) for (const [other, ref] of Object.entries(view)) {
        if (ref !== relationId || viewSlug === slug) continue;
        const otherSnapshot = diagrams[viewSlug];
        if (otherSnapshot) diagrams[viewSlug] = { ...otherSnapshot, model: applyRelation(otherSnapshot.model, other, updated) };
      }
    }
    shared = { ...shared, relations, viewRelations: { ...shared.viewRelations, [slug]: mapping } };
    ws.data = { ...ws.data, diagrams };
  }
  ws.data = { ...ws.data, flows, evidence, concerns, shared };
  return { ok: true, touched: await save(ws, before) };
}

export function registerTools(server: McpServer, ws: McpWorkspace): void {
  server.registerTool('compose_diagram', {
    title: 'Compor cena de arquitetura',
    description: 'Compõe arquitetura com grupos compactos em colunas, cards alinhados e entradas/serviços compartilhados, ou camadas em cenas sem grupos. Não altera ids/relações/evidências; tabelas/participantes preservam sua apresentação. entry/shared aceitam ids de nós ou grupos de topo; omitidos, sugestões estruturais são usadas e devolvidas.',
    inputSchema: { diagram: z.string(), entry: z.array(z.string()).max(200).optional(), shared: z.array(z.string()).max(200).optional() },
  }, async ({diagram, entry, shared}) => {
    await refresh(ws);
    const snapshot=own(ws.data.diagrams,diagram);
    if(!snapshot)return fail(notFound(ws,diagram));
    const suggestion=suggestComposition(snapshot.model,true);
    const entries=entry??suggestion.entry??[], infrastructure=shared??suggestion.shared??[];
    if(new Set([...entries,...infrastructure]).size!==entries.length+infrastructure.length)return fail('Um componente não pode ocupar duas camadas.');
    for(const id of [...entries,...infrastructure])if(!own(snapshot.model.elements,id)||snapshot.model.elements[id]?.parentId)return fail(`Papel de camada requer componente ou grupo de topo existente: "${id}".`);
    const ops=compositionOps(snapshot.model,{entry:entries,shared:infrastructure});
    const applied=applyOps(snapshot.model,ops);
    if(!applied.ok)return fail(applied.error.message);
    try{
      const nodes=await autoLayout(applied.model);
      const before=ws.data;
      withDiagram(ws,diagram,{model:applied.model,layout:{nodes,edges:{}}});
      const touched=await save(ws,before);
      return ok(`Cena composta. Entrada: ${entries.join(', ')||'(sem entrada sugerida; ELK)'}; compartilhados: ${infrastructure.join(', ')||'(nenhum)'}. Conferir a responsabilidade das camadas e a renderização.\nArquivos: ${touched.join(', ')}`);
    }catch(error){return fail(error instanceof Error?error.message:String(error));}
  });

  server.registerTool('list_components', {
    title: 'Listar componentes visuais',
    description: 'Busca componentes de arquitetura, quântica, blockchain, IA, grafos, estruturas de dados, serviços oficiais cloud e componentes próprios. Use library para uma biblioteca temática. Use category/query para refinar o catálogo.',
    inputSchema: { query: z.string().max(200).optional(), library: z.string().max(100).optional(), category: z.string().max(100).optional(), limit: z.number().int().min(1).max(200).optional() },
  }, async ({ query, category, library, limit }) => {
    await refresh(ws);
    const all = [...(ws.data.library?.components ?? []), ...COMPONENT_PRESETS, ...CLOUD_COMPONENT_PRESETS];
    const matches = all.filter(preset => (!library || preset.libraryId === library) && (!category || preset.category === category) && catalogMatches(query ?? '', preset.id, preset.label, preset.category, preset.description, preset.tech, preset.icon, preset.keywords));
    return ok(JSON.stringify({
      instructions: 'Copie os defaults do preset e use ids/labels do projeto. Presets kind group usam add_group para fronteiras; os demais usam add_node. Ícones oficiais cloud preservam suas cores; grupos definem cloud/VPC/subnets. Tabelas usam presentation table e fields; participantes de sequência usam participant e mensagens na ordem das relações. Crie relações com fromPort/toPort e cardinalidades quando necessário. Componentes próprios são cópias independentes. list_templates traz exemplos completos com posições preparadas.',
      shapes: BASIC_SHAPES,
      libraries: COMPONENT_LIBRARIES,
      categories: [...new Set(all.map((preset) => preset.category))],
      total: matches.length,
      components: matches.slice(0, limit ?? 100),
    }, null, 2));
  });

  server.registerTool('list_templates', {
    title: 'Listar templates e exemplos',
    description: 'Lista exemplos editáveis de cloud, quântica, blockchain, IA, grafos, estruturas de dados, segurança e templates do workspace. Informe id para ler operações e posições completas.',
    inputSchema: { id: z.string().max(200).optional(), query: z.string().max(200).optional(), library: z.string().max(100).optional(), category: z.string().max(100).optional() },
  }, async ({ id, query, category, library }) => {
    await refresh(ws);
    const all = [...(ws.data.library?.templates ?? []), ...TEMPLATES];
    if (id) {
      const found = all.find((item) => item.id === id);
      return found ? ok(JSON.stringify(found, null, 2)) : fail(`Template não encontrado: ${id}. Consulte list_templates.`);
    }
    return ok(JSON.stringify(all.filter((item) => (!library || item.libraryId === library) && (!category || item.category === category) && catalogMatches(query ?? '', item.id, item.title, item.description, item.category, item.keywords)).map(({ops, positions: _positions, ...item}) => ({ ...item, components: ops.filter((op) => op.op === 'add_node').length, connections: ops.filter((op) => op.op === 'connect').length })), null, 2));
  });

  server.registerTool('save_component', {
    title: 'Salvar componente próprio',
    description: 'Salva os padrões de um nó ou fronteira existente na biblioteca deste workspace, sem alterar o diagrama. Pode substituir um preset próprio por id.',
    inputSchema: { diagram: z.string(), element: z.string(), title: z.string().min(1).max(120), category: z.string().max(120).optional(), id: z.string().max(200).optional() },
  }, async ({ diagram, element, title, category, id }) => {
    await refresh(ws);
    const snapshot = own(ws.data.diagrams, diagram), node = snapshot && own(snapshot.model.elements, element);
    if (!node) return fail('Informe um componente existente no diagrama.');
    const componentId = id ?? `custom-${randomUUID()}`;
    const library = ws.data.library ?? emptyLibrary();
    if (id && !library.components.some((item) => item.id === id)) return fail('Só é possível substituir componentes próprios existentes.');
    const {w, h} = snapshot!.layout.nodes[element] ?? {};
    const preset = { id: componentId, label: title, category: category ?? 'Meu workspace', description: node.description ?? '', color: node.color ?? 'gray', icon: node.icon, kind: node.kind, shape: node.kind === 'node' ? node.shape : undefined, presentation: node.presentation, layoutRole: node.layoutRole, tech: node.tech, fields: node.fields, width: w, height: h };
    try {
      const next = parseLibrary(printLibrary({ ...library, components: [...library.components.filter((item) => item.id !== componentId), preset] }));
      const before = ws.data;
      ws.data = { ...ws.data, library: next };
      const touched = await save(ws, before);
      return ok(`Componente ${componentId} salvo. Arquivos: ${touched.join(', ')}`);
    } catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
  });

  server.registerTool('save_template', {
    title: 'Salvar template do workspace',
    description: 'Salva um diagrama existente com componentes, relações e posições como template reutilizável deste workspace.',
    inputSchema: { diagram: z.string(), title: z.string().min(1).max(120), description: z.string().max(2000).optional() },
  }, async ({ diagram, title, description }) => {
    await refresh(ws);
    const snapshot = own(ws.data.diagrams, diagram);
    if (!snapshot) return fail(notFound(ws, diagram));
    try {
      const template = templateFromDiagram(`custom-${randomUUID()}`, title, description ?? '', snapshot.model, snapshot.layout.nodes);
      const library = ws.data.library ?? emptyLibrary();
      const before = ws.data;
      ws.data = { ...ws.data, library: { ...library, templates: [...library.templates, template] } };
      const touched = await save(ws, before);
      return ok(`Template ${template.id} salvo. Use create_diagram com template: "${template.id}". Arquivos: ${touched.join(', ')}`);
    } catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
  });
  server.registerTool(
    'list_diagrams',
    {
      title: 'Listar diagramas',
      description: 'Lista os diagramas e documentos do workspace .arch/ aberto, com contagens.',
      inputSchema: {},
    },
    async () => {
      await refresh(ws);
      const { manifest } = ws.data;
      const lines = [`Workspace "${manifest.name}" (${ws.archDir})`, '', 'Diagramas:'];
      if (!manifest.diagrams.length) lines.push('  (nenhum)');
      for (const { slug, title } of manifest.diagrams) {
        const model = own(ws.data.diagrams, slug)?.model;
        lines.push(`  ${slug} — "${title}" (${model ? `${model.order.length} componentes, ${model.edges.length} conexões` : 'vazio'})`);
      }
      lines.push('', 'Documentos:');
      if (!manifest.docs.length) lines.push('  (nenhum)');
      for (const { slug, title } of manifest.docs) lines.push(`  ${slug} — "${title}"`);
      return ok(lines.join('\n'));
    },
  );

  server.registerTool(
    'get_diagram',
    {
      title: 'Ler diagrama',
      description: 'Devolve o JSON canônico de um diagrama (nós, grupos, conexões e estilo) e um resumo.',
      inputSchema: { diagram: z.string().describe('Slug do diagrama (veja list_diagrams).') },
    },
    async ({ diagram }) => {
      await refresh(ws);
      const snapshot = own(ws.data.diagrams, diagram);
      if (!snapshot) return fail(notFound(ws, diagram));
      return ok(`${diagramSummary(diagram, ws.data)}\n\n${printDiagramJson(snapshot.model)}`);
    },
  );

  server.registerTool('view_diagram', {
    title: 'Visualizar diagrama',
    description: 'Mostra o diagrama interativo em clientes com MCP Apps e devolve um resumo textual nos demais.',
    inputSchema: { diagram: z.string() },
    _meta: { ui: { resourceUri: DIAGRAM_UI_URI } },
  }, async ({ diagram }) => {
    await refresh(ws);
    const snapshot = own(ws.data.diagrams, diagram);
    if (!snapshot) return fail(notFound(ws, diagram));
    const title = ws.data.manifest.diagrams.find((entry) => entry.slug === diagram)?.title ?? diagram;
    const rects = computeRects(snapshot.model, snapshot.layout);
    for (const el of Object.values(snapshot.model.elements)) if (el.kind === 'node' && nodeVariant(el) === 'icon') rects[el.id] = visualBox(el, rects[el.id]!);
    return {
      content: [{ type: 'text' as const, text: diagramSummary(diagram, ws.data) }],
      structuredContent: {
        title,
        nodes: snapshot.model.order.map((id) => {
          const el = snapshot.model.elements[id]!, rect = rects[id]!;
          const box = el.kind === 'group' ? { x: 12, y: 8, w: rect.w - 24, h: 24 } : labelBox(el.shape ?? 'rectangle', rect.w, rect.h);
          return { id, kind: el.kind, label: el.label, tech: el.tech, description: el.description, presentation: el.presentation, fields: el.fields,
            ...(el.kind === 'node' && el.presentation === 'table' ? { headerHeight: tableSize(el, rect.w).header } : {}),
            ...(el.kind === 'node' && el.presentation === 'participant' ? { headerHeight: participantSize(el, rect.w).h } : {}),
            ...(el.kind === 'node' ? { geometry: shapeGeometry(el.shape ?? 'rectangle', rect.w, rect.h) } : {}),
            labelBox: box, lines: labelLines(el.label ?? id, Math.max(24, box.w - 24), 13),
          };
        }),
        edges: snapshot.model.edges.map(({span: _span, ...edge}) => edge),
        messages: sequenceMessages(snapshot.model, rects),
        layout: rects,
      },
    };
  });

  server.registerTool(
    'search_elements',
    {
      title: 'Buscar elementos',
      description: 'Procura elementos por nome, rótulo, tecnologia ou descrição em todos os diagramas (ou em um).',
      inputSchema: {
        query: z.string().max(LIMITS.query).describe('Texto a procurar (sem diferenciar maiúsculas).'),
        diagram: z.string().optional().describe('Limita a busca a este diagrama.'),
      },
    },
    async ({ query, diagram }) => {
      await refresh(ws);
      const needle = query.trim().toLowerCase();
      if (!needle) return fail('Informe um texto para buscar.');
      const slugs = diagram ? [diagram] : ws.data.manifest.diagrams.map((d) => d.slug);
      const matches: string[] = [];
      for (const slug of slugs) {
        const model = own(ws.data.diagrams, slug)?.model;
        if (!model) continue;
        for (const id of model.order) {
          const el = model.elements[id]!;
          const haystack = [id, el.label, el.tech, el.description].filter((value): value is string => typeof value === 'string').join(' ').toLowerCase();
          if (!haystack.includes(needle)) continue;
          const bits = [`${slug}: "${id}"`];
          if (el.label) bits.push(`(${el.label})`);
          if (el.tech) bits.push(`— ${el.tech}`);
          if (el.description) bits.push(`— ${el.description}`);
          matches.push(bits.join(' '));
          if (matches.length >= 50) break;
        }
      }
      return ok(matches.length ? matches.join('\n') : `Nenhum elemento encontrado para "${query}".`);
    },
  );

  server.registerTool(
    'search_model',
    {
      title: 'Buscar no modelo',
      description: 'Busca somente leitura em todos os diagramas (ou em um): id, rótulo, tecnologia, descrição e tags. Devolve diagrama, id, tipo, rótulo, tecnologia, nº de evidências e grau de conexões, ordenados por relevância.',
      inputSchema: {
        query: z.string().describe('Texto a procurar (sem diferenciar maiúsculas e acentos; até 200 caracteres).'),
        diagram: z.string().optional().describe('Limita a busca a este diagrama.'),
        limit: z.number().int().min(1).max(50).optional().describe('Máximo de resultados (1 a 50; padrão 20).'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, diagram, limit }) => {
      if (!query.trim()) return fail('Informe um texto para buscar.');
      if (query.length > LIMITS.query) return fail(`A busca aceita até ${LIMITS.query} caracteres.`);
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 50)) return fail('O limite deve ser um inteiro entre 1 e 50.');
      await refresh(ws);
      const cut = (text: string | undefined) => (text !== undefined && text.length > 200 ? `${text.slice(0, 199)}…` : text);
      const results = searchModel(ws.data, { query, diagram, limit: limit ?? 20 }).map(({ score: _score, tags, ...hit }) => ({
        ...hit, label: cut(hit.label), tech: cut(hit.tech), description: cut(hit.description), tags: tags.slice(0, 10).map((tag) => cut(tag)),
      }));
      return ok(JSON.stringify({ query: query.trim(), count: results.length, results }, null, 2));
    },
  );

  server.registerTool(
    'get_doc',
    {
      title: 'Ler documento',
      description: 'Devolve o Markdown de um documento do workspace.',
      inputSchema: { slug: z.string().describe('Slug do documento (veja list_diagrams).') },
    },
    async ({ slug }) => {
      await refresh(ws);
      const markdown = own(ws.data.docs, slug);
      if (markdown === undefined) return fail(`Documento "${slug}" não existe. Disponíveis: ${ws.data.manifest.docs.map((d) => d.slug).join(', ') || '(nenhum)'}.`);
      return ok(markdown);
    },
  );

  server.registerTool(
    'get_architecture',
    {
      title: 'Ler arquitetura',
      description: 'Devolve o ARCHITECTURE.md gerado a partir do workspace (todos os diagramas, componentes, conexões e documentos).',
      inputSchema: {},
    },
    async () => { await refresh(ws); return ok(architectureMarkdown(ws.data)); },
  );

  server.registerTool('get_element', {
    title: 'Ler componente',
    description: 'Devolve um componente específico sem carregar todos os diagramas.',
    inputSchema: { diagram: z.string(), id: z.string() },
  }, async ({ diagram, id }) => {
    await refresh(ws);
    const element = diagramElement(ws.data, diagram, id);
    const sharedEntity = own(ws.data.shared?.views[diagram] ?? {}, id);
    return element ? ok(JSON.stringify({ ...element, ...(sharedEntity ? { sharedEntity } : {}) }, null, 2)) : fail(`Elemento "${id}" não encontrado em "${diagram}".`);
  });

  server.registerTool('get_entity_views', {
    title: 'Encontrar visões da entidade',
    description: 'Lista todos os diagramas e elementos que representam uma entidade compartilhada.',
    inputSchema: { entity: z.string() },
  }, async ({ entity }) => {
    await refresh(ws);
    const shared = ws.data.shared;
    const item = own(shared?.entities ?? {}, entity);
    if (!item) return fail(`Entidade "${entity}" não encontrada.`);
    const views = Object.entries(shared?.views ?? {}).flatMap(([diagram, mapping]) => Object.entries(mapping).filter(([, id]) => id === entity).map(([localId]) => ({ diagram, localId })));
    return ok(JSON.stringify({ entity: item, views }, null, 2));
  });

  server.registerTool('get_relation', {
    title: 'Ler relação compartilhada',
    description: 'Devolve uma relação do modelo e os diagramas onde ela aparece.',
    inputSchema: { relation: z.string() },
  }, async ({ relation }) => {
    await refresh(ws);
    const item = own(ws.data.shared?.relations ?? {}, relation);
    if (!item) return fail(`Relação "${relation}" não encontrada.`);
    const views = Object.entries(ws.data.shared?.viewRelations ?? {}).flatMap(([diagram, mapping]) => Object.entries(mapping).filter(([, id]) => id === relation).map(([edgeId]) => ({ diagram, edgeId })));
    return ok(JSON.stringify({ relation: item, views }, null, 2));
  });

  server.registerTool('get_neighbors', {
    title: 'Consultar vizinhança',
    description: 'Mostra componentes e conexões próximos de um componente.',
    inputSchema: { diagram: z.string(), id: z.string(), depth: z.number().int().min(1).max(4).default(1) },
  }, async ({ diagram, id, depth }) => {
    await refresh(ws);
    const model = own(ws.data.diagrams, diagram)?.model;
    if (!model || !own(model.elements, id)) return fail(`Elemento "${id}" não encontrado em "${diagram}".`);
    return ok(JSON.stringify(graphNeighbors(model, id, depth), null, 2));
  });

  server.registerTool('find_path', {
    title: 'Encontrar caminho',
    description: 'Encontra o menor caminho dirigido entre dois componentes de um diagrama.',
    inputSchema: { diagram: z.string(), from: z.string(), to: z.string() },
  }, async ({ diagram, from, to }) => {
    await refresh(ws);
    const model = own(ws.data.diagrams, diagram)?.model;
    if (!model) return fail(notFound(ws, diagram));
    const path = graphPath(model, from, to);
    return path ? ok(JSON.stringify(path, null, 2)) : fail(`Não há caminho de "${from}" para "${to}" em "${diagram}".`);
  });

  server.registerTool('get_context', {
    title: 'Ler contexto focado',
    description: 'Resumo de um diagrama ou de um componente e suas conexões próximas.',
    inputSchema: { diagram: z.string(), id: z.string().optional() },
  }, async ({ diagram, id }) => {
    await refresh(ws);
    const context = focusedContext(ws.data, diagram, id);
    return context ? ok(context) : fail(id ? `Elemento "${id}" não encontrado em "${diagram}".` : notFound(ws, diagram));
  });

  server.registerTool('get_flows', {
    title: 'Ler fluxos guiados',
    description: 'Lista os cenários e passos de um diagrama, inclusive conexões que ficaram ausentes.',
    inputSchema: { diagram: z.string() },
  }, async ({ diagram }) => {
    await refresh(ws);
    if (!own(ws.data.diagrams, diagram)) return fail(notFound(ws, diagram));
    return ok(JSON.stringify(own(ws.data.flows ?? {}, diagram) ?? [], null, 2));
  });

  server.registerTool(
    'create_diagram',
    {
      title: 'Criar diagrama',
      description:
        'Cria um diagrama novo. Passe "json" (documento canônico completo) ou "ops" (operações do mesmo schema de apply_diagram_ops, a partir de um diagrama vazio). Use "template" para criar a partir de um modelo com posições preparadas.',
      inputSchema: {
        title: z.string().min(1).max(LIMITS.title).describe('Título do diagrama (vira o slug do arquivo).'),
        template: z.string().max(200).optional().describe('Id retornado por list_templates, incluindo templates próprios.'),
        json: z.string().max(LIMITS.json).optional().describe('O diagrama inteiro em JSON canônico.'),
        ops: z.array(z.unknown()).max(LIMITS.ops).optional().describe('Operações (add_node, connect, …) para montar o diagrama.'),
        summary: z.string().max(LIMITS.message).optional().describe('Uma frase explicando o diagrama.'),
        composition: z.object({ entry: z.array(z.string()).optional(), shared: z.array(z.string()).optional() }).optional().describe('Composição de arquitetura com cards; entry/shared são ids de topo e definem camadas visuais.'),
      },
    },
    async ({ title, template, json, ops, summary, composition }) => {
      await refresh(ws);
      if ([template, json, ops].filter((value) => value !== undefined).length !== 1) return fail('Informe exatamente um de template, json ou ops.');
      const source = template ? [...(ws.data.library?.templates ?? []), ...TEMPLATES].find((item) => item.id === template) : undefined;
      let model;
      if (template) {
        if (!source) return fail(`Template não encontrado: ${template}. Consulte list_templates.`);
        const applied = applyOps(emptyModel(), source.ops);
        if (!applied.ok) return fail(applied.error.message);
        model = applied.model;
      } else if (json !== undefined) {
        const parsed = parseDiagramJson(json);
        const error = parsed.diagnostics.find((d) => d.severity === 'error');
        if (error) return fail(`JSON inválido (linha ${error.line}): ${error.message}`);
        model = parsed.model;
      } else if (ops !== undefined) {
        const check = checkProposal({ ops, summary: summary ?? 'Diagrama criado pelo agente.' }, 'edit', emptyModel());
        if (!check.ok) return fail(check.error);
        const applied = applyOps(emptyModel(), check.ops);
        if (!applied.ok) return fail(applied.error.message);
        model = applied.model;
      } else {
        return fail('Informe "json" (o diagrama completo) ou "ops" (as operações).');
      }
      if (!model.order.length) return fail('O diagrama ficou vazio.');
      if(composition){
        const suggestion=suggestComposition(model,true), entries=composition.entry??suggestion.entry??[], shared=composition.shared??suggestion.shared??[];
        for(const id of [...entries,...shared])if(!own(model.elements,id)||model.elements[id]?.parentId)return fail(`Componente de camada inválido: ${id}`);
        if(new Set([...entries,...shared]).size!==entries.length+shared.length)return fail('Camadas duplicadas.');
        const patches=compositionOps(model,{entry:entries,shared});
        const result=applyOps(model,patches);if(!result.ok)return fail(result.error.message);model=result.model;
      }
      const before = ws.data;
      let nodes;
      try { nodes = source?.positions && !composition ? source.positions : await layoutOf(model); }
      catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
      const { data, slug } = addItem(ws.data, 'diagram', title, { model, layout: { nodes, edges: {} } });
      ws.data = data;
      const touched = await save(ws, before);
      return ok(`Diagrama "${slug}" criado. ${diagramSummary(slug, ws.data)}${readabilityNotes(model)}\nArquivos: ${touched.join(', ')}`);
    },
  );

  server.registerTool(
    'apply_ops',
    {
      title: 'Editar diagrama',
      description:
        'Aplica um lote de operações ao diagrama (mesmo schema da IA: add_node, add_group, connect, insert_between, update, update_edge, rename, move_to_group, remove, remove_edge, set_style). O lote é atômico; um erro não altera nada.',
      inputSchema: {
        diagram: z.string().describe('Slug do diagrama a editar.'),
        ops: z.array(z.unknown()).min(1).max(LIMITS.ops).describe('Operações, aplicadas em ordem e de forma atômica.'),
        summary: z.string().min(1).max(LIMITS.message).describe('Uma ou duas frases em pt-BR explicando a mudança.'),
      },
    },
    async ({ diagram, ops, summary }) => {
      await refresh(ws);
      const snapshot = own(ws.data.diagrams, diagram);
      if (!snapshot) return fail(notFound(ws, diagram));
      const check = checkProposal({ ops, summary }, 'edit', snapshot.model);
      if (!check.ok) return fail(check.error);
      let applied;
      try { applied = await applyOpsToDiagram(ws, diagram, check.ops); }
      catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
      if (!applied.ok) return fail(applied.error);
      return ok(`${check.summary}\n${diagramSummary(diagram, ws.data)}${readabilityNotes(ws.data.diagrams[diagram]!.model)}\nArquivos: ${applied.touched.join(', ')}`);
    },
  );

  server.registerTool('reorganize_diagram', {
    title: 'Reorganizar diagrama',
    description: 'Recalcula as posições com composição compacta ou ELK, respeitando grupos e legendas. Mantém componentes, conexões, evidências e fluxos; invalida somente o cache de rotas. Use após mudanças grandes na composição e confira o resultado visual.',
    inputSchema: {
      diagram: z.string(),
      positions: z.array(z.object({
        id: z.string(),
        x: z.number().finite().min(-100_000).max(100_000),
        y: z.number().finite().min(-100_000).max(100_000),
      })).max(500).optional().describe('Posições finais opcionais de componentes (coordenadas absolutas do canvas), após o layout automático. Grupos envolvem seus membros automaticamente; posicione os membros, não o grupo.'),
    },
  }, async ({ diagram, positions: finalPositions }) => {
    await refresh(ws);
    const snapshot = own(ws.data.diagrams, diagram);
    if (!snapshot) return fail(notFound(ws, diagram));
    const positioned = new Set<string>();
    for (const position of finalPositions ?? []) {
      if (own(snapshot.model.elements, position.id)?.kind !== 'node') return fail(`Posicione um componente existente, não um grupo: "${position.id}".`);
      if (positioned.has(position.id)) return fail(`Posição repetida para "${position.id}".`);
      positioned.add(position.id);
    }
    try {
      const sizes = Object.fromEntries(Object.entries(snapshot.layout.nodes).flatMap(([id, box]) => {
        const el = snapshot.model.elements[id];
        if (!el || box.w === undefined && box.h === undefined) return [];
        const size = defaultSize(el);
        return [[id, { w: box.w ?? size.w, h: box.h ?? size.h }]];
      }));
      const positions = await autoLayout(snapshot.model, sizes);
      const nodes = Object.fromEntries(Object.entries(positions).map(([id, position]) => {
        const old = snapshot.layout.nodes[id];
        return [id, { ...position, ...(old?.w !== undefined ? { w: old.w } : {}), ...(old?.h !== undefined ? { h: old.h } : {}) }];
      }));
      for (const position of finalPositions ?? []) nodes[position.id] = { ...nodes[position.id]!, x: position.x, y: position.y };
      const before = ws.data;
      withDiagram(ws, diagram, { ...snapshot, layout: { nodes, edges: {} } });
      const touched = await save(ws, before);
      return ok(`Diagrama "${diagram}" reorganizado com o motor de composição/layout.${readabilityNotes(snapshot.model)}\nArquivos: ${touched.join(', ')}`);
    } catch (error) { return fail(`Não foi possível reorganizar: ${error instanceof Error ? error.message : String(error)}`); }
  });

  server.registerTool(
    'write_doc',
    {
      title: 'Escrever documento',
      description: 'Cria (sem slug) ou atualiza um documento Markdown do workspace. O conteúdo é seu: escreva o documento completo.',
      inputSchema: {
        title: z.string().min(1).max(LIMITS.title).describe('Título do documento.'),
        markdown: z.string().max(LIMITS.doc).describe('O documento completo em Markdown.'),
        slug: z.string().optional().describe('Slug do documento existente (atualiza em vez de criar).'),
      },
    },
    async ({ title, markdown, slug }) => {
      await refresh(ws);
      const before = ws.data;
      let target = slug;
      if (target !== undefined && own(ws.data.docs, target) !== undefined) {
        const current = ws.data;
        ws.data = { ...renameItem(current, 'doc', target, title), docs: { ...current.docs, [target]: markdown } };
      } else if (target !== undefined) {
        return fail(`Documento "${target}" não existe. Omita "slug" para criar um novo.`);
      } else {
        const created = addItem(ws.data, 'doc', title, markdown);
        ws.data = created.data;
        target = created.slug;
      }
      const touched = await save(ws, before);
      return ok(`Documento "${target}" salvo (${markdown.length} caracteres).\nArquivos: ${touched.join(', ')}`);
    },
  );

  server.registerTool(
    'save_version',
    {
      title: 'Salvar versão',
      description: 'Salva uma versão do diagrama (autor "agent") em .arch/versions/. Versões nunca são apagadas. Com stage "planejado" (ou "transição") e target (AAAA-MM-DD), salva o diagrama como um estado futuro na linha do tempo (veja get_timeline).',
      inputSchema: {
        diagram: z.string().describe('Slug do diagrama.'),
        message: z.string().min(1).max(LIMITS.message).describe('Descrição da versão.'),
        stage: z.string().max(40).optional().describe('Estágio: atual (padrão), transição ou planejado.'),
        target: z.string().max(40).optional().describe('Data-meta AAAA-MM-DD (só para transição ou planejado).'),
      },
    },
    async ({ diagram, message, stage, target }) => {
      await refresh(ws);
      const snapshot = own(ws.data.diagrams, diagram);
      if (!snapshot) return fail(notFound(ws, diagram));
      const staged = checkStageMeta(stage, target);
      if (!staged.ok) return fail(staged.error);
      const version = createVersion(snapshot, {
        id: randomUUID().replace(/-/g, '').slice(0, 8),
        createdAt: new Date().toISOString(),
        message,
        author: 'agent',
        ...staged.meta,
        ...(own(ws.data.flows ?? {}, diagram) ? { flows: own(ws.data.flows ?? {}, diagram) } : {}),
      });
      const entry = await writeVersion(ws.adapter, diagram, version);
      await flush(ws);
      ws.notify?.({ event: 'version', diagram, message, author: 'agent' });
      return ok(`Versão "${message}" salva em ${entry.path}.`);
    },
  );

  server.registerTool(
    'add_evidence',
    {
      title: 'Registrar evidências',
      description:
        'Registra referências de código (path, line, contains) como evidência de um componente (ou conexão "edge:<id>") em .arch/evidence.json, com validação. Mescla com o que já existe, sem duplicar; preenche o snippet quando o arquivo é legível no repositório. Depois rode `joinlet check --drift`.',
      inputSchema: {
        diagram: z.string().min(1).max(LIMITS.title).describe('Slug do diagrama.'),
        id: z.string().min(1).max(LIMITS.title).describe('Id do componente (ou "edge:<id>" de uma conexão).'),
        replace: z.boolean().optional().describe('Substitui as referências deste elemento após revisar a evidência atual; padrão: mesclar.'),
        refs: z.array(z.object({
          path: z.string().min(1).max(LIMITS.evidencePath).describe('Caminho relativo à raiz do repositório (sem "..", absoluto ou "C:").'),
          line: z.number().int().min(1).max(LIMITS.evidenceLine).optional().describe('Linha (1-based) do arquivo.'),
          contains: z.string().max(LIMITS.evidenceContains).optional().describe('Trecho esperado na linha/arquivo.'),
        })).min(1).max(LIMITS.evidenceRefs).describe('De 1 a 20 referências.'),
      },
    },
    async ({ diagram, id, refs, replace }) => {
      await refresh(ws);
      const model = own(ws.data.diagrams, diagram)?.model;
      if (!model) return fail(notFound(ws, diagram));
      const edgeIds = model.edges.map((edge) => `edge:${edge.id}`);
      if (!own(model.elements, id) && !edgeIds.includes(id)) {
        const near = closestId([...model.order, ...edgeIds], id);
        return fail(`Elemento "${id}" não existe em "${diagram}".${near ? ` Você quis dizer "${near}"?` : ''}`);
      }
      const current = own(ws.data.evidence ?? {}, diagram) ?? {};
      const list = replace ? [] : [...(own(current, id) ?? [])];
      const added: string[] = [];
      const skipped: string[] = [];
      for (const ref of refs) {
        const label = `${ref.path.slice(0, 80).replace(/[\u0000-\u001f\u007f]/g, '?')}${ref.line ? `:${ref.line}` : ''}`;
        if (!validEvidencePath(ref.path)) { skipped.push(`${label} (caminho inválido: use um caminho relativo à raiz do repositório, sem "..", absoluto, "C:" ou NUL)`); continue; }
        if (ref.contains !== undefined && /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(ref.contains)) { skipped.push(`${label} ("contains" com caracteres de controle)`); continue; }
        if (list.some((item) => item.path === ref.path && item.line === ref.line)) { skipped.push(`${label} (já registrada)`); continue; }
        let entry: Evidence = { path: ref.path, ...(ref.line ? { line: ref.line } : {}), ...(ref.contains ? { contains: ref.contains } : {}) };
        if (ref.line) {
          const text = ws.repositoryReader ? await ws.repositoryReader.read(ref.path) : await readRepositoryFile(ws.root, ref.path);
          if (text !== null && !exceedsDriftBytes(text)) entry = withSnippet(entry, text);
        }
        list.push(entry);
        added.push(label);
      }
      if (!added.length) return fail(`Nenhuma evidência adicionada.\nIgnoradas: ${skipped.join('; ')}`);
      const before = ws.data;
      ws.data = { ...ws.data, evidence: { ...ws.data.evidence, [diagram]: { ...current, [id]: list } } };
      const touched = await save(ws, before);
      const snapped = list.filter((item) => item.snippet).length;
      return ok(`${added.length} evidência(s) adicionada(s) a "${id}" em "${diagram}" (${snapped} com snippet): ${added.join(', ')}.${skipped.length ? `\nIgnoradas: ${skipped.join('; ')}` : ''}\nArquivos: ${touched.join(', ')}\nRode \`joinlet check --dir . --drift\` para conferir com o código.`);
    },
  );

  server.registerTool(
    'generate_context',
    {
      title: 'Gerar contexto para agentes',
      description: 'Escreve/atualiza .arch/context/ (ARCHITECTURE.md, llms.txt e um arquivo por diagrama).',
      inputSchema: {},
    },
    async () => {
      await refresh(ws);
      const touched = await writeContext(ws, ws.data);
      return ok(touched.length ? `Contexto atualizado: ${touched.join(', ')}` : 'O contexto já estava atualizado.');
    },
  );
}
