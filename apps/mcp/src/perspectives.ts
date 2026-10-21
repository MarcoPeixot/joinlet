import { own } from '@strukt/core';
import { allPerspectives, isBuiltinPerspective, levelOf, projectPerspective, resolvePerspective, sharedTagsOf } from '@strukt/workspace';
import type { Perspective } from '@strukt/workspace';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { refresh } from './workspace';
import type { McpWorkspace } from './workspace';

const MAX_IDS = 500;
const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ isError: true as const, content: [{ type: 'text' as const, text: message }] });
const cap = (ids: Iterable<string>) => {
  const all = [...ids];
  return all.length > MAX_IDS ? { ids: all.slice(0, MAX_IDS), omitted: all.length - MAX_IDS } : { ids: all };
};

/**
 * `get_perspectives`: read-only. A perspective is a named way of reading a diagram (by tags, C4 level, included or
 * hidden elements); the diagram itself is never changed by it. Agents use it to ask "what does the Contexto view
 * contain?" without redrawing anything.
 */
export function registerPerspectives(server: McpServer, ws: McpWorkspace): void {
  server.registerTool(
    'get_perspectives',
    {
      title: 'Ler perspectivas e níveis C4',
      description:
        'Lista as perspectivas de um diagrama (as salvas em .arch/diagrams/<slug>.perspectives.json e as predefinições "C4: Contexto/Containers/Componentes") e os níveis C4 (tag nivel:contexto|container|componente das entidades compartilhadas). Com "perspective", devolve o que ela mostra: elementos visíveis, ocultos, esmaecidos, grupos recolhidos e as conexões resultantes. Somente leitura; sem "diagram", resume todos os diagramas.',
      inputSchema: { diagram: z.string().optional(), perspective: z.string().optional() },
    },
    async ({ diagram, perspective }) => {
      await refresh(ws);
      const describe = (slug: string) => {
        const saved = own(ws.data.perspectives ?? {}, slug);
        const model = own(ws.data.diagrams, slug)?.model;
        const tagsOf = sharedTagsOf(ws.data.shared, slug);
        const shows = (item: Perspective) => {
          if (!model) return undefined;
          const { counts } = resolvePerspective(model, tagsOf, item);
          return { shown: counts.shown, of: counts.total };
        };
        return {
          diagram: slug,
          perspectives: allPerspectives(saved).map((item) => ({ ...item, builtin: isBuiltinPerspective(item.id) && !saved?.some((entry) => entry.id === item.id), shows: shows(item) })),
          levels: model ? Object.fromEntries(model.order.flatMap((id) => { const level = levelOf(tagsOf(id)); return level ? [[id, level]] : []; })) : {},
        };
      };
      if (!diagram) return text(ws.data.manifest.diagrams.map(({ slug }) => { const { perspectives, levels } = describe(slug); return { diagram: slug, perspectives: perspectives.map(({ id, name, builtin }) => ({ id, name, builtin })), leveled: Object.keys(levels).length }; }));
      const snapshot = own(ws.data.diagrams, diagram);
      if (!snapshot) return fail(`Diagrama "${diagram}" não encontrado. Diagramas: ${ws.data.manifest.diagrams.map((item) => item.slug).join(', ') || 'nenhum'}.`);
      const base = describe(diagram);
      if (!perspective) return text(base);
      const chosen = allPerspectives(own(ws.data.perspectives ?? {}, diagram)).find((item) => item.id === perspective);
      if (!chosen) return fail(`Perspectiva "${perspective}" não encontrada em "${diagram}". Perspectivas: ${base.perspectives.map((item) => item.id).join(', ')}.`);
      const view = resolvePerspective(snapshot.model, sharedTagsOf(ws.data.shared, diagram), chosen);
      const projected = projectPerspective(snapshot.model, snapshot.layout, view);
      return text({
        diagram,
        perspective: chosen.id,
        name: chosen.name,
        shown: cap(view.shown),
        hidden: cap(view.hidden),
        dimmed: cap(view.dimmed),
        collapsedGroups: cap(view.boxes),
        connections: projected.model.edges.slice(0, MAX_IDS).map((edge) => ({ from: edge.from, to: edge.to, ...(edge.label ? { label: edge.label } : {}) })),
      });
    },
  );
}
