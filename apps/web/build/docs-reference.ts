/** Refresh public reference snapshots from the local source, without modifying the workspace. */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { printDiagramJsonSchema } from '@strukt/json';
import { openMcpWorkspace } from '../../mcp/src/workspace';
import { connectClient } from '../../mcp/src/testing';

const root=fileURLToPath(new URL('../../..',import.meta.url));
const workspace=await openMcpWorkspace(root);
if('error' in workspace) throw new Error(workspace.error);
const connection=await connectClient(workspace);
try {
  const { tools }=await connection.client.listTools();
  await writeFile(new URL('../docs/mcp-tools.json',import.meta.url),JSON.stringify({product:'Joinlet',source:'apps/mcp/src/tools.ts',tools},null,2)+'\n');
  await writeFile(new URL('../docs/diagram.schema.json',import.meta.url),printDiagramJsonSchema());
  console.log(`Refreshed ${tools.length} MCP schemas and the diagram schema.`);
} finally { await connection.close(); }
