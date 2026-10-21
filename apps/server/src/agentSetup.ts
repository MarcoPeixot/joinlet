import { withKnowledgeHarness } from '@strukt/workspace';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

export const agentUrl = (id: string) => `http://127.0.0.1:8787/mcp/${id}`;
const agentBlock = '\n## Joinlet\n\nA arquitetura deste projeto fica em `.arch/`. Antes de alterar a arquitetura, consulte as ferramentas MCP `get_architecture` e `list_diagrams` do Joinlet. Use `create_diagram` ou `apply_ops` para diagramas e `write_doc` para documentos. Mantenha diagramas e documentos atualizados junto das mudanças no código.\n';

async function read(path: string): Promise<string | null> {
  try { return await readFile(path, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Adds only Joinlet-owned entries; existing user configuration is preserved. */
export async function setupAgents(root: string): Promise<{ changed: string[]; conflicts: string[]; id: string }> {
  const changed: string[] = [];
  const conflicts: string[] = [];
  const identity = join(root, '.arch', 'agent.json');
  const previous = await read(identity);
  let id: string;
  if (previous) {
    const parsed = JSON.parse(previous) as { id?: unknown };
    if (typeof parsed.id !== 'string' || !/^[0-9a-f-]{36}$/.test(parsed.id)) throw new Error('Identidade MCP inválida em .arch/agent.json.');
    id = parsed.id;
  } else {
    id = randomUUID();
    await writeFile(identity, `${JSON.stringify({ id }, null, 2)}\n`);
    changed.push('.arch/agent.json');
  }
  const url = agentUrl(id);
  const jsonConfigs = [
    ['.mcp.json', 'mcpServers', { type: 'http', url }],
    ['.cursor/mcp.json', 'mcpServers', { url }],
    ['.vscode/mcp.json', 'servers', { type: 'http', url }],
  ] as const;
  const codexBlock = `\n[mcp_servers.strukt]\nurl = "${url}"\n`;
  for (const [name, key, entry] of jsonConfigs) {
    const path = join(root, name);
    const original = await read(path);
    let config: Record<string, unknown>;
    try {
      config = original ? JSON.parse(original) as Record<string, unknown> : {};
      if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error('invalid');
    } catch { conflicts.push(name); continue; }
    const servers = config[key];
    if (servers !== undefined && (!servers || Array.isArray(servers) || typeof servers !== 'object')) { conflicts.push(name); continue; }
    const values = (servers ?? {}) as Record<string, unknown>;
    if (values.strukt !== undefined && JSON.stringify(values.strukt) !== JSON.stringify(entry)) { conflicts.push(name); continue; }
    if (values.strukt !== undefined) continue;
    config[key] = { ...values, strukt: entry };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
    changed.push(name);
  }

  const codex = '.codex/config.toml';
  const codexPath = join(root, codex);
  const currentCodex = await read(codexPath);
  if (/^\s*\[mcp_servers\.strukt\]/m.test(currentCodex ?? '')) {
    if (!currentCodex?.includes(url)) conflicts.push(codex);
  } else {
    await mkdir(dirname(codexPath), { recursive: true });
    await writeFile(codexPath, `${currentCodex?.trimEnd() ?? ''}${codexBlock}`);
    changed.push(codex);
  }

  const agents = 'AGENTS.md';
  const agentPath = join(root, agents);
  const currentAgents = await read(agentPath);
  const baseAgents = /^## (?:Joinlet|Strukt)\s*$/m.test(currentAgents ?? '') ? currentAgents! : `${currentAgents?.trimEnd() ?? '# Instruções para agentes'}${agentBlock}`;
  const nextAgents = withKnowledgeHarness(baseAgents);
  if (nextAgents !== currentAgents) {
    await writeFile(agentPath, nextAgents);
    changed.push(agents);
  }
  return { changed, conflicts, id };
}
