import {expect,it} from 'vitest';
import {RepositoryEngine} from '@strukt/workspace/repository';
import {createMemoryAdapter} from '@strukt/workspace';
import {applyRepositoryProposal} from './repositoryReview';

async function fixture(){
 let revision='one';const files=new Map([['apps/api/main.ts','export const api=true;'],['apps/billing/main.ts','export const payments=true;']]);
 const reader={list:async()=>[...files].map(([path])=>({path,revision})),read:async(path:string)=>files.get(path)??null,revision:async()=>revision};
 const adapter=createMemoryAdapter();
 const result=await new RepositoryEngine(reader,adapter,{analyze:async input=>({facts:input.facts.filter(f=>f.path==='apps/api').map(f=>({...f,label:'Payments',refs:[{path:'apps/billing/main.ts',line:1,contains:'payments'}]})),proposals:[]})}).run();
 return {adapter,reader,files,proposal:result.status.proposals[0]!,revision:(next:string)=>{revision=next;}};
}
it('applies an explicitly reviewed proposal with its current source revision and evidence',async()=>{
 const f=await fixture();expect(await applyRepositoryProposal(f.adapter,f.reader,f.proposal)).toContain('diagrams/repository.strukt.json');
 expect(await f.adapter.read('diagrams/repository.strukt.json')).toContain('Payments');
 await expect(applyRepositoryProposal(f.adapter,f.reader,f.proposal)).rejects.toThrow('already resolved');
});
it('refuses edited evidence, stale revisions and proposals replaced during review',async()=>{
 const f=await fixture();f.files.set('apps/billing/main.ts','export const other=true;');
 await expect(applyRepositoryProposal(f.adapter,f.reader,f.proposal)).rejects.toThrow('evidence changed');
 f.files.set('apps/billing/main.ts','export const payments=true;');f.revision('two');
 await expect(applyRepositoryProposal(f.adapter,f.reader,f.proposal)).rejects.toThrow('revision changed');
 f.revision('one');const state=JSON.parse((await f.adapter.read('repository-state.json'))!);state.proposals[0].summary='Replacement';await f.adapter.write('repository-state.json',JSON.stringify(state));
 await expect(applyRepositoryProposal(f.adapter,f.reader,f.proposal)).rejects.toThrow('Proposal changed');
});
it('detects a source revision change during evidence validation without writing',async()=>{
 const f=await fixture(),read=f.reader.read;f.reader.read=async path=>{const text=await read(path);f.revision('two');return text;};
 const before=await f.adapter.read('diagrams/repository.strukt.json');
 await expect(applyRepositoryProposal(f.adapter,f.reader,f.proposal)).rejects.toThrow('revision changed');expect(await f.adapter.read('diagrams/repository.strukt.json')).toBe(before);
});
