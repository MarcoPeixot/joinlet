import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { printDiagramJson } from '@strukt/json';
import { planSync } from '@strukt/workspace/sync';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupDirs, connectClient, diagramJson, isErrorOf, manifestOf, tempDir, textOf, writeArch } from './testing';
import { openMcpWorkspace } from './workspace';
import type { McpWorkspace } from './workspace';

afterEach(cleanupDirs);

const SOURCES = JSON.stringify({ version: 1, sources: [{ id: 'infra', kind: 'terraform', include: ['infra/*.tf'], diagram: 'a', mode: 'merge' }] });

async function open(arch: Record<string, string> = {}): Promise<{ ws: McpWorkspace; root: string }> {
  const root = await tempDir();
  await writeArch(root, { 'strukt.json': manifestOf('Loja', [{ slug: 'a', title: 'A' }]), 'diagrams/a.strukt.json': diagramJson(), ...arch });
  await mkdir(join(root, 'infra'), { recursive: true });
  await writeFile(join(root, 'infra', 'main.tf'), 'resource "aws_instance" "web" {\n  subnet_id = aws_subnet.a.id\n}\nresource "aws_subnet" "a" {\n}\n');
  const ws = await openMcpWorkspace(root);
  if ('error' in ws) throw new Error(ws.error);
  return { ws, root };
}

describe('get_sync_status', () => {
  it('reports hosted source inspection as unavailable instead of claiming synchronized code', async () => {
    const { ws } = await open(); ws.root = 'https://github.com/org/repo';
    const { client, close } = await connectClient(ws);
    for (const name of ['get_sync_status', 'get_implementation_plan']) {
      const result = await client.callTool({ name, arguments: {} });
      expect(isErrorOf(result)).toBe(true);
      expect(textOf(result)).toContain('local checkout');
    }
    await close();
  });

  it('is listed as a read-only tool', async () => {
    const { ws } = await open();
    const { client, close } = await connectClient(ws);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('get_sync_status');
    await close();
  });

  it('says nothing is configured', async () => {
    const { ws } = await open();
    const { client, close } = await connectClient(ws);
    const result = await client.callTool({ name: 'get_sync_status', arguments: {} });
    expect(isErrorOf(result)).toBe(false);
    expect(textOf(result)).toContain('Nenhuma fonte configurada');
    await close();
  });

  it('reports what a sync would add and writes nothing', async () => {
    const { ws, root } = await open({ 'sources.json': SOURCES });
    const { client, close } = await connectClient(ws);
    const text = textOf(await client.callTool({ name: 'get_sync_status', arguments: {} }));
    expect(text).toContain('ESTADO: DESATUALIZADO');
    expect(text).toContain('+ aws_instance.web');
    expect(text).toContain('infra: terraform → a (merge), 1 arquivo');
    const again = await openMcpWorkspace(root);
    if ('error' in again) throw new Error(again.error);
    expect(again.data.diagrams.a!.model.order).toEqual([]);
    await expect(readFile(join(root, '.arch', 'sync.json'), 'utf8')).rejects.toThrow();
    await close();
  });

  it('reports "em dia" once the diagrams were synced, and sees later edits of the sources', async () => {
    const { ws, root } = await open({ 'sources.json': SOURCES });
    // What `joinlet sync` leaves on disk (the CLI also lays the nodes out; the status does not depend on positions).
    const plan = await planSync({ root: ws.root, adapter: ws.adapter, data: ws.data });
    await writeFile(join(root, '.arch', 'diagrams', 'a.strukt.json'), printDiagramJson(plan.diagrams[0]!.model));
    await writeFile(join(root, '.arch', 'sync.json'), plan.state.text);
    const { client, close } = await connectClient(ws);
    expect(textOf(await client.callTool({ name: 'get_sync_status', arguments: {} }))).toContain('ESTADO: EM DIA');
    await writeFile(join(root, 'infra', 'db.tf'), 'resource "aws_db_instance" "main" {\n}\n');
    const stale = textOf(await client.callTool({ name: 'get_sync_status', arguments: {} }));
    expect(stale).toContain('ESTADO: DESATUALIZADO');
    expect(stale).toContain('+ aws_db_instance.main');
    await close();
  });

  it('reports problems of an invalid sources file as errors in the text', async () => {
    const { ws } = await open({ 'sources.json': '{"version":1,"sources":[{"id":"x"}]}' });
    const { client, close } = await connectClient(ws);
    const text = textOf(await client.callTool({ name: 'get_sync_status', arguments: {} }));
    expect(text).toContain('ESTADO: COM ERROS');
    expect(text).toContain('sources[0]');
    await close();
  });
});
