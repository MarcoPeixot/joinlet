import { expect, it } from 'vitest';
import { extractRepositoryFacts, RepositoryEngine } from './engine';
import { createMemoryAdapter } from '../storage';
import { modulePositions } from './layout';
import { repositoryPresentation, repositoryReadme } from './presentation';
import { DEFAULT_REPOSITORY_CONFIG } from './contracts';
import { printDiagramJson } from '@strukt/json';
import { newWorkspace, workspaceFiles } from '../workspace';
import { applyOps, emptyModel } from '@strukt/core';

function monorepo(){
 const files=new Map<string,string>([['package.json','{"name":"monorepo","workspaces":["apps/*","packages/*"]}'],['apps/web/README.md','# Extension\n\nAn extension only.\n'],['README.md','# Whole project\n\n![Badge](badge.svg)\n\nThe whole project.\n\nProject context.\n']]);
 for(const path of ['apps/web','apps/api','apps/worker','packages/domain','packages/storage','packages/protocol','packages/layout','packages/workspace']){
   const name=path.split('/')[1]!;files.set(path+'/package.json',JSON.stringify({name:'@example/'+name}));
   files.set(path+'/src/index.ts',(name==='web'?Array.from({length:30},(_,i)=>`import library${i} from "library-${i}";`).join('\n'):'import {shared} from "@example/workspace";')+'\nexport const shared=true;\n');
 }
 files.set('apps/web/src/app.test.ts','import {test} from "vitest";\nimport {special} from "test-only-library";\n');
 files.set('apps/api/src/native.ts','import {file} from "bun";\nimport {Database} from "bun:sqlite";\n');
 return files;
}
function reader(files:Map<string,string>){return {list:async()=>[...files].map(([path,text])=>({path,revision:text,bytes:text.length})),read:async(path:string)=>files.get(path)??null,revision:async()=>JSON.stringify([...files])};}

it('defaults to grouped modules for a large graph and keeps library detail in the generated document',async()=>{
 const files=monorepo(),adapter=createMemoryAdapter(),engine=new RepositoryEngine(reader(files),adapter);
 const first=await engine.run({name:'Monorepo',locale:'pt-BR'}),model=first.data.diagrams.repository!.model;
 expect(model.order.filter(id=>model.elements[id]!.kind==='node')).toHaveLength(8);
 expect(model.order.filter(id=>model.elements[id]!.kind==='group')).toHaveLength(2);
 expect(Object.values(model.elements).map(e=>e.label)).not.toContain('library-0');
 expect(model.edges.every(e=>e.from!==e.to&&!e.label)).toBe(true);
 const document=first.files['docs/repository-architecture.md']!;
 expect(document).toContain('Fonte: `README.md`');expect(document).toContain('The whole project.');expect(document).not.toContain('An extension only.');
 expect(document).toContain('## Dependências por módulo');expect(document).toContain('library-29');expect(document).not.toContain('test-only-library');expect(document).not.toContain('bun:sqlite');
 const positions=modulePositions(model),boxes=Object.values(positions);
 expect(Math.max(...boxes.map(b=>b.x+b.w!))).toBeLessThan(1500);expect(Math.max(...boxes.map(b=>b.y+b.h!))).toBeLessThan(800);
 for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++) {const a=boxes[i]!,b=boxes[j]!;expect(a.x+a.w!<=b.x||b.x+b.w!<=a.x||a.y+a.h!<=b.y||b.y+b.h!<=a.y).toBe(true);}
 expect((await engine.run()).changed).toEqual([]);
});

it('restores per-view positions and preserves human labels, notes and independently authored diagrams',async()=>{
 const made=applyOps(emptyModel(),[{op:'add_node',id:'Manual'}]);if(!made.ok)throw Error(made.error.message);
 const authored=newWorkspace('Monorepo',{title:'Authored',snapshot:{model:made.model,layout:{nodes:{Manual:{x:55,y:66}},edges:{}}}});
 const files=monorepo(),adapter=createMemoryAdapter(workspaceFiles(authored)),engine=new RepositoryEngine(reader(files),adapter);
 const original=await adapter.read('diagrams/authored.strukt.json');
 await adapter.write('repository.json',JSON.stringify({...DEFAULT_REPOSITORY_CONFIG,view:'dependencies'}));
 const detailed=await engine.run(),snapshot=detailed.data.diagrams.repository!;
 const web=Object.values(snapshot.model.elements).find(e=>e.label==='@example/web')!.id;
 const library=Object.values(snapshot.model.elements).find(e=>e.label==='library-0')!.id;
 const positions=JSON.parse(detailed.files['diagrams/repository.layout.json']!);positions.nodes[web].x=9000;positions.nodes[library].y=7000;
 await adapter.write('diagrams/repository.layout.json',JSON.stringify(positions));
 const model=JSON.parse(detailed.files['diagrams/repository.strukt.json']!);model.nodes.find((n:{id:string})=>n.id===web).label='Storefront';model.nodes.find((n:{id:string})=>n.id===web).description='Human note';
 await adapter.write('diagrams/repository.strukt.json',JSON.stringify(model));
 await adapter.write('repository.json',JSON.stringify({...DEFAULT_REPOSITORY_CONFIG,view:'modules'}));
 const compact=await engine.run();expect(compact.data.diagrams.repository!.model.elements[web]).toMatchObject({label:'Storefront',description:'Human note'});
 expect(compact.data.diagrams.repository!.layout.nodes[web]!.x).toBe(9000);expect(compact.status.pending.join(' ')).toContain('Existing positions preserved');
 await adapter.write('repository.json',JSON.stringify({...DEFAULT_REPOSITORY_CONFIG,view:'dependencies'}));
 const restored=await engine.run();expect(restored.data.diagrams.repository!.layout.nodes[web]!.x).toBe(9000);expect(restored.data.diagrams.repository!.layout.nodes[library]!.y).toBe(7000);
 expect(await adapter.read('diagrams/authored.strukt.json')).toBe(original);expect(restored.data.diagrams.authored!.layout.nodes.Manual).toEqual({x:55,y:66});
});

it('upgrades an untouched generated dependency layout and remains incremental after a small edit',async()=>{
 const files=monorepo(),adapter=createMemoryAdapter(workspaceFiles(newWorkspace('Monorepo'))),engine=new RepositoryEngine(reader(files),adapter);
 await adapter.write('repository.json',JSON.stringify({...DEFAULT_REPOSITORY_CONFIG,view:'dependencies'}));
 await engine.run();await adapter.write('repository.json',JSON.stringify({...DEFAULT_REPOSITORY_CONFIG,view:'auto'}));
 const compact=await engine.run();expect(compact.status.pending.join(' ')).not.toContain('Existing positions');
 expect(Math.max(...Object.values(compact.data.diagrams.repository!.layout.nodes).map(b=>b.x+b.w!))).toBeLessThan(1500);
 const before=printDiagramJson(compact.data.diagrams.repository!.model);
 files.set('apps/web/src/app.test.ts','import {unrelated} from "another-test-library";\n');
 const changed=await engine.run();expect(changed.status.metrics.reads).toBe(1);expect(printDiagramJson(changed.data.diagrams.repository!.model)).toBe(before);expect(changed.changed).not.toContain('diagrams/repository.strukt.json');
});

it('keeps a fully detailed opt-in view and excludes development-only edges and runtime builtins',()=>{
 const facts=extractRepositoryFacts(monorepo());expect(facts.some(f=>f.label==='vitest'||f.label==='test-only-library'||f.label==='bun:sqlite'||f.label==='monorepo')).toBe(false);
 const view=repositoryPresentation(facts,{...DEFAULT_REPOSITORY_CONFIG,view:'dependencies'},new Map(facts.map(f=>[f.id,f.label])));
 expect(view.model.order).toHaveLength(38);expect(view.mode).toBe('dependencies');expect(Object.values(view.model.elements).find(e=>e.label==='library-0')!.icon).toBe('plug');
});

it('uses the shallowest README deterministically when there is no root README',()=>{
 const files=new Map([['apps/extension/README.md','# Extension\n\nNested.'],['docs/README.md','# Docs\n\nDocumentation.']]);
 expect(repositoryReadme(files).readme?.[0]).toBe('docs/README.md');
});

it('checks organization and source drift without making AI requests or writing files',async()=>{
 const files=monorepo(),adapter=createMemoryAdapter();let calls=0;
 const result=await new RepositoryEngine(reader(files),adapter,{analyze:async()=>{calls++;throw Error('A diagnostic must not invoke the provider.');}}).run({check:true});
 expect(calls).toBe(0);expect(await adapter.list()).toEqual([]);expect(result.status.pending.join(' ')).toContain('Code analysis is pending');
});

it('does not repeat a failed provider request across every source batch',async()=>{
 const files=monorepo();for(let i=0;i<12;i++)files.set(`apps/web/src/extra-${i}.ts`,'export const data='+JSON.stringify('x'.repeat(15000))+';');
 let calls=0;const result=await new RepositoryEngine(reader(files),createMemoryAdapter(),{analyze:async()=>{calls++;throw Error('Provider unavailable.');}}).run();
 expect(calls).toBe(1);expect(result.status.metrics.aiCalls).toBe(1);expect(result.status.pending.join(' ')).toContain('AI analysis is paused');expect(result.files['diagrams/repository.strukt.json']).toBeTruthy();
});
