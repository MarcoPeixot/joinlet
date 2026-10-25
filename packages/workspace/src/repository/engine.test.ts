import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RepositoryEngine } from './engine';
import { localReader, command } from './reader';
import { createFsAdapter } from '../fs';
import { createMemoryAdapter } from '../storage';

async function fixture(run: (root: string, engine: RepositoryEngine) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'joinlet-repository-'));
  try {
    await command('git', ['init','-q'], root);
    await mkdir(join(root,'src','api'), { recursive: true });
    await writeFile(join(root,'package.json'), '{"name":"example"}\n');
    await writeFile(join(root,'README.md'), '# Example\n\nAn API service.\n');
    await writeFile(join(root,'src','api','index.ts'), 'export const api = true;\n');
    await mkdir(join(root,'.arch'));
    await run(root, new RepositoryEngine(await localReader(root), createFsAdapter(join(root,'.arch'))));
  } finally { await rm(root,{recursive:true,force:true}); }
}
describe('repository architecture lifecycle', () => {
  it.each([
    ['pt-BR', 'Visão geral — loja', 'Arquitetura — loja', 'Gerado automaticamente pelo Joinlet', 'Fonte: `README.md`'],
    ['en', 'Overview — loja', 'Architecture — loja', 'Generated automatically by Joinlet', 'Source: `README.md`'],
  ] as const)('names generated architecture and explains document provenance in %s', async (locale, diagramTitle, documentTitle, provenance, source) => fixture(async (_root, engine) => {
    const result = await engine.run({name:'loja',locale});
    expect(result.data.manifest.diagrams.find(d=>d.slug==='repository')?.title).toBe(diagramTitle);
    expect(result.data.manifest.docs.find(d=>d.slug==='repository-architecture')?.title).toBe(documentTitle);
    expect(result.files['docs/repository-architecture.md']).toContain(provenance);
    expect(result.files['docs/repository-architecture.md']).toContain(source);
    expect(result.files['docs/repository-architecture.md']).toContain('An API service.');
    expect(result.status.metrics.aiCalls).toBe(0);
    // The repository's chosen language persists across viewers, CLI runs and connector restarts.
    expect((await engine.run({locale:locale==='en'?'pt-BR':'en'})).changed).toEqual([]);
  }));
  it('migrates only managed generic names and preserves personalized titles and document text', async () => fixture(async (root, engine) => {
    await engine.run({name:'loja'});
    const arch=join(root,'.arch'), manifest=JSON.parse(await readFile(join(arch,'strukt.json'),'utf8'));
    manifest.diagrams.find((d:{slug:string})=>d.slug==='repository').title='Repository';
    manifest.docs.find((d:{slug:string})=>d.slug==='repository-architecture').title='Repository architecture';
    await writeFile(join(arch,'strukt.json'),JSON.stringify(manifest));
    const state=JSON.parse(await readFile(join(arch,'repository-state.json'),'utf8'));delete state.presentation;
    const legacyText='# Repository architecture\n\nLegacy generated document.\n';state.document.text=legacyText;
    await writeFile(join(arch,'repository-state.json'),JSON.stringify(state));await writeFile(join(arch,'docs','repository-architecture.md'),legacyText);
    const config=JSON.parse(await readFile(join(arch,'repository.json'),'utf8'));delete config.locale;await writeFile(join(arch,'repository.json'),JSON.stringify(config));
    const migrated=await engine.run({locale:'pt-BR'});
    expect(migrated.data.manifest.diagrams.find(d=>d.slug==='repository')?.title).toBe('Visão geral — loja');
    expect(migrated.data.manifest.docs.find(d=>d.slug==='repository-architecture')?.title).toBe('Arquitetura — loja');
    expect(migrated.changed).not.toContain('diagrams/repository.strukt.json');
    const customized=JSON.parse(migrated.files['strukt.json']!);
    customized.diagrams.find((d:{slug:string})=>d.slug==='repository').title='Mapa da equipe';
    customized.docs.find((d:{slug:string})=>d.slug==='repository-architecture').title='Decisões da equipe';
    await writeFile(join(arch,'strukt.json'),JSON.stringify(customized));await writeFile(join(arch,'docs','repository-architecture.md'),'# Texto autoral\n');
    await writeFile(join(root,'src','api','index.ts'),'import redis from "redis";\nexport const api=redis;\n');
    const next=await engine.run();
    expect(next.data.manifest.diagrams.find(d=>d.slug==='repository')?.title).toBe('Mapa da equipe');
    expect(next.data.manifest.docs.find(d=>d.slug==='repository-architecture')?.title).toBe('Decisões da equipe');
    expect(next.files['docs/repository-architecture.md']).toBe('# Texto autoral\n');
  }));
  it('initializes from code and README, reuses unchanged reads, then imports a structural edit', async () => fixture(async (root, engine) => {
    const first = await engine.run();
    expect(first.status.initialized).toBe(true);
    expect(first.data.manifest.diagrams.map(d=>d.slug)).toContain('repository');
    expect(first.files['docs/repository-architecture.md']).toContain('README.md');
    expect(first.status.pending.join(' ')).toContain('AI provider');
    const second = await engine.run();
    expect(second.changed).toEqual([]); expect(second.status.metrics.reads).toBe(0);expect(second.status.metrics.architectureReads).toBe(0);
    await writeFile(join(root,'src','api','index.ts'), 'import postgres from "postgres";\nexport const api = postgres();\n');
    const third = await engine.run();
    expect(third.status.metrics.reads).toBe(1);
    expect(third.files['diagrams/repository.strukt.json']).toContain('postgres');
    expect(third.data.diagrams.repository!.model.edges).toHaveLength(1);
    expect(await readFile(join(root,'.arch','evidence.json'),'utf8')).toContain('import postgres');
  }));
  it('preserves manual labels, positions and authored explanations on subsequent code analysis', async () => fixture(async (root, engine) => {
    const first = await engine.run();
    const path = join(root,'.arch','diagrams','repository.strukt.json');
    const json = JSON.parse(await readFile(path,'utf8'));
    json.nodes[0].label = 'Human label'; await writeFile(path, JSON.stringify(json));
    const layout = first.files['diagrams/repository.layout.json'];
    await writeFile(join(root,'.arch','docs','repository-architecture.md'),'# Human explanation\n');
    await writeFile(join(root,'src','api','index.ts'), 'import redis from "redis";\nexport const api = true;\n');
    const next = await engine.run();
    expect(next.files['diagrams/repository.strukt.json']).toContain('Human label');
    expect(next.files['docs/repository-architecture.md']).toBe('# Human explanation\n');
    const positions = JSON.parse(layout!).nodes;
    for (const [id,box] of Object.entries(positions)) expect(JSON.parse(next.files['diagrams/repository.layout.json']!).nodes[id]).toEqual(box);
  }));
  it('check is read-only, reports new files and never creates backups on invalid inputs', async () => {
    const adapter=createMemoryAdapter();
    const reader={list:async()=>[{path:'service.ts',revision:'1'}],revision:async()=>'revision',read:async()=>'export const service=true;'};
    const engine=new RepositoryEngine(reader,adapter);
    expect((await engine.run({check:true})).changed.length).toBeGreaterThan(0);
    expect(await adapter.list()).toEqual([]);
    await adapter.write('strukt.json','not json');
    await expect(engine.run()).rejects.toThrow();
    expect(await adapter.list()).toEqual(['strukt.json']);
  });
  it('rejects stale results when source revision changes during AI execution', async () => {
    const adapter=createMemoryAdapter(); let revision='before';
    const reader={list:async()=>[{path:'service.ts',revision:'1'}],revision:async()=>revision,read:async()=>'export const service=true;'};
    const engine=new RepositoryEngine(reader,adapter,{analyze:async()=>{revision='after';return {facts:[],proposals:[]};}});
    await expect(engine.run()).rejects.toThrow('changed during analysis');
    expect(await adapter.list()).toEqual([]);
  });
  it('never auto-applies fabricated AI references', async () => {
    const adapter=createMemoryAdapter();
    const reader={list:async()=>[{path:'service.ts',revision:'1'}],revision:async()=>'r',read:async()=>'export const service=true;'};
    const engine=new RepositoryEngine(reader,adapter,{analyze:async()=>({facts:[{id:'invented',label:'Invented',refs:[{path:'secrets.txt',line:1,contains:'password'}],dependencies:[]}],proposals:[]})});
    const result=await engine.run(); expect(result.files['diagrams/repository.strukt.json']).not.toContain('Invented');
  });
});

it('registers and synchronizes discovered Terraform alongside the repository overview',async()=>fixture(async(root,engine)=>{
  await mkdir(join(root,'infra'));await writeFile(join(root,'infra','main.tf'),'resource "aws_s3_bucket" "assets" {}\n');
  const result=await engine.run();
  expect(JSON.parse(result.files['sources.json']!).sources).toEqual(expect.arrayContaining([expect.objectContaining({kind:'terraform'})]));
  expect(result.files['diagrams/repository-terraform.strukt.json']).toContain('assets');
}));
it('keeps a completed AI analysis stable under read-only verification without another provider call',async()=>{
  const adapter=createMemoryAdapter(),reader={list:async()=>[{path:'service.ts',revision:'1'}],revision:async()=>'r',read:async()=>'export const service=true;'};
  const engine=new RepositoryEngine(reader,adapter,{analyze:async input=>({facts:input.facts.map(f=>({...f,label:'Application service'})),proposals:[]})});
  await engine.run();const verified=await new RepositoryEngine(reader,adapter).run({check:true});
  expect(verified.changed).toEqual([]);expect(verified.status.pending).toEqual([]);
});
it('completes deterministic initialization when the AI provider is unavailable',async()=>{
  const adapter=createMemoryAdapter(),reader={list:async()=>[{path:'service.ts',revision:'1'}],revision:async()=>'r',read:async()=>'export const service=true;'};
  const result=await new RepositoryEngine(reader,adapter,{analyze:async()=>{throw Error('Insufficient credits.');}}).run();
  expect(await adapter.read('strukt.json')).not.toBeNull();expect(result.status.pending.join(' ')).toContain('AI analysis is paused');
});
it('incrementally reconciles a changed file without invalidating unrelated cached source reads',async()=>fixture(async(root)=>{
  await writeFile(join(root,'src','api','second.ts'),'export const second=true;\n');
  const reader=await localReader(root,{incremental:true}),engine=new RepositoryEngine(reader,createFsAdapter(join(root,'.arch')));
  await engine.run();expect((await engine.run()).status.metrics.reads).toBe(0);
  await writeFile(join(root,'src','api','second.ts'),'import redis from "redis";\nexport const second=redis;\n');reader.invalidate('src/api/second.ts');
  const changed=await engine.run();expect(changed.status.metrics.reads).toBe(1);expect(changed.files['diagrams/repository.strukt.json']).toContain('redis');
}));
it('refuses a batch if an architecture file changes while analysis is in flight',async()=>{
  const adapter=createMemoryAdapter(),reader={list:async()=>[{path:'service.ts',revision:'1'}],revision:async()=>'r',read:async()=>'export const service=true;'};
  const engine=new RepositoryEngine(reader,adapter,{analyze:async()=>{await adapter.write('strukt.json','human edit');return {facts:[],proposals:[]};}});
  await expect(engine.run()).rejects.toThrow('changed');expect(await adapter.read('strukt.json')).toBe('human edit');
  expect(await adapter.read('repository.json')).toBeNull();
});
it('analyzes only changed content after initializing a large source inventory',async()=>{
 const source=new Map(Array.from({length:1200},(_,i)=>[`src/api/file-${i}.ts`,`export const value${i}=true;\n`]));
 let revision='initial';const batches:string[][]=[];
 const reader={list:async()=>[...source].map(([path,text])=>({path,revision:text,bytes:text.length})),revision:async()=>revision,read:async(path:string)=>source.get(path)??null};
 const engine=new RepositoryEngine(reader,createMemoryAdapter(),{identity:'controlled-provider',analyze:async input=>{batches.push(input.files.map(f=>f.path));return {facts:[],proposals:[]};}});
 await engine.run();batches.length=0;
 source.set('src/api/file-5.ts','import redis from "redis";\nexport const value5=redis;\n');revision='changed';
 const changed=await engine.run();
 expect(changed.status.metrics.reads).toBe(1);expect(changed.status.metrics.aiCalls).toBe(1);expect(batches).toEqual([['src/api/file-5.ts']]);
 expect((await engine.run()).status.metrics.aiCalls).toBe(0);
},20000);
it('retains unreviewed proposals while reusing a completed analysis',async()=>{
 const reader={list:async()=>[{path:'service.ts',revision:'1'}],revision:async()=>'r',read:async()=>'export const service=true;'};
 const adapter=createMemoryAdapter(),engine=new RepositoryEngine(reader,adapter,{analyze:async()=>({facts:[],proposals:[{id:'review',summary:'Review service boundary',reason:'Needs review',refs:[{path:'service.ts',line:1,contains:'export const service=true;'}],ops:[]}]})});
 expect((await engine.run()).status.proposals).toHaveLength(1);
 const next=await engine.run();expect(next.status.metrics.aiCalls).toBe(0);expect(next.status.proposals).toHaveLength(1);
});
