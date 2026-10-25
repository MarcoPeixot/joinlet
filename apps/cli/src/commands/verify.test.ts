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

it('keeps repository diagnostics consistent across CLI checks and both MCP views without provider calls',async()=>{
 const {RepositoryEngine}=await import('@strukt/workspace/repository');
 const {DEFAULT_REPOSITORY_CONFIG}=await import('@strukt/workspace/repository-contracts');
 const {createFsAdapter}=await import('@strukt/workspace/fs');
 const {localReader}=await import('@strukt/workspace/repository-reader');
 for(const ai of [false,true]){
  const root=await tempDir();await mkdir(join(root,'.arch'));await mkdir(join(root,'src'));
  await writeFile(join(root,'package.json'),'{"name":"diagnostic-fixture"}');await writeFile(join(root,'src/main.ts'),'export const api=true;\n');
  const adapter=createFsAdapter(join(root,'.arch')),reader=await localReader(root);
  await new RepositoryEngine(reader,adapter,{identity:'completed-provider',analyze:async()=>({facts:[],proposals:[]})}).run();
  await adapter.write('repository.json',JSON.stringify({...DEFAULT_REPOSITORY_CONFIG,ai}));
  await new RepositoryEngine(reader,adapter,{identity:'completed-provider',analyze:async()=>({facts:[],proposals:[]})}).run();
  const ws=await openMcpWorkspace(root);if('error'in ws)throw Error(ws.error);
  const connection=await connectClient(ws);
  try{
   for(const analyzer of [undefined,{identity:'different-provider',analyze:async()=>{throw Error('Diagnostic invoked provider');}}]){
    ws.repositoryAnalyzer=analyzer;
    const baseline=await adapter.read('repository-state.json');
    const sync=fakeIo(),verify=fakeIo();
    expect(await runSync(argsOf('sync','--dir',root,'--check','--json'),sync)).toBe(0);
    expect(await runVerify(argsOf('verify','--dir',root,'--strict','--json'),verify)).toBe(0);
    const cli=JSON.parse(sync.outText),strict=JSON.parse(verify.outText).repository;
    for(const name of ['get_sync_status','get_implementation_plan']){
     const result=await connection.client.callTool({name,arguments:{}});expect(result.isError).not.toBe(true);
     const report=JSON.parse(textOf(result));expect(report.changed).toEqual(cli.changed);expect(report.status.pending).toEqual(cli.pending);expect(report.status.metrics.aiCalls).toBe(0);
    }
    expect(strict.changed).toEqual(cli.changed);expect(await adapter.read('repository-state.json')).toBe(baseline);
   }
   await writeFile(join(root,'src/main.ts'),'import redis from "redis";\nexport const api=redis;\n');
   const sync=fakeIo(),verify=fakeIo();expect(await runSync(argsOf('sync','--dir',root,'--check','--json'),sync)).toBe(1);expect(await runVerify(argsOf('verify','--dir',root,'--strict','--json'),verify)).toBe(1);
   const cli=JSON.parse(sync.outText);expect(JSON.parse(verify.outText).repository.changed).toEqual(cli.changed);
   for(const name of ['get_sync_status','get_implementation_plan']){const report=JSON.parse(textOf(await connection.client.callTool({name,arguments:{}})));expect(report.changed).toEqual(cli.changed);expect(report.status.pending).toEqual(cli.pending);}
  }finally{await connection.close();}
 }
},20_000);
