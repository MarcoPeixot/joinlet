import assert from 'node:assert/strict';
import { createRemoteApp } from './app';
import { createMemoryAdapter, newWorkspace, workspaceFiles } from '@strukt/workspace';
import { RepositoryEngine } from '@strukt/workspace/repository';
import { digest } from '@strukt/workspace/repository-reader';
import { Database } from 'bun:sqlite';
import { repositoryQueue } from './repositoryQueue';

// Existing installations keep valid pairing codes when the language column is added.
const legacy=new Database(':memory:');
try {
  legacy.exec('CREATE TABLE repository_pairing(code TEXT PRIMARY KEY, owner INTEGER NOT NULL, workspace TEXT NOT NULL, expires INTEGER NOT NULL, version INTEGER NOT NULL)');
  legacy.query('INSERT INTO repository_pairing VALUES (?,?,?,?,?)').run('existing-code',1,'cloud:legacy',Date.now()+600000,1);
  repositoryQueue(legacy);repositoryQueue(legacy);
  assert.equal((legacy.query('SELECT locale FROM repository_pairing WHERE code=?').get('existing-code') as {locale:string}).locale,'en');
} finally { legacy.close(); }

const remote=createRemoteApp({publicUrl:'http://127.0.0.1',encryptionKey:'0'.repeat(64),databasePath:':memory:'});
const account=remote.auth.accounts.register('repository@example.test','synthetic-hash')!;
const session=remote.auth.createWebSession(account.id),other=remote.auth.createWebSession(remote.auth.accounts.register('other-repository@example.test','synthetic')!.id);
const server=remote.app.listen(0,'127.0.0.1');await new Promise<void>(done=>server.once('listening',done));const address=server.address() as {port:number},base=`http://127.0.0.1:${address.port}`;
async function request(path:string,body?:unknown,credentials=session,token?:string){return fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(token?{authorization:`Bearer ${token}`}:{cookie:`joinlet_session=${credentials.token}`,'x-strukt-csrf':credentials.csrf}),...(body!==undefined?{'content-type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});}
try{
  const pair=await(await request('/api/connectors/pairing',{})).json() as {code:string};assert.equal(pair.code.length,24);
  const claim=await(await request('/api/repository-connector/claim',{code:pair.code})).json() as {id:string;token:string};assert.ok(claim.token);
  assert.notEqual((await request('/api/repository-connector/claim',{code:pair.code})).status,200);
  const adapter=createMemoryAdapter();const result=await new RepositoryEngine({list:async()=>[{path:'src/api.ts',revision:'1'}],revision:async()=>'code-revision',read:async()=>'export const api=true;'},adapter).run();
  const update=await request('/api/repository-connector/update',{status:result.status,files:Object.fromEntries(adapter.files)},session,claim.token);assert.equal(update.status,200,await update.text());
  const list=await(await request('/api/repositories')).json() as {connections:{id:string;persistedRevision:string}[]};assert.equal(list.connections[0]!.persistedRevision,'code-revision');
  assert.notEqual((await request(`/api/repositories/${claim.id}`,undefined,other)).status,200);
  const poll=await request('/api/repository-connector/poll',{},session,'invalid-token');assert.notEqual(poll.status,200);
  const workspace=remote.hosted.store.workspaceFor(account.id),storage=remote.hosted.store.adapter(workspace);
  const prior=await storage.read('docs/repository-architecture.md');
  assert.equal((await request('/api/remote/workspace',{repo:workspace,path:'docs/repository-architecture.md',text:'# Edited in cloud\n',expected:prior})).status,200);
  const commands=await(await request('/api/repository-connector/poll',{},session,claim.token)).json() as {commands:{id:string;type:string;changes:{path:string;text:string}[]}[]};
  assert.equal(commands.commands.at(-1)!.type,'apply');assert.equal(commands.commands.at(-1)!.changes[0]!.text,'# Edited in cloud\n');
  const stale=await request('/api/repository-connector/update',{status:result.status,files:{'docs/repository-architecture.md':'# Stale local edit\n'}},session,claim.token);assert.notEqual(stale.status,200);assert.equal(await storage.read('docs/repository-architecture.md'),'# Edited in cloud\n');
  await request(`/api/repositories/${claim.id}/disconnect`,{});
  assert.notEqual((await request('/api/repository-connector/poll',{},session,claim.token)).status,200);
  console.log('Joinlet repository smoke passed: pairing, isolation, initialization, cloud outbox, conflicts and revocation.');
}finally{remote.drain();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));remote.auth.close();}
