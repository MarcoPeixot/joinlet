import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRemoteApp } from './app';

const sha=(s:string)=>createHash('sha1').update(s).digest('hex');
const blobs=new Map<string,string>(),trees=new Map<string,{path:string;type:string;sha:string;size?:number;mode:string}[]>(),flatTrees=new Map<string,Map<string,string>>(),commits=new Map<string,{tree:{sha:string};parents:string[]}>(),refs=new Map<string,string>();
let commitCount=0,pullCount=0;const pulls:{html_url:string;body:string;head:{ref:string;repo:{full_name:string}}}[]=[];
const blob=(text:string)=>{const id=sha(text);blobs.set(id,text);return id;};
function tree(files:Map<string,string>):string{
  const children=new Map<string,Map<string,string>>(),entries:{path:string;type:string;sha:string;size?:number;mode:string}[]=[];
  for(const[path,id]of files){const i=path.indexOf('/');if(i<0)entries.push({path,type:'blob',sha:id,size:Buffer.byteLength(blobs.get(id)!),mode:'100644'});else{const dir=path.slice(0,i);if(!children.has(dir))children.set(dir,new Map());children.get(dir)!.set(path.slice(i+1),id);}}
  for(const[name,files]of children)entries.push({path:name,type:'tree',sha:tree(files),mode:'040000'});
  entries.sort((a,b)=>a.path.localeCompare(b.path));const id=sha(JSON.stringify(entries));trees.set(id,entries);flatTrees.set(id,new Map(files));return id;
}
function commit(files:Map<string,string>,parents:string[]=[]){const id=sha(JSON.stringify([...files])+parents.join(''));commits.set(id,{tree:{sha:tree(files)},parents});return id;}
const sourceFiles=new Map([['package.json',blob('{"name":"api"}')],['README.md',blob('# API\n')],['src/api.ts',blob('export const api=true;\n')]]);
refs.set('main',commit(sourceFiles));
const fake=async(input:RequestInfo|URL,init?:RequestInit)=>{
 const url=new URL(String(input)),path=decodeURIComponent(url.pathname),method=init?.method??'GET',body=init?.body?JSON.parse(String(init.body)):null;
 const json=(value:unknown,status=200)=>Response.json(value,{status});
 if(url.hostname==='github.com'&&path==='/login/oauth/access_token')return json({access_token:'synthetic',expires_in:3600});
 if(path==='/repos/org/repo')return json({id:1,default_branch:'main',permissions:{push:true}});
 if(path==='/repos/org/repo/pulls'&&method==='GET')return json(pulls);
 if(path==='/repos/org/repo/pulls'&&method==='POST'){pullCount++;const p={html_url:'https://github.com/org/repo/pull/1',body:body.body,head:{ref:body.head,repo:{full_name:'org/repo'}}};pulls.push(p);return json(p);}
 const ref=path.match(/^\/repos\/org\/repo\/git\/ref\/heads\/(.+)$/);
 if(ref)return refs.has(ref[1]!)?json({object:{sha:refs.get(ref[1]!)}}):json({},404);
 if(path==='/repos/org/repo/git/refs'&&method==='POST'){refs.set(body.ref.replace('refs/heads/',''),body.sha);return json({});}
 const patch=path.match(/^\/repos\/org\/repo\/git\/refs\/heads\/(.+)$/);
 if(patch){assert.equal(body.force,false);assert.ok(commits.get(body.sha)?.parents.includes(refs.get(patch[1]!)!));refs.set(patch[1]!,body.sha);return json({});}
 const getCommit=path.match(/^\/repos\/org\/repo\/git\/commits\/(.+)$/);if(getCommit)return json(commits.get(getCommit[1]!));
 const getTree=path.match(/^\/repos\/org\/repo\/git\/trees\/(.+)$/);if(getTree){const id=getTree[1]!;return json({tree:url.searchParams.has('recursive')?[...flatTrees.get(id)!].map(([path,id])=>({path,type:'blob',sha:id,size:Buffer.byteLength(blobs.get(id)!),mode:'100644'})):trees.get(id)});}
 const getBlob=path.match(/^\/repos\/org\/repo\/git\/blobs\/(.+)$/);if(getBlob)return json({encoding:'base64',content:Buffer.from(blobs.get(getBlob[1]!)!).toString('base64')});
 if(path==='/repos/org/repo/git/blobs'&&method==='POST')return json({sha:blob(Buffer.from(body.content,'base64').toString('utf8'))});
 if(path==='/repos/org/repo/git/trees'&&method==='POST'){const files=new Map(flatTrees.get(body.base_tree));for(const change of body.tree){if(change.sha===null)files.delete(change.path);else files.set(change.path,change.sha);}return json({sha:tree(files)});}
 if(path==='/repos/org/repo/git/commits'&&method==='POST'){commitCount++;const id=sha(JSON.stringify(body));commits.set(id,{tree:{sha:body.tree},parents:body.parents});return json({sha:id});}
 if(path==='/repos/org/repo/merges'&&method==='POST'){const work=refs.get(body.base)!,source=refs.get(body.head)??body.head;if(work===source)return new Response(null,{status:204});const files=new Map(flatTrees.get(commits.get(work)!.tree.sha));for(const[path,id]of sourceFiles)files.set(path,id);refs.set(body.base,commit(files,[work,source]));return json({});}
 throw Error(`Unexpected mock GitHub request ${method} ${url.pathname}`);
};
const remote=createRemoteApp({publicUrl:'http://127.0.0.1',encryptionKey:'1'.repeat(64),databasePath:':memory:',fetch:fake as typeof fetch,githubClientId:'synthetic-client',githubClientSecret:'synthetic-secret'});
const account=remote.auth.accounts.register('github-repository@example.test','synthetic')!,session=remote.auth.createWebSession(account.id),primary=remote.hosted.store.workspaceFor(account.id),workspace=remote.hosted.store.createWorkspace(account.id,'GitHub project');

const server=remote.app.listen(0,'127.0.0.1');await new Promise<void>(done=>server.once('listening',done));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const request=(path:string,body?:unknown)=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{cookie:`joinlet_session=${session.token}`,'x-strukt-csrf':session.csrf,'x-joinlet-workspace':workspace,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
try{
 const authorization=await(await request('/api/repositories/github/authorize',{})).json() as {url:string};
 const oauthState=new URL(authorization.url).searchParams.get('state');
 const callback=await fetch(base+'/github/callback?code=synthetic&state='+oauthState,{headers:{cookie:`joinlet_session=${session.token}`},redirect:'manual'});assert.equal(callback.status,302);
 assert.equal(new URL(callback.headers.get('location')!,base).searchParams.get('workspace'),workspace);
 assert.equal(remote.auth.accounts.get(account.id)!.github_id,null);
 const response=await request('/api/repositories/github',{repo:'org/repo',branch:'main',locale:'pt-BR'});assert.equal(response.status,202,await response.clone().text());const connected=await response.json() as {id:string};
 assert.equal(await remote.repositories.runNext(),true);
 let state=remote.repositories.queue.get(connected.id)!;assert.ok(JSON.parse(state.status).persistedRevision, state.status);assert.equal(commitCount,1);assert.equal(pullCount,1);
 const published=flatTrees.get(commits.get(JSON.parse(state.status).persistedRevision)!.tree.sha)!;
 for(const path of ['AGENTS.md','CLAUDE.md'])assert.match(blobs.get(published.get(path)!)!,/\.arch\/context\/ARCHITECTURE\.md/);
 const manifest=JSON.parse((await remote.hosted.store.adapter(workspace).read('strukt.json'))!);assert.equal(manifest.diagrams.find((d:{slug:string})=>d.slug==='repository').title,'Visão geral — repo');
 sourceFiles.set('src/api.ts',blob('import redis from "redis";\nexport const api=redis;\n'));refs.set('main',commit(sourceFiles,[refs.get('main')!]));remote.repositories.queue.enqueue(connected.id);await remote.repositories.runNext();
 state=remote.repositories.queue.get(connected.id)!;assert.equal(JSON.parse(state.status).analyzedRevision,refs.get('main'));assert.equal(pullCount,1);assert.equal(commitCount,2);assert.match((await remote.hosted.store.adapter(workspace).read('diagrams/repository.strukt.json'))! ,/redis/);
 remote.repositories.queue.enqueue(connected.id);await remote.repositories.runNext();assert.equal(commitCount,2);assert.equal(pullCount,1);
 const mcp=await(await request(`/api/repositories/${connected.id}/mcp`,{})).json() as {token:string};
 const client=new Client({name:'repository-test',version:'1'});
 await client.connect(new StreamableHTTPClientTransport(new URL(base+`/mcp/repositories/${connected.id}`),{requestInit:{headers:{authorization:`Bearer ${mcp.token}`}}}));
 try{const status=await client.callTool({name:'get_sync_status',arguments:{}});assert.ok(!status.isError,JSON.stringify(status));assert.match(JSON.stringify(status),/partial|coverage/);const task=await client.callTool({name:'request_repository_sync',arguments:{}});assert.ok(!task.isError,JSON.stringify(task));}finally{await client.close();}
 assert.equal(remote.auth.accounts.get(account.id)!.github_id,null);assert.equal(remote.hosted.store.workspaceFor(account.id),primary);
 assert.equal(await remote.hosted.store.adapter(primary).read('diagrams/repository.strukt.json'),null);
 console.log('Joinlet GitHub worker smoke passed: pinned snapshots, source updates, one PR, batched commits and password account preservation.');
}finally{remote.drain();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));remote.auth.close();}
