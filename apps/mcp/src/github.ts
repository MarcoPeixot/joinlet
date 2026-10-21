import { publish, prStatus } from '@strukt/git';
import type { CommandRunner } from '@strukt/git';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpWorkspace } from './workspace';

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] });
const fail = (message: string) => ({ isError: true as const, content: [{ type: 'text' as const, text: message }] });

/** GitHub tools: publish (branch + commit + PR) and a read-only PR status. */
export function registerGithub(server: McpServer, ws: McpWorkspace, runner: CommandRunner): void {
  server.registerTool(
    'publish',
    {
      title: 'Publicar mudanças (GitHub)',
      description:
        'Publica as mudanças de .arch/ como uma branch + commit + PR no GitHub (usa o gh autenticado). O corpo do PR leva o diff semântico da arquitetura. Nada fora de .arch/ é tocado e nunca há force push.',
      inputSchema: {
        title: z.string().min(1).max(200).describe('Título do PR e do commit.'),
        body: z.string().max(20_000).optional().describe('Descrição em Markdown para o corpo do PR.'),
        branch: z.string().max(120).optional().describe('Nome da branch (padrão: strukt/<título>-<data>).'),
        base: z.string().max(120).optional().describe('Branch base (padrão: a branch padrão do repositório).'),
        draft: z.boolean().optional().describe('Abrir o PR como rascunho.'),
      },
    },
    async ({ title, body, branch, base, draft }) => {
      const result = await publish({ runner, cwd: ws.root, title, body, branch, base, draft });
      if (!result.ok) return fail(result.error);
      ws.notify?.({ event: 'pr', title, url: result.url, branch: result.branch });
      return ok(`PR aberto: ${result.url}\nBranch: ${result.branch}`);
    },
  );

  server.registerTool(
    'pr_status',
    {
      title: 'Status do PR',
      description: 'Estado do PR desta branch (ou do PR indicado): review, merge e checks.',
      inputSchema: { pr: z.string().optional().describe('Número ou URL do PR (padrão: o PR da branch atual).') },
    },
    async ({ pr }) => {
      const result = await prStatus(runner, ws.root, pr);
      if (!result.ok) return fail(result.error);
      return ok(result.text);
    },
  );
}
