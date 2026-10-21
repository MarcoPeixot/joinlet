import { own } from '@strukt/core';
import { printDiagramJson } from '@strukt/json';
import { architectureMarkdown, llmsTxt } from '@strukt/workspace';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { diagramSummary, refresh } from './workspace';
import type { McpWorkspace } from './workspace';
import { DIAGRAM_UI_MIME, DIAGRAM_UI_URI, diagramUiHtml } from './view';

const json = (uri: URL, text: string) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text }] });
const markdown = (uri: URL, text: string) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] });

export function registerResources(server: McpServer, ws: McpWorkspace): void {
  server.registerResource('diagram-ui', DIAGRAM_UI_URI, { title: 'Visualização interativa do diagrama', mimeType: DIAGRAM_UI_MIME }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: DIAGRAM_UI_MIME, text: diagramUiHtml }] }));
  server.registerResource(
    'manifest',
    'strukt://manifest',
    { title: 'Manifesto do workspace', description: 'Nome, diagramas, documentos e sketches do .arch/.', mimeType: 'application/json' },
    async (uri) => { await refresh(ws); return json(uri, `${JSON.stringify(ws.data.manifest, null, 2)}\n`); },
  );

  server.registerResource(
    'architecture',
    'strukt://architecture',
    { title: 'ARCHITECTURE.md', description: 'A arquitetura inteira gerada a partir do workspace.', mimeType: 'text/markdown' },
    async (uri) => { await refresh(ws); return markdown(uri, architectureMarkdown(ws.data)); },
  );

  server.registerResource(
    'llms',
    'strukt://llms.txt',
    { title: 'llms.txt', description: 'Índice curto da arquitetura (llmstxt.org).', mimeType: 'text/markdown' },
    async (uri) => { await refresh(ws); return markdown(uri, llmsTxt(ws.data)); },
  );

  server.registerResource(
    'diagram',
    new ResourceTemplate('strukt://diagram/{slug}', { list: undefined }),
    { title: 'Diagrama', description: 'O JSON canônico de um diagrama, com um resumo na primeira linha.', mimeType: 'application/json' },
    async (uri, { slug }) => {
      await refresh(ws);
      const snapshot = own(ws.data.diagrams, String(slug));
      if (!snapshot) return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: `Diagrama "${slug}" não existe.` }) }] };
      return json(uri, `${JSON.stringify({ summary: diagramSummary(String(slug), ws.data), diagram: JSON.parse(printDiagramJson(snapshot.model)) }, null, 2)}\n`);
    },
  );

  server.registerResource(
    'doc',
    new ResourceTemplate('strukt://doc/{slug}', { list: undefined }),
    { title: 'Documento', description: 'O Markdown de um documento do workspace.', mimeType: 'text/markdown' },
    async (uri, { slug }) => { await refresh(ws); return markdown(uri, own(ws.data.docs, String(slug)) ?? `Documento "${slug}" não existe.`); },
  );
}
