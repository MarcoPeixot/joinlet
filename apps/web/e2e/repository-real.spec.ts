import { togglePanel } from './panelMenu';
import { test, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let root:string,monorepoRoot:string,api:string,child:ReturnType<typeof spawn>;
test.beforeAll(async()=>{
 root=await mkdtemp(join(tmpdir(),'joinlet-browser-repository-'));
 execFileSync('git',['init','-q',root]);
 await mkdir(join(root,'src'),{recursive:true});await writeFile(join(root,'package.json'),'{"name":"repository-browser-test"}');await writeFile(join(root,'README.md'),'# Browser repository\n\nAn example API.\n');await writeFile(join(root,'src','api.ts'),'export const api=true;\n');
 monorepoRoot=await mkdtemp(join(tmpdir(),'joinlet-browser-monorepo-'));execFileSync('git',['init','-q',monorepoRoot]);
 await writeFile(join(monorepoRoot,'package.json'),'{"name":"product","workspaces":["apps/*","packages/*"]}');await writeFile(join(monorepoRoot,'README.md'),'# Entire product\n\nArchitecture for the entire product.\n');
 for(const path of ['apps/web','apps/api','apps/worker','packages/domain','packages/storage','packages/protocol','packages/layout','packages/workspace']){
   const name=path.split('/')[1]!;await mkdir(join(monorepoRoot,path,'src'),{recursive:true});await writeFile(join(monorepoRoot,path,'package.json'),JSON.stringify({name:'@example/'+name,...(name==='web'?{dependencies:{react:'*'}}:{})}));
   await writeFile(join(monorepoRoot,path,'src/index.ts'),(name==='web'?'import React from "react";\n'+Array.from({length:30},(_,i)=>`import library${i} from "library-${i}";`).join('\n'):'import {shared} from "@example/workspace";')+'\nexport const shared=true;\n');
 }
 await writeFile(join(monorepoRoot,'apps/web/README.md'),'# Extension\n\nExtension documentation.\n');
 const script=`import {createApp} from './apps/server/src/app';import {createSettings} from './apps/server/src/settings';
 const client={beta:{messages:{create:async params=>{if(params.tools?.some(tool=>tool.name==='repository_analysis'))return {content:[{type:'tool_use',name:'repository_analysis',input:{facts:[],proposals:[]}}]};if(!JSON.stringify(params.system).includes('Repository source snapshot'))throw Error('Actual repository source context was not provided');return {content:[{type:'tool_use',name:'create_workspace_items',input:{summary:'Análise detalhada criada a partir das fontes.',items:[{kind:'doc',title:'Fluxo da API',folder:'Análise/API',markdown:'# Fluxo da API\\n\\nFonte: src/api.ts. Revisão analisada registrada no contexto.'},{kind:'diagram',title:'Detalhes da API',folder:'Análise/API',ops:[{op:'add_node',id:'API',icon:'si:typescript',presentation:'card',description:'Fonte: src/api.ts'}]}]}}]};}}}};
 const settings=createSettings({file:'unused-test-settings',env:{ANTHROPIC_API_KEY:'synthetic-fixture-key'},fs:{read:async()=>null,write:async()=>{}},anthropic:()=>client,openrouter:()=>client});await settings.load();let root=null;
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:createApp({settings,allowedOrigins:['http://localhost:'+process.env.STRUKT_E2E_PORT],selectedRepo:{get:()=>root,set:async value=>{root=value}}}).fetch});console.log('PORT:'+server.port);`;
 child=spawn('bun',['-e',script],{cwd:new URL('../../..',import.meta.url).pathname,env:process.env,stdio:['ignore','pipe','pipe']});
 api=await new Promise<string>((resolve,reject)=>{let text='';const timeout=setTimeout(()=>reject(Error('Repository test API did not start.')),15000);child.stdout!.on('data',chunk=>{text+=String(chunk);const match=text.match(/PORT:(\d+)/);if(match){clearTimeout(timeout);resolve('http://127.0.0.1:'+match[1]);}});child.once('exit',()=>reject(Error('Repository API exited.')));});
});
test.afterEach(async({page})=>{await page.unrouteAll({behavior:'ignoreErrors'});});
test.afterAll(async()=>{child?.kill('SIGTERM');await rm(root,{recursive:true,force:true});await rm(monorepoRoot,{recursive:true,force:true});});
test('initializes a real Git folder and follows a code edit into the running editor',async({page})=>{
 await page.route('**/api/**',async route=>{const request=route.request(),url=new URL(request.url());if(url.pathname.endsWith('/events'))return route.fulfill({status:503,body:'Event stream fallback exercised.'});const response=await fetch(api+url.pathname+url.search,{method:request.method(),headers:{'content-type':'application/json'},body:request.method()==='GET'?undefined:request.postData()??'{}'});await route.fulfill({status:response.status,headers:{'content-type':response.headers.get('content-type')??'application/json'},body:await response.text()});});
 await page.goto('/app/');
 await togglePanel(page,'GitHub');
 await page.getByRole('textbox',{name:'Pasta local',exact:true}).fill(root);
 await page.getByRole('button',{name:'Conectar',exact:true}).click();
 await expect.poll(async()=>{const state=await(await fetch(api+'/api/repositories')).json() as {connections:{phase:string;error?:string;persistedRevision?:string}[]};if(state.connections[0]?.phase==='error')throw Error(state.connections[0].error);return !!state.connections[0]?.persistedRevision;},{timeout:15000}).toBe(true);
 await expect(page.getByText('repository-browser-test',{exact:true}).first()).toBeVisible({timeout:20000});
 const manifest=JSON.parse(await readFile(join(root,'.arch','strukt.json'),'utf8'));expect(manifest.diagrams.some((d:{slug:string})=>d.slug==='repository')).toBe(true);
 await writeFile(join(root,'src','api.ts'),'import redis from "redis";\nexport const api=redis;\n');
 await expect(page.getByText('redis',{exact:true}).first()).toBeVisible({timeout:20000});
 expect(await readFile(join(root,'.arch','diagrams','repository.strukt.json'),'utf8')).toContain('redis');
});

test('opens a compact monorepo overview with readable modules and the root project documentation',async({page})=>{
 await page.route('**/api/**',async route=>{const request=route.request(),url=new URL(request.url());if(url.pathname.endsWith('/events'))return route.fulfill({status:503,body:'Polling fallback.'});const response=await fetch(api+url.pathname+url.search,{method:request.method(),headers:{'content-type':'application/json'},body:request.method()==='GET'?undefined:request.postData()??'{}'});await route.fulfill({status:response.status,headers:{'content-type':response.headers.get('content-type')??'application/json'},body:await response.text()});});
 await page.goto('/app/');await togglePanel(page,'GitHub');await page.getByRole('textbox',{name:'Pasta local',exact:true}).fill(monorepoRoot);await page.getByRole('button',{name:'Conectar',exact:true}).click();
 await expect(page.locator('.react-flow__node[data-id^="repo_"]').filter({has:page.locator('.strukt-scene-card')})).toHaveCount(8,{timeout:20000});
 await expect(page.getByText('Pacotes compartilhados · packages',{exact:true}).first()).toBeVisible();
 const webCard=page.locator('.strukt-scene-card').filter({has:page.getByText('web',{exact:true})});
 await expect(webCard.locator('.strukt-scene-card__technology')).toHaveText('React · TypeScript');
 await expect(webCard.locator('.strukt-scene-card__chip svg path')).toHaveAttribute('d',JSON.parse(await readFile(new URL('../src/diagram/icons/simple-subset.json',import.meta.url),'utf8')).react.path);
 const panel=page.getByRole('complementary',{name:'GitHub'});await panel.getByRole('button',{name:'Fechar',exact:true}).click();
 await expect(panel).toBeHidden();
 await page.getByRole('button',{name:'Ajustar à tela',exact:true}).click();
 await expect.poll(()=>page.locator('.react-flow__viewport').evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).a)).toBeGreaterThan(0.55);
 await expect.poll(()=>page.evaluate(async()=>{const {diagramStore}=await import('../src/state/appStore');const state=diagramStore.getState();return Object.keys(state.layout.edges).length===state.model.edges.length;})).toBe(true);
 await expect.poll(()=>page.locator('.react-flow').evaluate(canvas=>{const bounds=canvas.getBoundingClientRect();return [...canvas.querySelectorAll('.react-flow__node .strukt-scene-card')].every(card=>{const box=card.getBoundingClientRect();return box.left>=bounds.left&&box.right<=bounds.right&&box.top>=bounds.top&&box.bottom<=bounds.bottom;});})).toBe(true);
 await page.screenshot({path:'/tmp/joinlet-repository-overview.png',animations:'disabled'});
 await page.locator('.strukt-scene-card').getByText('api',{exact:true}).click();
 await expect.poll(()=>page.locator('.react-flow__edge.sk-dim').count()).toBeGreaterThan(0);
 await expect.poll(()=>page.locator('.react-flow__edge.sk-focus-edge').count()).toBeGreaterThan(0);
 const document=await readFile(join(monorepoRoot,'.arch/docs/repository-architecture.md'),'utf8');expect(document).toContain('Fonte: `README.md`');expect(document).toContain('Architecture for the entire product.');expect(document).toContain('library-29');
 const model=JSON.parse(await readFile(join(monorepoRoot,'.arch/diagrams/repository.strukt.json'),'utf8'));expect(JSON.stringify(model)).not.toContain('library-29');
});

test('offers source-backed enrichment after sync, exposes the agent task and persists detailed AI items through the real backend',async({page})=>{
 await page.route('**/api/**',async route=>{const request=route.request(),url=new URL(request.url());if(url.pathname.endsWith('/events'))return route.fulfill({status:503,body:'Polling fallback.'});const response=await fetch(api+url.pathname+url.search,{method:request.method(),headers:{'content-type':'application/json'},body:request.method()==='GET'?undefined:request.postData()??'{}'});await route.fulfill({status:response.status,headers:{'content-type':response.headers.get('content-type')??'application/json'},body:await response.text()});});
 await page.goto('/app/');await togglePanel(page,'GitHub');await page.getByRole('textbox',{name:'Pasta local',exact:true}).fill(root);await page.getByRole('button',{name:'Conectar',exact:true}).click();
 await expect(page.locator('.strukt-scene-card').getByText('repository-browser-test',{exact:true})).toBeVisible({timeout:20000});
 await page.getByRole('complementary',{name:'GitHub'}).getByRole('button',{name:'Fechar',exact:true}).click();
 await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Overview',exact:true}).click();
 const notice=page.getByRole('complementary',{name:'Aprofundar a análise do repositório'});await expect(notice).toBeVisible();await notice.getByRole('button',{name:/Aprofundar com IA/}).click();await notice.getByRole('button',{name:'Usar meu agente local'}).click();
 await expect(notice.getByText(/list_repository_files/)).toBeVisible();
 const board=JSON.parse(await readFile(join(root,'.arch/board.json'),'utf8'));expect(board.connections.length).toBeGreaterThan(0);
 await page.getByLabel('Filtrar Overview por pasta').selectOption('Arquitetura');await expect(page.locator('.react-flow__node[data-id^="doc:"]')).toHaveCount(1);await page.getByLabel('Filtrar Overview por pasta').selectOption('');
 await notice.getByRole('button',{name:'Analisar com IA do Joinlet',exact:true}).click();
 const chat=page.getByRole('complementary',{name:'Chat com a IA',exact:true});await expect(chat.getByText('Análise detalhada criada a partir das fontes.',{exact:true})).toBeVisible({timeout:20000});
 await expect.poll(async()=>JSON.parse(await readFile(join(root,'.arch/strukt.json'),'utf8')).docs.some((d:any)=>d.title==='Fluxo da API'&&d.folder==='Análise/API')).toBe(true);
 const manifest=JSON.parse(await readFile(join(root,'.arch/strukt.json'),'utf8'));expect(manifest.diagrams.some((d:any)=>d.title==='Detalhes da API'&&d.folder==='Análise/API')).toBe(true);
 await chat.getByRole('button',{name:'Nova conversa',exact:true}).click();
 await page.route('**/api/ai/chat',async route=>{expect(route.request().postDataJSON().context).not.toContain('Repository source snapshot');await route.fulfill({json:{reply:'Nova conversa sem fontes anexadas.'}});});
 await chat.getByRole('textbox',{name:'Mensagem para a IA'}).fill('Olá');await chat.getByRole('button',{name:'Enviar',exact:true}).click();await expect(chat.getByText('Nova conversa sem fontes anexadas.',{exact:true})).toBeVisible();
});

test('rejects a delayed AI edit when the repository source revision changed during the response',async({page})=>{
 let stale=false,connectionId='',snapshotRevision='';
 await page.route('**/api/**',async route=>{const request=route.request(),url=new URL(request.url());if(url.pathname.endsWith('/events'))return route.fulfill({status:503,body:'Polling fallback.'});
  if(url.pathname.endsWith('/ai/chat')){stale=true;await writeFile(join(root,'src/api.ts'),'export const changedDuringAnalysis='+Date.now()+';');await expect.poll(async()=>(await(await fetch(api+`/api/repositories/${connectionId}/revision`)).json()).revision).not.toBe(snapshotRevision);}
  const response=await fetch(api+url.pathname+url.search,{method:request.method(),headers:{'content-type':'application/json'},body:request.method()==='GET'?undefined:request.postData()??'{}'}),body=await response.text();
  if(url.pathname.endsWith('/context')){connectionId=url.pathname.split('/')[3]!;snapshotRevision=JSON.parse(body).revision;}
  await route.fulfill({status:response.status,headers:{'content-type':response.headers.get('content-type')??'application/json'},body});
 });
 await page.goto('/app/');await togglePanel(page,'GitHub');await page.getByRole('textbox',{name:'Pasta local',exact:true}).fill(root);await page.getByRole('button',{name:'Conectar',exact:true}).click();await expect(page.locator('.strukt-scene-card').getByText('repository-browser-test',{exact:true})).toBeVisible({timeout:20000});
 await page.getByRole('complementary',{name:'GitHub'}).getByRole('button',{name:'Fechar',exact:true}).click();await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Overview',exact:true}).click();
 const before=JSON.parse(await readFile(join(root,'.arch/strukt.json'),'utf8')),notice=page.getByRole('complementary',{name:'Aprofundar a análise do repositório'});await notice.getByRole('button',{name:/Aprofundar com IA/}).click();await notice.getByRole('button',{name:'Analisar com IA do Joinlet',exact:true}).click();
 await expect(page.getByRole('complementary',{name:'Chat com a IA',exact:true}).getByRole('alert')).toContainText(/revision|revisão|workspace/i,{timeout:20000});expect(stale).toBe(true);
 const after=JSON.parse(await readFile(join(root,'.arch/strukt.json'),'utf8'));expect(after.docs.length).toBe(before.docs.length);expect(after.diagrams.length).toBe(before.diagrams.length);
});
