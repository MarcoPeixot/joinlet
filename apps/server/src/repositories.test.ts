import { describe,expect,it } from 'vitest';
import { mkdtemp,mkdir,writeFile,readFile,rm,symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createRepositoryService } from './repositories';
import { command } from '@strukt/workspace/repository-reader';

describe('local repository connection',()=>{
 it('initializes and watches a Git project without confusing metadata order or its own writes with code changes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'joinlet-service-'));const service=createRepositoryService();
  try{
   await command('git',['init','-q',root],root);await mkdir(join(root,'src'));await writeFile(join(root,'README.md'),'# Project\n');await writeFile(join(root,'package.json'),'{"name":"project"}');await writeFile(join(root,'src','api.ts'),'export const api=true;\n');
   const job=await service.connect(root,'pt-BR');
   await expect.poll(()=>service.get(job.id)?.persistedRevision,{timeout:10000}).toBeTruthy();
   expect(service.get(job.id)?.phase).toBe('paused');
   const manifest=JSON.parse(await readFile(join(root,'.arch','strukt.json'),'utf8'));
   expect(manifest.diagrams.find((d:{slug:string})=>d.slug==='repository').title).toBe(`Visão geral — ${basename(root)}`);
   const initial=service.get(job.id)!.persistedRevision;
   await writeFile(join(root,'src','api.ts'),'import redis from "redis";\nexport const api=redis;\n');
   await expect.poll(()=>service.get(job.id)?.persistedRevision??initial,{timeout:10000}).not.toBe(initial);
   expect(await readFile(join(root,'.arch','diagrams','repository.strukt.json'),'utf8')).toContain('redis');
   service.disconnect(job.id);expect(service.get(job.id)).toBeNull();
  }finally{service.close();await rm(root,{recursive:true,force:true});}
 },20000);
 it('accepts folders without Git and refuses an .arch symlink escaping the selected root',async()=>{
  const root=await mkdtemp(join(tmpdir(),'joinlet-no-git-')),outside=await mkdtemp(join(tmpdir(),'joinlet-outside-')),service=createRepositoryService();
  try{
   await writeFile(join(root,'service.py'),'from redis import Redis\nservice=Redis()\n');const job=await service.connect(root);await expect.poll(()=>service.get(job.id)?.persistedRevision,{timeout:10000}).toBeTruthy();
   service.disconnect(job.id);await rm(join(root,'.arch'),{recursive:true,force:true});await symlink(outside,join(root,'.arch'));
   await expect(service.connect(root)).rejects.toThrow('symbolic link');
  }finally{service.close();await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
 });
});
it('reconciles Git renames, deletions and branch switches through the same watched connection',async()=>{
 const root=await mkdtemp(join(tmpdir(),'joinlet-git-transitions-')),service=createRepositoryService();
 const git=(args:string[])=>command('git',['-c','core.hooksPath=/dev/null','-c','user.name=Joinlet Test','-c','user.email=fixture@example.test',...args],root);
 try{
  await git(['init','-q','-b','initial']);await mkdir(join(root,'src'));await writeFile(join(root,'package.json'),'{"name":"transitions"}');await writeFile(join(root,'src','api.ts'),'import redis from "redis";\nexport const api=redis;\n');await git(['add','.']);await git(['commit','-qm','initial']);
  const job=await service.connect(root),model=()=>readFile(join(root,'.arch','diagrams','repository.strukt.json'),'utf8').catch(()=>'');
  await expect.poll(model,{timeout:10000}).toContain('redis');
  await git(['mv','src/api.ts','src/client.ts']);
  await expect.poll(()=>readFile(join(root,'.arch','evidence.json'),'utf8'),{timeout:10000}).toContain('src/client.ts');
  await git(['checkout','-qb','other']);await rm(join(root,'src','client.ts'));await writeFile(join(root,'src','worker.ts'),'import pg from "pg";\nexport const worker=pg;\n');await git(['add','src']);await git(['commit','-qm','other branch']);
  await expect.poll(model,{timeout:10000}).toContain('pg');expect(await model()).not.toContain('redis');
  await git(['checkout','-q','initial']);await expect.poll(model,{timeout:10000}).toContain('redis');expect(await model()).not.toContain('pg');expect(service.get(job.id)?.phase).not.toBe('error');
 }finally{service.close();await rm(root,{recursive:true,force:true});}
},30000);
