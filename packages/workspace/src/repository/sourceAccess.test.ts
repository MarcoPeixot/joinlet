import {expect,it} from 'vitest';
import {listRepositoryFiles,readRepositorySource,repositorySourceContext,scopedRepositoryReader} from './sourceAccess';
import {canDeepenRepository} from './guidance';
import type {RepositoryStatus} from './contracts';

function fixture(){const files=new Map([['src/index.ts','one\ntwo\nthree'],['README.md','# Product'],['docs/guide.md','# Guide'],['.env','SECRET=value'],['AGENTS.md','Instructions'],['node_modules/private/index.ts','private'],['.arch/docs/private.md','derived']]);let revision='sha';const reads:string[]=[];return {files,reads,setRevision:(value:string)=>{revision=value;},reader:{list:async()=>[...files].map(([path,text])=>({path,revision:text,bytes:text.length})),read:async(path:string)=>{reads.push(path);return files.get(path)??null;},revision:async()=>revision}};}
it('pages only authorized source paths and refuses traversal or private files',async()=>{
 const {reader,reads}=fixture(),first=await listRepositoryFiles(reader,{limit:2});expect(first.total).toBe(3);expect(first.nextOffset).toBe(2);expect((await listRepositoryFiles(reader,{offset:2,limit:2})).files).toHaveLength(1);
 for(const path of ['../outside.ts','.env','.arch/docs/private.md','node_modules/private/index.ts'])await expect(readRepositorySource(reader,path)).rejects.toThrow();
 await expect(listRepositoryFiles(reader,{prefix:'../'})).rejects.toThrow();expect(reads).toEqual([]);
});
it('respects shared include/exclude rules for both automatic context and explicit source pages',async()=>{
 const {reader,reads}=fixture(),scoped=scopedRepositoryReader(reader,{include:['src/**','docs/**'],exclude:['docs/**']});
 expect((await listRepositoryFiles(scoped)).files.map(f=>f.path)).toEqual(['src/index.ts']);
 expect((await repositorySourceContext(scoped)).files.map(f=>f.path)).toEqual(['src/index.ts']);
 await expect(readRepositorySource(scoped,'docs/guide.md')).rejects.toThrow('excluded');expect(reads).not.toContain('docs/guide.md');
 const other=scopedRepositoryReader(reader,{include:['**/*'],exclude:[]});expect(await scoped.revision()).toBe(await other.revision());expect((await repositorySourceContext(scoped)).policy).not.toBe((await repositorySourceContext(other)).policy);
});
it('returns numbered source pages at the requested revision and rejects changed revisions',async()=>{
 const {reader,setRevision}=fixture();expect(await readRepositorySource(reader,'src/index.ts',2,1,'sha')).toMatchObject({start:2,lines:['two'],nextLine:3,revision:'sha'});
 setRevision('new');await expect(readRepositorySource(reader,'src/index.ts',1,100,'sha')).rejects.toThrow('revision changed');
});
it('bounds source reads and reports omitted files rather than presenting a sample as complete',async()=>{
 const {reader,files,reads}=fixture();for(let i=0;i<300;i++)files.set(`src/feature-${i}.ts`,'export const data='+JSON.stringify('x'.repeat(3000)));
 const context=await repositorySourceContext(reader);expect(reads.length).toBeLessThanOrEqual(80);expect(context.complete).toBe(false);expect(context.omitted).toBe(context.total-context.files.length);expect(JSON.stringify(context).length).toBeLessThan(120000);expect(context.files.some(f=>f.path==='README.md')).toBe(true);expect(context.files.some(f=>f.path==='.env')).toBe(false);
});
it('rejects source snapshots changed during a read and oversized single-line pages',async()=>{
 const {reader,setRevision,files}=fixture();const read=reader.read;reader.read=async path=>{const value=await read(path);setRevision('changed');return value;};await expect(repositorySourceContext(reader)).rejects.toThrow('changed during');
 files.set('src/index.ts','x'.repeat(50000));await expect(readRepositorySource(reader,'src/index.ts')).rejects.toThrow('line exceeds');
});
it('only offers deepening after the analyzed revision is persisted and writes are settled',()=>{
 const status={persistedRevision:'sha',analyzedRevision:'sha',phase:'paused'} as RepositoryStatus;
 expect(canDeepenRepository(status)).toBe(true);expect(canDeepenRepository({...status,phase:'files'})).toBe(false);expect(canDeepenRepository({...status,phase:'conflict'})).toBe(false);expect(canDeepenRepository({...status,analyzedRevision:'other'})).toBe(false);expect(canDeepenRepository({...status,pendingWrites:1})).toBe(false);
});
