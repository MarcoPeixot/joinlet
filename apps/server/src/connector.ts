import { serve, file } from 'bun';
import { watch } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { createRepositoryService, chooseRepositoryFolder } from './repositories';
import { localRepositoryAi } from './localRepositoryAi';
import { createFsAdapter } from '@strukt/workspace/fs';
import { writeBatch } from '@strukt/workspace/repository-transaction';
import type { RepositoryAnalyzer, RepositoryStatus } from '@strukt/workspace/repository-contracts';
import { RepositoryProviderNotConfigured, repositoryLocale } from '@strukt/workspace/repository-contracts';
import { loadConnectorCredentials, saveConnectorCredentials, type ConnectorCredentials } from './connectorCredentials';

interface Io { out(text: string): void; err(text: string): void }
export async function connectLocal(options: { dir?: string; cloud?: string; pair?: string; io: Io }) {
  const { settings, analyzer }=await localRepositoryAi();
  if(options.cloud) return connectCloud(options.cloud,options.pair,options.dir??null,options.io);
  const directory=options.dir ?? await chooseRepositoryFolder();
  let root:string|null=null;
  const origins: string[] = [];
  const app=createApp({settings,allowedOrigins:origins,selectedRepo:{get:()=>root,set:async value=>{root=value;}}});
  const dist=process.env.JOINLET_WEB_DIST || (/joinlet(?:\.exe)?$/.test(process.execPath)?join(dirname(process.execPath),'web'):fileURLToPath(new URL('../../web/dist/',import.meta.url)));
  const server=serve({hostname:'127.0.0.1',port:0,fetch:async request=>{
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/mcp'))return app.fetch(request);
    const path=resolve(dist,'.'+(url.pathname==='/'||url.pathname==='/app/'?'/app/index.html':url.pathname));
    if(!path.startsWith(resolve(dist)+sep))return new Response('Not found',{status:404});
    const asset=file(path);return await asset.exists()?new Response(asset):new Response('Build the Joinlet editor with bun run build.',{status:404});
  }});
  const origin=`http://127.0.0.1:${server.port}`;
  origins.push(origin, `http://localhost:${server.port}`);
  let connection: string | undefined;
  if(directory){
    const response=await app.request('/api/repositories',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({dir:directory,locale:repositoryLocale(Intl.DateTimeFormat().resolvedOptions().locale)})});
    const job=await response.json() as {id:string;error?:string};
    if(!response.ok)throw Error(job.error);
    connection=job.id;
    options.io.out(`Joinlet preparing repository: ${job.id}`);
  }
  const editorUrl=`${origin}/app/${connection?'?connection='+encodeURIComponent(connection):''}`;
  options.io.out(`Joinlet editor: ${editorUrl}`);
  const cmd=process.platform==='darwin'?'open':process.platform==='win32'?'explorer':'xdg-open';
  void import('@strukt/workspace/repository-reader').then(({command})=>command(cmd,[editorUrl],process.cwd()));
  await new Promise<void>(done=>{const stop=()=>{server.stop(true);done();};process.once('SIGINT',stop);process.once('SIGTERM',stop);});
}

async function connectCloud(cloud:string,pair:string|undefined,directory:string|null,io:Io) {
  const origin=new URL(cloud);
  if(origin.origin!==cloud.replace(/\/$/,'')|| (origin.protocol!=='https:' && !(process.env.NODE_ENV!=='production'&&origin.protocol==='http:'&&['localhost','127.0.0.1'].includes(origin.hostname))))throw Error('Choose an HTTPS Joinlet origin.');
  let credentials:ConnectorCredentials;
  if(pair){
    const claim=await fetch(`${origin.origin}/api/repository-connector/claim`,{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({code:pair})});
    if(!claim.ok)throw Error('Pairing was refused or expired.'); credentials=await claim.json();
  }else{
    credentials=await loadConnectorCredentials(origin.origin,directory);
  }
  const saveCredentials=()=>saveConnectorCredentials(origin.origin,credentials);
  await saveCredentials();
  directory=directory??credentials.root??await chooseRepositoryFolder();
  let stopped=false, current:string|null=null, lastStatus:RepositoryStatus|null=null, archStop:(()=>void)|undefined;
  const post=async(path:string,body:unknown)=>{
    const response=await fetch(origin.origin+path,{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:`Bearer ${credentials.token}`},body:JSON.stringify(body),signal:AbortSignal.timeout(240_000)});
    if(response.status===401||response.status===403){stopped=true;throw Error('Connector authorization was revoked.');}
    if(response.status===409 && path==='/api/repository-connector/analyze')throw new RepositoryProviderNotConfigured();
    if(!response.ok)throw Error(`Joinlet connector request failed (${response.status}).`);
    return response.json();
  };
  const analyzer:RepositoryAnalyzer={analyze:input=>post('/api/repository-connector/analyze',input)};
  const service=createRepositoryService(()=>analyzer), uploaded=new Map<string,string>();
  let uploading:Promise<void>=Promise.resolve();
  const upload=(ack?:string)=>{
    uploading=uploading.catch(()=>{}).then(async()=>{
      if(!current||!lastStatus)return;
      const storage=createFsAdapter(join(current,'.arch')),files:Record<string,string|null>={};
      const stable=lastStatus.persistedRevision && ['ready','review','paused'].includes(lastStatus.phase);
      const paths=stable?await storage.list():[];
      for(const path of paths){const text=await storage.read(path);if(text!==null&&uploaded.get(path)!==text)files[path]=text;}
      if(stable)for(const path of uploaded.keys())if(!paths.includes(path))files[path]=null;
      await post('/api/repository-connector/update',{status:lastStatus,files,ack});
      for(const[path,text]of Object.entries(files)){if(text===null)uploaded.delete(path);else uploaded.set(path,text);}
    });
    return uploading;
  };
  let uploadTimer:ReturnType<typeof setTimeout>|undefined;
  const scheduleUpload=()=>{if(!uploadTimer)uploadTimer=setTimeout(()=>{uploadTimer=undefined;void upload().catch(error=>io.err(String(error)));},250);};
  const select=async(dir:string)=>{
    if(current)for(const job of service.list())service.disconnect(job.id);
    archStop?.();uploaded.clear();current=resolve(dir);credentials.root=current;await saveCredentials();
    const job=await service.connect(current,repositoryLocale(credentials.locale ?? Intl.DateTimeFormat().resolvedOptions().locale));
    service.subscribe(job.id,status=>{lastStatus=status;scheduleUpload();});
    let timer:ReturnType<typeof setTimeout>;
    const watcher=watch(current,{recursive:true},(_event,path)=>{if(String(path??'').replaceAll('\\','/').startsWith('.arch/')){clearTimeout(timer);timer=setTimeout(()=>void upload().catch(error=>io.err(String(error))),1000);}});
    archStop=()=>{watcher.close();clearTimeout(timer);};
  };
  if(directory)await select(directory);
  io.out(`Joinlet connector paired with ${origin.origin}. Keep this process running.`);
  const stop=()=>{stopped=true;clearTimeout(uploadTimer);service.close();archStop?.();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    while(!stopped){
      try{
        const result=await post('/api/repository-connector/poll',{}) as {analysisIdentity?:string;commands:Array<{id:string;type:string;proposal?:string;action?:string;path?:string;options?:{prefix?:string;offset?:number;limit?:number};start?:number;count?:number;revision?:string;changes?:{path:string;text:string|null;expected:string|null}[]}>};
        if(result.analysisIdentity)analyzer.identity=result.analysisIdentity;
        for(const command of result.commands){
          if(['source_context','source_revision','source_list','source_page'].includes(command.type)){
            const job=service.list()[0];let result:unknown;
            try{if(!job)throw Error('Choose a folder first.');result=command.type==='source_context'?await service.sourceContext(job.id):command.type==='source_revision'?await service.sourceRevision(job.id):command.type==='source_list'?await service.sourceList(job.id,command.options??{}):await service.sourcePage(job.id,command.path??'',command.start,command.count,command.revision);}catch(error){result={error:String(error)};}
            await post('/api/repository-connector/reply',{id:command.id,result});continue;
          }
          if(command.type==='source_read'){const job=service.list()[0];await post('/api/repository-connector/reply',{id:command.id,result:job&&command.path?await service.readSource(job.id,command.path):null});continue;}
          if(command.type==='inspect'){const job=service.list()[0];await post('/api/repository-connector/reply',{id:command.id,result:job?await service.inspect(job.id):{error:'Choose a folder first.'}});continue;}
          if(command.type==='pick'){const path=await chooseRepositoryFolder();if(path)await select(path);}
          else if(command.type==='review'&&command.proposal){const job=service.list()[0];if(job)await service.review(job.id,command.proposal,command.action??'apply');}
          else if(command.type==='sync'){const job=service.list()[0];if(job)service.sync(job.id);}
          else if(command.type==='apply'&&current&&command.changes){const storage=createFsAdapter(join(current,'.arch'));const changes=[];for(const change of command.changes)if(await storage.read(change.path)!==change.text)changes.push(change);await writeBatch(storage,changes);}
          if(current&&lastStatus)await upload(command.id);
          else await post('/api/repository-connector/update',{status:lastStatus??{phase:'folder'},ack:command.id});
        }
      }catch(error){io.err(String(error));}
      if(!stopped)await new Promise<void>(done=>setTimeout(done,1000));
    }
  }finally{stop();}
}
