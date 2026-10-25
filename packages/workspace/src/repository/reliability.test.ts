import { expect, it } from 'vitest';
import { RepositoryEngine, inspectRepository } from './engine';
import { createMemoryAdapter } from '../storage';
const files=new Map([['apps/api/main.ts','export const api=true;'],['apps/billing/main.ts','export const stripe=true;']]);
const reader=()=>({list:async()=>[...files].map(([path,text])=>({path,revision:text})),read:async(path:string)=>files.get(path)??null,revision:async()=>JSON.stringify([...files])});
it('routes sibling-module AI evidence to review instead of renaming the API',async()=>{
 const result=await new RepositoryEngine(reader(),createMemoryAdapter(),{analyze:async input=>({facts:input.facts.filter(f=>f.path==='apps/api').map(f=>({...f,label:'Payments processor',refs:[{path:'apps/billing/main.ts',line:1,contains:'stripe'}]})),proposals:[]})}).run();
 expect(result.files['diagrams/repository.strukt.json']).not.toContain('Payments processor');expect(result.status.proposals).toContainEqual(expect.objectContaining({summary:'Payments processor',reason:expect.stringContaining('another module'),ops:expect.any(Array)}));
});
it('disabled AI produces identical diagnostics with any analyzer and never calls it',async()=>{
 const adapter=createMemoryAdapter();await new RepositoryEngine(reader(),adapter).run();const config=JSON.parse((await adapter.read('repository.json'))!);config.ai=false;await adapter.write('repository.json',JSON.stringify(config));await new RepositoryEngine(reader(),adapter).run();
 const analyzer={identity:'different-provider',analyze:async()=>{throw Error('Diagnostics must not call AI');}};
 const plain=await inspectRepository(reader(),adapter),configured=await inspectRepository(reader(),adapter,analyzer);expect(plain.changed).toEqual([]);expect(configured.changed).toEqual([]);expect(configured.status.pending).toEqual(plain.status.pending);expect(configured.status.metrics.aiCalls).toBe(0);
});
it('read-only diagnosis preserves completed identity and agrees regardless of provider availability',async()=>{
 const adapter=createMemoryAdapter();await new RepositoryEngine(reader(),adapter,{identity:'provider-a',analyze:async()=>({facts:[],proposals:[]})}).run();
 const before=await adapter.read('repository-state.json');
 for(const analyzer of [undefined,{identity:'provider-b',analyze:async()=>{throw Error('No AI during diagnostics');}}]){const result=await new RepositoryEngine(reader(),adapter,analyzer).run({check:true});expect(result.changed).toEqual([]);expect(result.status.pending).toEqual([]);}
 expect(await adapter.read('repository-state.json')).toBe(before);
});
it('accepts dependency descriptions only when the reference contains its actual declaration',async()=>{
 const source=new Map([['package.json','{"name":"fixture"}'],['main.ts','import Redis from "redis"; const unrelated="payments";']]);
 const reader={list:async()=>[...source].map(([path,text])=>({path,revision:text})),read:async(path:string)=>source.get(path)??null,revision:async()=>'fixed'};
 for(const contains of ['payments','"redis"','imaginary']){
  const result=await new RepositoryEngine(reader,createMemoryAdapter(),{analyze:async input=>({facts:input.facts.filter(f=>f.kind==='dependency').map(f=>({...f,label:'Payment backend',refs:[{path:'main.ts',line:1,contains}]})),proposals:[]})}).run();
  expect(result.files['diagrams/repository.strukt.json'].includes('Payment backend')).toBe(contains==='"redis"');
  expect(result.status.proposals.length).toBe(contains==='payments'?1:0);
 }
});
it('migrates unproved generated labels into review while preserving human diagram labels',async()=>{
 const adapter=createMemoryAdapter();const first=await new RepositoryEngine(reader(),adapter).run();
 const state=JSON.parse((await adapter.read('repository-state.json'))!),module=Object.keys(state.labels)[0]!;
 state.labels[module].analysis='Legacy generated label';delete state.labels[module].refs;delete state.extractionVersion;await adapter.write('repository-state.json',JSON.stringify(state));
 const model=JSON.parse(first.files['diagrams/repository.strukt.json']!);model.nodes.find((n:{id:string})=>n.id===module).label='Human customization';await adapter.write('diagrams/repository.strukt.json',JSON.stringify(model));
 const migrated=await new RepositoryEngine(reader(),adapter).run();expect(migrated.files['diagrams/repository.strukt.json']).toContain('Human customization');expect(migrated.status.proposals.some(p=>p.reason.includes('no verified module evidence'))).toBe(true);
 expect((await new RepositoryEngine(reader(),adapter).run()).changed).toEqual([]);
});
