import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRemoteApp } from './app';

const dir=await mkdtemp(join(tmpdir(),'joinlet-multiple-workspaces-'));
const options={deploymentMode:'cloud' as const,publicUrl:'http://127.0.0.1',databasePath:join(dir,'remote.sqlite'),encryptionKey:'4'.repeat(64)};
let remote=createRemoteApp(options);
const account=remote.auth.accounts.register('workspaces@example.test','synthetic')!;
const session=remote.auth.createWebSession(account.id);
const first=remote.hosted.store.workspaceFor(account.id);
await remote.hosted.store.adapter(first).write('docs/manual.md','# Preserve this document\n');
await remote.hosted.store.adapter(first).remove('context/ARCHITECTURE.md');
remote.hosted.store.createInvite(remote.hosted.store.access(session),{name:'Existing invitation',role:'edit',ttl:'never'});
const invitation=remote.hosted.store.invites(first,options.publicUrl)[0]!;
const revision=remote.hosted.store.revision(first);
remote.drain();remote.auth.close();
// Reproduce a database from the single-workspace release, including files, sessions and invitations.
const legacy=new Database(options.databasePath);
legacy.exec(`ALTER TABLE hosted_workspaces RENAME TO hosted_workspaces_new;
 CREATE TABLE hosted_workspaces(id TEXT PRIMARY KEY, owner INTEGER NOT NULL UNIQUE, created INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
 INSERT INTO hosted_workspaces SELECT id,owner,created,revision FROM hosted_workspaces_new;
 DROP TABLE hosted_workspaces_new;`);
legacy.close();
remote=createRemoteApp(options);
const server=remote.app.listen(0,'127.0.0.1');
await new Promise<void>(done=>server.once('listening',done));
const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const request=(path:string,body?:unknown,scope?:string,cookie=`joinlet_session=${session.token}`)=>fetch(base+path,{redirect:'manual',method:body===undefined?'GET':'POST',headers:{cookie,'content-type':'application/json','x-strukt-csrf':session.csrf,...(scope?{'x-joinlet-workspace':scope}:{})},body:body===undefined?undefined:JSON.stringify(body)});
try {
 assert.equal(remote.hosted.store.workspaceFor(account.id),first);
 assert.equal(remote.hosted.store.revision(first),revision);
 assert.equal((await request('/api/remote/session')).status,200);
 assert.match((await remote.hosted.store.adapter(first).read('context/ARCHITECTURE.md'))!,/Arquitetura/);
 const creation=await request('/api/remote/workspaces',{name:'Second project'});
 assert.equal(creation.status,201,await creation.clone().text());
 const second=(await creation.json() as {id:string}).id;
 assert.notEqual(first,second);
 const catalog=await (await request('/api/remote/workspaces',undefined,second)).json() as {activeId:string;workspaces:{id:string;name:string}[]};
 assert.equal(catalog.activeId,second);
 assert.deepEqual(catalog.workspaces.map(w=>w.id).sort(),[first,second].sort());
 const secondSession=await (await request('/api/remote/session?workspace='+encodeURIComponent(second))).json() as {repo:string;plan:{limits:{workspaces:number|null}}};
 assert.equal(secondSession.repo,second);
 assert.equal(remote.auth.beta.accountPlan(account.id).limits.workspaces,null);
 assert.equal(remote.hosted.store.workspaceFor(account.id),first);
 assert.equal(await remote.hosted.store.adapter(first).read('docs/manual.md'),'# Preserve this document\n');
 assert.equal(await remote.hosted.store.adapter(second).read('docs/manual.md'),null);
 assert.equal((await request('/api/remote/workspace',{repo:second,path:'docs/manual.md',text:'# Second\n',expected:null},second)).status,200);
 assert.equal(await remote.hosted.store.adapter(first).read('docs/manual.md'),'# Preserve this document\n');
 assert.equal((await request('/api/remote/workspace',{repo:first,path:'docs/manual.md',text:'wrong workspace',expected:'# Preserve this document\n'},second)).status,403);
 const other=remote.auth.accounts.register('other-workspaces@example.test','synthetic')!,otherSession=remote.auth.createWebSession(other.id);
 assert.equal((await request('/api/remote/session',undefined,second,`joinlet_session=${otherSession.token}`)).status,403);
 assert.equal((await fetch(base+'/api/remote/workspaces',{method:'POST',headers:{cookie:`joinlet_session=${session.token}`,'content-type':'application/json'},body:'{"name":"No CSRF"}'})).status,403);
 const joinResponse=await request(new URL(invitation.url).pathname);
 assert.equal(joinResponse.status,302);
 const guest=joinResponse.headers.getSetCookie().find(c=>c.startsWith('joinlet_guest='))!.split(';')[0]!;
 assert.equal((await request('/api/remote/session',undefined,undefined,guest)).status,200);
 assert.equal((await request('/api/remote/session',undefined,second,guest)).status,403);
 assert.equal((await request('/api/remote/workspaces',undefined,undefined,guest)).status,403);
 assert.equal(remote.hosted.store.invites(first,options.publicUrl)[0]!.url,invitation.url);
 const connectors=new Map<string,{id:string;token:string}>();
 for(const scope of [first,second]) {
   const pairing=await (await request('/api/connectors/pairing',{locale:'pt-BR'},scope)).json() as {code:string};
   const claim=await fetch(base+'/api/repository-connector/claim',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:pairing.code})});
   assert.equal(claim.status,200);
   connectors.set(scope,await claim.json() as {id:string;token:string});
 }
 const one=await (await request('/api/repositories',undefined,first)).json() as {connections:{id:string}[]};
 const two=await (await request('/api/repositories',undefined,second)).json() as {connections:{id:string}[]};
 assert.equal(one.connections.length,1);assert.equal(two.connections.length,1);assert.notEqual(one.connections[0]!.id,two.connections[0]!.id);
 assert.equal((await request(`/api/repositories/${one.connections[0]!.id}/pick`,{},second)).status,404);
 assert.equal((await request(`/api/repositories/${one.connections[0]!.id}/pick`,{},first)).status,202);
 for(const scope of [first,second]) {
   const polled=await fetch(base+'/api/repository-connector/poll',{method:'POST',headers:{authorization:`Bearer ${connectors.get(scope)!.token}`,'content-type':'application/json'},body:'{}'});
   const data=await polled.json() as {commands:{type:string}[]};assert.deepEqual(data.commands.map(c=>c.type),scope===first?['pick']:[]);
 }
 console.log('Joinlet multiple workspaces smoke passed: legacy migration, existing identity and invitations, scoped connections, isolated writes, CSRF and guest restrictions.');
} finally {
 remote.drain();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));remote.auth.close();await rm(dir,{recursive:true,force:true});
}
