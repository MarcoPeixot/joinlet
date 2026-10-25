import {expect,it} from 'vitest';
import {RepositoryEngine} from './engine';
import {createMemoryAdapter} from '../storage';
import {markdownTargets} from './knowledge';

function fixture(){const files=new Map([['package.json','{"name":"generic-project"}'],['src/index.ts','export const app=true;'],['README.md','# Product\n\nRead [the API](docs/api.md).'],['docs/api.md','# API guide\n\nSee [Product](../README.md).'],['docs/deep/notes.mdx','# Notes\n\nText mentioning API without a link.'],['AGENTS.md','Private agent instructions']]);const reader={list:async()=>[...files].map(([path,text])=>({path,revision:text})),read:async(path:string)=>files.get(path)??null,revision:async()=>JSON.stringify([...files])};const adapter=createMemoryAdapter();return {files,adapter,engine:new RepositoryEngine(reader,adapter)};}
it('imports every recognized Markdown with source folders, links module READMEs and adds only grounded Overview connections',async()=>{
 const {engine}=fixture(),result=await engine.run({locale:'pt-BR'}),data=result.data,state=JSON.parse(result.files['repository-state.json']!);
 expect(Object.keys(state.knowledge.documents)).toEqual(['README.md','docs/api.md','docs/deep/notes.mdx']);
 expect(data.manifest.docs).toHaveLength(4);
 const root=state.knowledge.documents['README.md'],api=state.knowledge.documents['docs/api.md'],notes=state.knowledge.documents['docs/deep/notes.mdx'];
 expect(data.manifest.docs.find(d=>d.slug===api.slug)).toMatchObject({title:'API guide',folder:'Repositório/docs'});
 expect(data.docs[root.slug]).toContain('Fonte: `README.md`');expect(data.docs[notes.slug]).toContain('Text mentioning API');
 expect(Object.values(data.diagrams.repository!.model.elements).find(e=>e.label==='generic-project')!.link).toBe('doc:'+root.slug);
 expect(data.board.connections.some(c=>[c.from,c.to].includes('doc:'+api.slug)&&[c.from,c.to].includes('doc:'+root.slug))).toBe(true);
 expect(data.board.connections.some(c=>c.from==='doc:'+notes.slug||c.to==='doc:'+notes.slug)).toBe(false);
 expect(data.manifest.diagrams[0]!.folder).toBe('Arquitetura');
 const idle=await engine.run();expect(idle.changed).toEqual([]);expect(idle.status.metrics.reads).toBe(0);
});
it('updates a changed Markdown with one source read and never modifies the original repository file',async()=>{
 const {engine,files}=fixture();const first=await engine.run(),state=JSON.parse(first.files['repository-state.json']!),slug=state.knowledge.documents['docs/api.md'].slug;
 files.set('docs/api.md','# API guide\n\nA more precise explanation.');const next=await engine.run();
 expect(next.status.metrics.reads).toBe(1);expect(next.data.docs[slug]).toContain('A more precise explanation.');
 expect(next.changed).not.toContain('diagrams/repository.strukt.json');expect(files.get('docs/api.md')).toBe('# API guide\n\nA more precise explanation.');expect((await engine.run()).changed).toEqual([]);
});
it('connects the project README to the overview even when a monorepo has no standalone root module',async()=>{
 const {engine,files}=fixture();files.set('package.json','{"name":"monorepo","workspaces":["apps/*"]}');files.delete('src/index.ts');files.set('apps/api/package.json','{"name":"api"}');files.set('apps/api/index.ts','export const api=true;');
 const result=await engine.run(),slug=JSON.parse(result.files['repository-state.json']!).knowledge.documents['README.md'].slug;
 expect(result.data.board.connections.some(edge=>edge.from==='diagram:repository'&&edge.to==='doc:'+slug)).toBe(true);
});
it('preserves manual text, titles, root placement, card coordinates and changed or deleted Overview relations',async()=>{
 const {engine,files,adapter}=fixture(),first=await engine.run(),state=JSON.parse(first.files['repository-state.json']!),slug=state.knowledge.documents['docs/api.md'].slug;
 await adapter.write('docs/'+slug+'.md','# Human explanation');
 const manifest=JSON.parse(first.files['strukt.json']!);const entry=manifest.docs.find((d:any)=>d.slug===slug);entry.title='Our API';delete entry.folder;
 const generated=manifest.diagrams.find((d:any)=>d.slug==='repository');delete generated.folder;await adapter.write('strukt.json',JSON.stringify(manifest));
 const board=JSON.parse(first.files['board.json']!);board.cards.find((c:any)=>c.id==='doc:'+slug).x=9000;const removed=board.connections.pop();board.connections[0].label='Manual relationship';await adapter.write('board.json',JSON.stringify(board));
 files.set('docs/api.md','# API guide\n\nA conflicting code explanation.');const next=await engine.run();
 expect(next.data.docs[slug]).toBe('# Human explanation');expect(next.data.manifest.docs.find(d=>d.slug===slug)).toMatchObject({title:'Our API'});expect(next.data.manifest.docs.find(d=>d.slug===slug)?.folder).toBeUndefined();expect(next.data.manifest.diagrams[0]!.folder).toBeUndefined();
 expect(next.data.board.cards.find(c=>c.id==='doc:'+slug)?.x).toBe(9000);expect(next.data.board.connections.some(c=>c.id===removed.id)).toBe(false);expect(next.data.board.connections[0]?.label).toBe('Manual relationship');
 expect(next.status.pending.join('\n')).toContain('manual changes');expect((await engine.run()).changed).toEqual([]);
});
it('retains ids on an unambiguous Markdown rename and keeps missing source projections visible for review',async()=>{
 const {engine,files}=fixture(),first=await engine.run(),old=JSON.parse(first.files['repository-state.json']!).knowledge.documents['docs/api.md'];
 files.set('docs/reference.md',files.get('docs/api.md')!);files.delete('docs/api.md');const renamed=await engine.run(),mapped=JSON.parse(renamed.files['repository-state.json']!).knowledge.documents;
 expect(mapped['docs/reference.md'].slug).toBe(old.slug);expect(mapped['docs/api.md']).toBeUndefined();expect(renamed.data.docs[old.slug]).toContain('`docs/reference.md`');
 files.delete('docs/reference.md');const missing=await engine.run();expect(missing.data.docs[old.slug]).toBeDefined();expect(missing.status.pending.join('\n')).toContain('source is unavailable');
});
it('does not recreate a document deleted in the editor and keeps --check read-only',async()=>{
 const {engine,adapter}=fixture();const check=await engine.run({check:true});expect(check.status.knowledge?.documents).toBe(3);expect(await adapter.list()).toEqual([]);
 const first=await engine.run(),state=JSON.parse(first.files['repository-state.json']!),slug=state.knowledge.documents['docs/api.md'].slug,manifest=JSON.parse(first.files['strukt.json']!);manifest.docs=manifest.docs.filter((d:any)=>d.slug!==slug);await adapter.write('strukt.json',JSON.stringify(manifest));
 const next=await engine.run();expect(next.data.manifest.docs.some(d=>d.slug===slug)).toBe(false);expect(next.status.pending.join('\n')).toContain('removed in the editor');
});
it('ignores links inside fenced code, inline code, images and external addresses when deriving repository relations',()=>{
 expect(markdownTargets('[API](docs/api.md)\n```md\n[Fake](fake.md)\n```\n`[Inline](inline.md)`\n![image](image.md)\n[ref]: <docs/reference.md>')).toEqual(['docs/api.md','docs/reference.md']);
});
