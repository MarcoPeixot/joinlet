import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { argsOf, cleanupDirs, diagramJson, fakeIo, manifestOf, tempDir, writeArch } from '../testing';
import { runVerify } from './verify';
import { runContext } from './context';
import { runSync } from './sync';
import { openMcpWorkspace } from '../../../mcp/src/workspace';
import { connectClient, textOf } from '../../../mcp/src/testing';

afterEach(cleanupDirs);
it('round trip: source → diagram/context → team edit → implementation handoff → source → clean verification', async () => {
  const root = await tempDir();
  await writeArch(root, {
    'strukt.json': manifestOf('App', [{ slug: 'infra', title: 'Infrastructure' }]),
    'diagrams/infra.strukt.json': diagramJson(),
    'sources.json': JSON.stringify({ version: 1, sources: [{ id: 'infra', kind: 'terraform', include: ['infra/*.tf'], diagram: 'infra', mode: 'merge' }] }),
  });
  await mkdir(join(root, 'infra'));
  const code = 'resource "aws_instance" "web" {\n}\n';
  await writeFile(join(root, 'infra/main.tf'), code);
  const verify = () => runVerify(argsOf('verify', '--dir', root, '--strict', '--json'), fakeIo());
  expect(await verify()).toBe(1);
  await runSync(argsOf('sync', '--dir', root), fakeIo());
  await runContext(argsOf('context', '--dir', root), fakeIo());
  expect(await verify()).toBe(0);
  const ws = await openMcpWorkspace(root);
  if ('error' in ws) throw Error(ws.error);
  const connection = await connectClient(ws);
  try {
    const edited = await connection.client.callTool({ name: 'apply_ops', arguments: { diagram: 'infra', summary: 'Add durable queue', ops: [{ op: 'add_node', id: 'aws_sqs_queue.jobs' }] } });
    expect(edited.isError).not.toBe(true);
    expect(await readFile(join(root, 'infra/main.tf'), 'utf8')).toBe(code);
    expect(await readFile(join(root, '.arch/context/ARCHITECTURE.md'), 'utf8')).toContain('aws_sqs_queue.jobs');
    expect(await verify()).toBe(1);
    const status = await connection.client.callTool({ name: 'get_sync_status', arguments: {} });
    expect(textOf(status)).toContain('REVISÃO NECESSÁRIA');
    const result = await connection.client.callTool({ name: 'get_implementation_plan', arguments: {} });
    const handoff = JSON.parse(textOf(result));
    expect(handoff.writesCode).toBe(false);
    expect(handoff.diagrams[0].files).toEqual(['infra/main.tf']);
    expect(handoff.diagrams[0].sourceToDesiredArchitecture.elements.added).toContain('aws_sqs_queue.jobs');
    // The coding agent implements the requested IaC change; Joinlet never synthesizes unknown code silently.
    await writeFile(join(root, 'infra/main.tf'), code + 'resource "aws_sqs_queue" "jobs" {\n}\n');
    await runSync(argsOf('sync', '--dir', root), fakeIo());
    expect(await verify()).toBe(0);
    expect(textOf(await connection.client.callTool({ name: 'get_sync_status', arguments: {} }))).toContain('EM DIA');
    expect(await runSync(argsOf('sync', '--dir', root, '--check'), fakeIo())).toBe(0);
  } finally { await connection.close(); }
});

it('does not report unconfigured code coverage as verified in strict mode, and does not write', async () => {
  const root = await tempDir();
  await writeArch(root, { 'strukt.json': manifestOf('App', [] ) });
  await runContext(argsOf('context', '--dir', root), fakeIo());
  const out = fakeIo();
  expect(await runVerify(argsOf('verify', '--dir', root, '--strict', '--json'), out)).toBe(1);
  expect(JSON.parse(out.outText)).toMatchObject({ ok: false, coverage: 'none' });
  expect(await runVerify(argsOf('verify', '--dir', root), fakeIo())).toBe(0);
});
