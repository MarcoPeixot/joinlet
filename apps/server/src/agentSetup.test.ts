import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setupAgents } from './agentSetup';

describe('agent setup', () => {
  it('creates shared configs once, preserving unrelated entries and reporting conflicts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'strukt-setup-'));
    try {
      await mkdir(join(root, '.arch'));
      await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'other' } } }));
      const first = await setupAgents(root);
      expect(first.changed).toContain('AGENTS.md');
      expect(first.conflicts).toEqual([]);
      const config = JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8'));
      expect(config.mcpServers.other).toEqual({ command: 'other' });
      expect(config.mcpServers.strukt.url).toBe(`http://127.0.0.1:8787/mcp/${first.id}`);
      expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toContain('## Joinlet');
      expect(await setupAgents(root)).toEqual({ changed: [], conflicts: [], id: first.id });
      const legacyAgents = '# Instruções para agentes\n## Strukt\n\nInstruções personalizadas.\n';
      await writeFile(join(root, 'AGENTS.md'), legacyAgents);
      expect(await setupAgents(root)).toEqual({ changed: ['AGENTS.md'], conflicts: [], id: first.id });
      expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toContain(legacyAgents.trim());
      expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toContain('joinlet verify --strict');
      expect(await setupAgents(root)).toEqual({ changed: [], conflicts: [], id: first.id });
      config.mcpServers.strukt.url = 'http://example.com/mcp';
      await writeFile(join(root, '.mcp.json'), JSON.stringify(config));
      expect((await setupAgents(root)).conflicts).toEqual(['.mcp.json']);
      expect(JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8')).mcpServers.strukt.url).toBe('http://example.com/mcp');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
