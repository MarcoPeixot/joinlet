import { planSync, renderSyncReport, implementationPlan } from '@strukt/workspace/sync';
import { isAbsolute } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { refresh } from './workspace';
import type { McpWorkspace } from './workspace';

/**
 * `get_sync_status`: read-only. Runs the same plan as `joinlet sync --check` (importers over the repository files,
 * three-way merge in memory) and reports per source and diagram what would change. Nothing is written.
 */
export function registerSync(server: McpServer, ws: McpWorkspace): void {
  server.registerTool('get_implementation_plan', {
    title: 'Code and architecture implementation handoff',
    description: 'Read-only comparison of configured repository sources and desired architecture, with changed components, connections, file paths and next verification steps. Does not generate or modify application code. Run on a local checkout; hosted GitHub sessions do not have repository source files.',
    inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false },
  }, async () => {
    try {
      if (!isAbsolute(ws.root)) throw new Error('Repository source analysis requires a local checkout. Run joinlet verify --json in the repository or connect the local MCP server.');
      await refresh(ws);
      const plan = await planSync({ root: ws.root, adapter: ws.adapter, data: ws.data });
      return { content: [{ type: 'text' as const, text: JSON.stringify(implementationPlan(plan, ws.data), null, 2) }] };
    } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: String(error) }] }; }
  });
  server.registerTool(
    'get_sync_status',
    {
      title: 'Estado da sincronização com as fontes',
      description:
        'Compara os arquivos do repositório listados em .arch/sources.json (Terraform, Kubernetes, OpenAPI, D2, Mermaid, LikeC4, Structurizr) com os diagramas e diz se estão em dia, o que entraria/sairia numa sincronização (joinlet sync) e o que é preservado do trabalho manual. Somente leitura: nada é gravado.',
      inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => {
      try {
        if (!isAbsolute(ws.root)) throw new Error('Source synchronization requires a local checkout. Use joinlet verify --json in the repository; this hosted MCP session only has .arch files.');
        await refresh(ws);
        const plan = await planSync({ root: ws.root, adapter: ws.adapter, data: ws.data });
        const handoff = implementationPlan(plan, ws.data);
        const stale = plan.stale ? 'DESATUALIZADO' : handoff.diagrams.some(d => d.reviewRequired) ? 'REVISÃO NECESSÁRIA (diagrama e fontes divergem; consulte get_implementation_plan)' : 'EM DIA';
        const header = !plan.configured ? '' : plan.errors.length || plan.problems.length ? 'ESTADO: COM ERROS\n\n' : `ESTADO: ${stale}\n\n`;
        return { content: [{ type: 'text' as const, text: `${header}${renderSyncReport(plan, 'text')}` }] };
      } catch (error) {
        return { isError: true as const, content: [{ type: 'text' as const, text: `Não consegui calcular a sincronização: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    },
  );
}
