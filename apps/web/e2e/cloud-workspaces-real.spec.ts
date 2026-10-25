import { test, expect, type Page } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let root:string,origin:string,token:string,first:string,backend:ReturnType<typeof spawn>,connector:ReturnType<typeof spawn>|undefined;
const checkout=new URL('../../..',import.meta.url).pathname;
async function projects(page:Page){await page.getByRole('button',{name:'Menu do workspace'}).click();await page.getByRole('menuitem',{name:'Meus projetos',exact:true}).click();await expect(page.getByRole('heading',{name:'Meus projetos'})).toBeVisible();}
test.beforeAll(async()=>{
 root=await mkdtemp(join(tmpdir(),'joinlet-cloud-browser-'));const repo=join(root,'loja');await mkdir(join(repo,'src'),{recursive:true});
 execFileSync('git',['init','-q',repo]);await writeFile(join(repo,'package.json'),'{"name":"store-api"}');await writeFile(join(repo,'README.md'),'# Loja\n\nAn API for a store.\n');await writeFile(join(repo,'src/api.ts'),'export const api=true;\n');
 const port=await new Promise<number>(done=>{const server=createServer().listen(0,'127.0.0.1',()=>{const p=(server.address() as {port:number}).port;server.close(()=>done(p));});});origin=`http://127.0.0.1:${port}`;
 const script=`import {createRemoteApp} from './apps/remote/src/app';import {createRemoteCollaboration} from './apps/remote/src/collaboration';const options={deploymentMode:'cloud',publicUrl:process.env.TEST_ORIGIN,databasePath:process.env.TEST_DATABASE,encryptionKey:'7'.repeat(64)};const remote=createRemoteApp(options),collab=createRemoteCollaboration(options,remote.auth,remote.hosted);const account=remote.auth.accounts.register('browser@example.test','synthetic'),session=remote.auth.createWebSession(account.id),workspace=remote.hosted.store.workspaceFor(account.id);const storage=remote.hosted.store.adapter(workspace);const manifest=JSON.parse(await storage.read('strukt.json'));manifest.name='loja';await storage.write('strukt.json',JSON.stringify(manifest));const server=remote.app.listen(Number(new URL(options.publicUrl).port),'127.0.0.1',()=>console.log(JSON.stringify({token:session.token,workspace})));server.on('upgrade',(req,socket,head)=>void collab.upgrade(req,socket,head));process.once('SIGTERM',()=>process.exit(0));`;
 backend=spawn('bun',['-e',script],{cwd:checkout,env:{...process.env,TEST_ORIGIN:origin,TEST_DATABASE:join(root,'remote.sqlite')},stdio:['ignore','pipe','pipe']});
 const seeded=await new Promise<{token:string;workspace:string}>((done,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Cloud backend did not start')),15000);backend.stdout!.on('data',chunk=>{text+=String(chunk);if(text.includes('\n')){clearTimeout(timer);done(JSON.parse(text.trim().split('\n')[0]!));}});backend.once('exit',()=>reject(Error('Cloud backend exited')));});token=seeded.token;first=seeded.workspace;
});
test.afterAll(async()=>{
 for(const child of [connector,backend])if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise<void>(done=>{const timer=setTimeout(()=>{child.kill('SIGKILL');done();},3000);child.once('exit',()=>{clearTimeout(timer);done();});});}
 await rm(root,{recursive:true,force:true});
});
test('uses real Cloud sessions and connector, copies pairing, follows code and creates isolated workspaces',async({page,context})=>{
 test.setTimeout(90_000);
 page.setDefaultTimeout(15_000);
 await context.addCookies([{name:'joinlet_session',value:token,url:origin}]);await context.grantPermissions(['clipboard-read','clipboard-write'],{origin});
 await page.goto(origin+'/app/?lang=pt-BR');await expect(page.getByRole('navigation',{name:'Workspace'})).toContainText('loja');
 await page.getByRole('button',{name:'Menu do workspace'}).click();await expect(page.getByRole('menuitem',{name:/Gerar contexto para agentes/})).toHaveCount(0);
 await page.getByRole('menuitem',{name:/^Abrir pasta/}).click();await expect(page.getByRole('button',{name:'Conectar computador',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Conectar computador',exact:true}).click();const command=page.locator('pre').filter({hasText:'joinlet connect --cloud-url'});await expect(command).toBeVisible();
 await command.dblclick();expect(await page.evaluate(()=>window.getSelection()?.toString())).toBeTruthy();
 await page.getByRole('button',{name:'Copiar comando de conexão',exact:true}).click();await expect(page.getByRole('button',{name:'Copiar comando de conexão'})).toHaveText('Copiado.');
 const text=await page.evaluate(()=>navigator.clipboard.readText());expect(text).toContain('joinlet connect --cloud-url '+origin);const pair=text.match(/--pair ([A-Fa-f0-9]+)/)![1]!;
 connector=spawn('bun',['apps/cli/src/main.ts','connect','--cloud-url',origin,'--pair',pair,'--dir',join(root,'loja')],{cwd:checkout,env:{...process.env,NODE_ENV:'test',STRUKT_CONFIG_DIR:join(root,'connector-config')},stdio:['ignore','pipe','pipe']});
 await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Visão geral — loja',exact:true}).click({timeout:30000});
 await expect(page.getByText('store-api',{exact:true}).first()).toBeVisible({timeout:30000});
 for(const path of ['AGENTS.md','CLAUDE.md'])expect(await readFile(join(root,'loja',path),'utf8')).toContain('.arch/context/ARCHITECTURE.md');
 await writeFile(join(root,'loja','src/api.ts'),'import redis from "redis";\nexport const api=redis;\n');await expect(page.getByText('redis',{exact:true}).first()).toBeVisible({timeout:30000});
 await projects(page);await expect(page.getByRole('button',{name:'Novo workspace',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Novo workspace',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Novo workspace',exact:true});await dialog.getByRole('textbox',{name:'Nome do workspace'}).fill('Outro projeto');await dialog.getByRole('button',{name:'Criar workspace'}).click();
 await expect(page.getByRole('navigation',{name:'Workspace'})).toContainText('Outro projeto');const second=new URL(page.url()).searchParams.get('workspace')!;expect(second).not.toBe(first);
 const other=await context.newPage();await other.goto(origin+'/app/?lang=pt-BR&workspace='+encodeURIComponent(first));await other.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Visão geral — loja',exact:true}).click();await expect(other.getByText('redis',{exact:true}).first()).toBeVisible();
 await projects(page);await expect(page.getByRole('button',{name:'Abrir workspace loja',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Abrir workspace Outro projeto',exact:true})).toContainText('Atual');
 await page.getByRole('button',{name:'Abrir workspace loja',exact:true}).click();await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Visão geral — loja',exact:true}).click();await expect(page.getByText('redis',{exact:true}).first()).toBeVisible();
 await other.close();
});
