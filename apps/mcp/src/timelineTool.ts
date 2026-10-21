import { own } from '@strukt/core';
import { buildTimeline, listVersions, nextGoal, parseStage } from '@strukt/workspace';
import type { Timeline, TimelinePoint, VersionStage } from '@strukt/workspace';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { refresh } from './workspace';
import type { McpWorkspace } from './workspace';

const fail = (message: string) => ({ isError: true as const, content: [{ type: 'text' as const, text: message }] });

function pointOf(point: TimelinePoint) {
  if (point.kind === 'today') return { kind: 'today', stage: 'atual', date: point.date, daysFromToday: 0 };
  const { version } = point.entry!;
  return {
    kind: 'version',
    id: version.id,
    stage: point.stage,
    message: version.message,
    author: version.author,
    createdAt: version.createdAt,
    target: version.target ?? null,
    date: point.date,
    daysFromToday: point.days,
    ...(point.overdue ? { overdue: true } : {}),
    path: point.entry!.path,
  };
}

const describeTimeline = (diagram: string, timeline: Timeline, stage: VersionStage | null) => {
  const goal = nextGoal(timeline);
  return {
    diagram,
    points: timeline.points.filter((p) => stage === null || (p.kind === 'version' && p.stage === stage)).map(pointOf),
    nextGoal: goal ? pointOf(goal) : null,
  };
};

/** `get_timeline`: read-only. The saved states of a diagram on one axis: past versions, today, planned and transition states by goal. */
export function registerTimeline(server: McpServer, ws: McpWorkspace): void {
  server.registerTool(
    'get_timeline',
    {
      title: 'Ler a linha do tempo',
      description:
        'Mostra os estados salvos de um diagrama (ou de todos) num eixo do tempo: versões passadas (estágio "atual"), hoje, e os estados "transição" e "planejado" por data-meta, com a contagem de dias até cada meta e a próxima meta. Para planejar um estado futuro, use save_version com stage e target. Somente leitura.',
      inputSchema: {
        diagram: z.string().optional().describe('Slug do diagrama (padrão: todos).'),
        stage: z.string().optional().describe('Filtra por estágio: atual, transição (ou transicao) ou planejado.'),
      },
    },
    async ({ diagram, stage }) => {
      await refresh(ws);
      const wanted = stage === undefined ? null : parseStage(stage);
      if (stage !== undefined && wanted === null) return fail('Estágio inválido. Use atual, transição ou planejado.');
      const slugs = diagram === undefined ? ws.data.manifest.diagrams.map((d) => d.slug) : own(ws.data.diagrams, diagram) ? [diagram] : null;
      if (!slugs) return fail(`Diagrama "${diagram}" não existe. Disponíveis: ${ws.data.manifest.diagrams.map((d) => d.slug).join(', ') || '(nenhum)'}.`);
      const now = new Date();
      const diagrams = [];
      for (const slug of slugs) diagrams.push(describeTimeline(slug, buildTimeline((await listVersions(ws.adapter, slug)).entries, now), wanted));
      const today = buildTimeline([], now).today;
      return { content: [{ type: 'text' as const, text: JSON.stringify({ today, diagrams }, null, 2) }] };
    },
  );
}
