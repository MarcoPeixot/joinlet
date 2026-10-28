import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory=await mkdtemp(join(tmpdir(),'joinlet-startup-'));
const root=new URL('../../../',import.meta.url).pathname;
type Running={child:ReturnType<typeof spawn>;output:()=>string;exit:Promise<number|null>};
async function freePort(){const server=createServer();await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const port=(server.address() as {port:number}).port;await new Promise<void>(done=>server.close(()=>done()));return port;}
function start(entry:string,env:NodeJS.ProcessEnv):Running {
 const child=spawn(process.execPath,[root+entry],{cwd:directory,env,stdio:['ignore','pipe','pipe']});let output='';
 for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>{output=(output+String(chunk)).slice(-12000);});
 const exit=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 return {child,output:()=>output,exit};
}
async function stop(process:Running){if(process.child.exitCode!==null)return;process.child.kill('SIGTERM');const deadline=setTimeout(()=>process.child.kill('SIGKILL'),5000);try{assert.equal(await process.exit,0,process.output());}finally{clearTimeout(deadline);}}
async function ready(api:Running,worker:Running,origin:string){
 const deadline=Date.now()+15000;
 while(Date.now()<deadline){
  assert.equal(api.child.exitCode,null,api.output());assert.equal(worker.child.exitCode,null,worker.output());
  try{if(worker.output().includes('worker started')&&(await fetch(origin+'/ready')).ok)return;}catch{}
  await new Promise(done=>setTimeout(done,30));
 }
 throw Error('Concurrent startup did not become ready: '+api.output()+worker.output());
}
try{
 for(let round=0;round<3;round++){
  const port=await freePort(),origin=`http://127.0.0.1:${port}`;
  const env={...process.env,NODE_ENV:'test',PORT:String(port),STRUKT_PUBLIC_URL:origin,JOINLET_SITE_URL:'',STRUKT_REMOTE_DB:join(directory,`runtime-${round}.sqlite`),STRUKT_REMOTE_ENCRYPTION_KEY:'4'.repeat(64),JOINLET_REPOSITORY_WORKER:'0',JOINLET_DEPLOYMENT_MODE:'cloud',STRUKT_GITHUB_APP_CLIENT_ID:'',STRUKT_GITHUB_APP_CLIENT_SECRET:'',JOINLET_ACCOUNT_DIRECTORY_TOKEN:'',JOINLET_ANALYTICS_PATH:''};
  let api=start('apps/remote/src/main.ts',env),worker=start('apps/remote/src/repositoryWorker.ts',env);
  try{
   await ready(api,worker,origin);
   const body={email:'startup@example.test',password:'synthetic test password!'},headers={'content-type':'application/json',origin};
   assert.equal((await fetch(origin+'/api/auth/register',{method:'POST',headers,body:JSON.stringify(body)})).status,200);
   const login=await fetch(origin+'/api/auth/login',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(login.status,200);
   const cookie=login.headers.getSetCookie().find(value=>value.startsWith('joinlet_session='))!.split(';')[0]!;
   const session=await(await fetch(origin+'/api/remote/session',{headers:{cookie}})).json() as {repo:string};assert.ok(session.repo);
   await Promise.all([stop(api),stop(worker)]);
   api=start('apps/remote/src/main.ts',env);worker=start('apps/remote/src/repositoryWorker.ts',env);await ready(api,worker,origin);
   const reopened=await fetch(origin+'/api/remote/session',{headers:{cookie}});assert.equal(reopened.status,200);assert.equal(((await reopened.json()) as {repo:string}).repo,session.repo);
  }finally{await Promise.all([stop(api),stop(worker)]);}
 }
 console.log('Joinlet concurrent startup smoke passed: API and worker, fresh database, real password login and persisted session across restarts.');
}finally{await rm(directory,{recursive:true,force:true});}
