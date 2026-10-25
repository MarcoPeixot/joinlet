import {expect,it} from 'vitest';
import {extractRepositoryFacts,RepositoryEngine} from './engine';
import {createMemoryAdapter} from '../storage';
import {repositoryPresentation} from './presentation';
import {DEFAULT_REPOSITORY_CONFIG} from './contracts';

function project(){return new Map([
 ['package.json','{"name":"project","workspaces":["apps/*"],"dependencies":{"react":"*"}}'],
 ['README.md','# Project\n\nA React, Django and Vue tutorial.'],
 ['apps/frontend/package.json','{"name":"@project/frontend"}'],
 ['apps/frontend/src/index.ts','export const frontend=true;'],
 ['apps/web/package.json','{"name":"@project/web","dependencies":{"react":"*","next":"*"},"devDependencies":{"vite":"*","typescript":"*"}}'],
 ['apps/web/src/index.tsx','import React from "react";\nexport const App=()=> <main/>;'],
 ['apps/api/package.json','{"name":"@project/api","dependencies":{"hono":"*"},"devDependencies":{"react":"*"}}'],
 ['apps/api/src/index.ts','import {Hono} from "hono";\nimport {Database} from "bun:sqlite";\nexport const api=new Hono();'],
 ['apps/api/src/example.test.tsx','import React from "react";\nexport const example=()=> <main/>;'],
 ['apps/python/main.py','from fastapi import FastAPI\napp=FastAPI()'],
 ]);}
const reader=(files:Map<string,string>)=>({list:async()=>[...files].map(([path,text])=>({path,revision:text})),revision:async()=>JSON.stringify([...files]),read:async(path:string)=>files.get(path)??null});

it('detects frameworks, languages and runtime within module boundaries instead of guessing from names or READMEs',async()=>{
 const facts=await extractRepositoryFacts(project()),module=(path:string)=>facts.find(f=>f.path===path)!;
 expect(module('apps/web').primaryTechnology).toBe('nextjs');
 expect(module('apps/web').technologies?.map(t=>t.id)).toEqual(['nextjs','react','typescript','vite']);
 expect(module('apps/api').technologies?.map(t=>t.id)).toEqual(['hono','typescript','bun','sqlite']);
 expect(module('apps/frontend').primaryTechnology).toBe('typescript');
 expect(module('apps/frontend').technologies?.map(t=>t.id)).not.toContain('react');
 expect(module('apps/python').primaryTechnology).toBe('fastapi');
 expect(facts.some(f=>f.technologies?.some(t=>t.id==='vue'||t.id==='django'))).toBe(false);
 const view=repositoryPresentation(facts,{...DEFAULT_REPOSITORY_CONFIG,view:'modules'},new Map(facts.map(f=>[f.id,f.label])));
 expect(view.model.elements[module('apps/web').id]).toMatchObject({icon:'si:nextdotjs',tech:'Next.js · TypeScript'});
 expect(view.model.elements[module('apps/frontend').id]).toMatchObject({icon:'si:typescript'});
});

it('gives recognized libraries their own icons without turning a data client into the module identity',async()=>{
 const files=new Map([['src/index.ts','import Redis from "ioredis";\nexport const client=new Redis();']]);
 const facts=await extractRepositoryFacts(files),view=repositoryPresentation(facts,DEFAULT_REPOSITORY_CONFIG,new Map(facts.map(f=>[f.id,f.label])));
 expect(view.model.elements[facts.find(f=>f.kind==='dependency')!.id].icon).toBe('si:redis');
 expect(view.model.elements[facts.find(f=>f.kind==='module')!.id].icon).toBe('si:typescript');
});

it('chooses the predominant source language instead of a helper script or a compiler devDependency',async()=>{
 const files=new Map([['package.json','{"name":"scripts","devDependencies":{"typescript":"*"}}'],['scripts/helper.py','print("helper")']]);
 for(let i=0;i<12;i++)files.set('scripts/task-'+i+'.ts','export const task=true;');
 files.set('src/index.js','export const app=true;');
 const facts=await extractRepositoryFacts(files);
 expect(facts.find(f=>f.path==='scripts')!.primaryTechnology).toBe('typescript');
 expect(facts.find(f=>f.path==='.')!.primaryTechnology).toBe('javascript');
});

it('updates detected icons incrementally, preserves manual choices and anchors technology evidence',async()=>{
 const files=new Map([['package.json','{"name":"web"}'],['src/index.tsx','import React from "react";\nexport const App=()=>null;']]);
 const adapter=createMemoryAdapter(),engine=new RepositoryEngine(reader(files),adapter),first=await engine.run({locale:'pt-BR'});
 const id=Object.values(first.data.diagrams.repository!.model.elements).find(e=>e.label==='web')!.id;
 expect(first.data.diagrams.repository!.model.elements[id].icon).toBe('si:react');
 expect(first.data.docs['repository-architecture']).toContain('## Tecnologias identificadas');
 expect(first.data.docs['repository-architecture']).toContain('**React** (ícone): `src/index.tsx:1`');
 expect(first.data.evidence?.repository?.[id].some(r=>r.path==='src/index.tsx'&&r.contains?.includes('react'))).toBe(true);
 files.set('src/index.tsx','import {createApp} from "vue";\nexport const App=createApp({});');
 const next=await engine.run();expect(next.status.metrics.reads).toBe(1);expect(next.data.diagrams.repository!.model.elements[id].icon).toBe('si:vuedotjs');
 expect(next.data.diagrams.repository!.layout.nodes[id]).toEqual(first.data.diagrams.repository!.layout.nodes[id]);
 const json=JSON.parse(next.files['diagrams/repository.strukt.json']!);json.nodes.find((n:{id:string})=>n.id===id).icon='rocket';json.nodes.find((n:{id:string})=>n.id===id).tech='My platform';await adapter.write('diagrams/repository.strukt.json',JSON.stringify(json));
 files.set('src/index.tsx','import React from "react";\nexport const App=()=>null;');
 const manual=await engine.run();expect(manual.data.diagrams.repository!.model.elements[id]).toMatchObject({icon:'rocket',tech:'My platform'});
 const idle=await engine.run();expect(idle.changed).toEqual([]);expect(idle.status.metrics.reads).toBe(0);
});

it('lets AI refine responsibilities and the primary detected technology with module evidence, reusing it after restart',async()=>{
 const files=new Map([['package.json','{"name":"desktop","dependencies":{"electron":"*","react":"*"}}'],['src/index.tsx','import React from "react";\nexport const App=()=>null;']]);
 const adapter=createMemoryAdapter();let calls=0;
 const analyzed=await new RepositoryEngine(reader(files),adapter,{identity:'controlled',analyze:async input=>{calls++;return {facts:input.facts.filter(f=>f.kind==='module').map(f=>({...f,label:'Desktop interface',primaryTechnology:'react',refs:[{path:'src/index.tsx',line:1,contains:'import React from "react";'}]})),proposals:[]};}}).run();
 const node=Object.values(analyzed.data.diagrams.repository!.model.elements).find(e=>e.label==='Desktop interface')!;
 expect(node.icon).toBe('si:react');expect(calls).toBe(1);
 const reloaded=await new RepositoryEngine(reader(files),adapter).run({check:true});
 expect(reloaded.changed).toEqual([]);expect(reloaded.data.diagrams.repository!.model.elements[node.id].icon).toBe('si:react');
 files.set('src/index.tsx','export const App=()=>null;');files.set('package.json','{"name":"desktop","dependencies":{"electron":"*"}}');
 const removed=await new RepositoryEngine(reader(files),adapter).run();expect(removed.data.diagrams.repository!.model.elements[node.id].icon).toBe('si:electron');
 expect(JSON.parse(removed.files['repository-state.json']!).technologyChoices).toEqual({});
});

it('refuses AI technology claims without a detected signal from that module, including sibling references',async()=>{
 const files=project(),adapter=createMemoryAdapter();
 const result=await new RepositoryEngine(reader(files),adapter,{analyze:async input=>({facts:input.facts.filter(f=>f.path==='apps/frontend'||f.path==='apps/api').map(f=>({...f,primaryTechnology:'react',refs:[{path:'apps/web/src/index.tsx',line:1,contains:'import React from "react";'}]})),proposals:[]})}).run();
 const elements=Object.values(result.data.diagrams.repository!.model.elements);
 expect(elements.find(e=>e.label==='@project/frontend')!.icon).toBe('si:typescript');
 expect(elements.find(e=>e.label==='@project/api')!.icon).toBe('si:hono');
 expect(JSON.parse(result.files['repository-state.json']!).technologyChoices).toEqual({});
});
