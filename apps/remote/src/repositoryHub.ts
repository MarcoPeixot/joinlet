import { withAccessPlan, setRequestPlans } from '@strukt/workspace/access-context';
import { createStruktServer } from '@strukt/mcp';
import type { McpWorkspace } from '@strukt/mcp';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { applyRepositoryProposal, discardRepositoryProposal } from '../../server/src/repositoryReview';
import express from 'express';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { createMemoryAdapter, loadWorkspace, validEvidencePath, workspaceFiles } from '@strukt/workspace';
import { RepositoryEngine,readRepositoryConfig } from '@strukt/workspace/repository';
import { digest } from '@strukt/workspace/repository-reader';
import { writeBatch } from '@strukt/workspace/repository-transaction';
import { repositoryQueue } from './repositoryQueue';
import type { RepositoryConnection } from './repositoryQueue';
import { privateValues } from './secrets';
import { authToken, tokenHash } from './accounts';
import type { RemoteAuth, RemoteAuthOptions } from './auth';
import type { HostedBackend } from './hosted';
import { heldCookie } from './hosted';
import { hostedRepositoryAnalyzer } from './hostedAi';
import { githubApi, GithubHttpError, openGithubWorkspace } from './githubWorkspace';
import { githubSnapshot } from './repositorySnapshot';
import type { RepositoryStatus } from '@strukt/workspace/repository-contracts';
import { repositoryLocale } from '@strukt/workspace/repository-contracts';
import {repositorySourceContext,repositoryPolicy,scopedRepositoryReader} from '@strukt/workspace/repository-source-access';

const emptyStatus = (id: string): RepositoryStatus => ({ id, phase: 'queued', completed: 0, total: 0, analyzedRevision: null, persistedRevision: null, coverage: 'none', pending: [], proposals: [], metrics: { files: 0, reads: 0, aiCalls: 0, written: 0 } });
const publicConnection = (c: RepositoryConnection) => ({ ...JSON.parse(c.status), ...(c.kind==='local' && Date.now()-c.updated>15_000?{phase:'disconnected'}:{}), id: c.id, kind: c.kind, updated: c.updated, repo: c.kind === 'github' ? JSON.parse(c.data).repo : undefined, branch: c.kind === 'github' ? JSON.parse(c.data).branch : undefined });

/** Authenticated control plane. Connector tokens and GitHub credentials never enter workspace files. */
export function createRepositoryHub(options: RemoteAuthOptions, auth: RemoteAuth, hosted: HostedBackend) {
  const router=express.Router(), db=auth.database, queue=repositoryQueue(db), values=privateValues(options.encryptionKey), fetcher=options.fetch ?? fetch;
  const now=options.now ?? Date.now;
  const view=(c:RepositoryConnection)=>({...publicConnection(c),pendingWrites:c.kind==='local'?queue.commands(c.id).filter(command=>JSON.parse(command.data).type==='apply').length:queue.pending(c.id)});
  db.exec(`CREATE TABLE IF NOT EXISTS repository_credentials(owner INTEGER PRIMARY KEY,value TEXT NOT NULL,version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS repository_oauth(state TEXT PRIMARY KEY,owner INTEGER NOT NULL,session TEXT NOT NULL,expires INTEGER NOT NULL,workspace TEXT);
    CREATE TABLE IF NOT EXISTS repository_baseline(connection TEXT NOT NULL,path TEXT NOT NULL,text TEXT NOT NULL,PRIMARY KEY(connection,path));
    CREATE TABLE IF NOT EXISTS repository_archives(workspace TEXT PRIMARY KEY,files TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS repository_replies(id TEXT PRIMARY KEY,connection TEXT NOT NULL,value TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS repository_analysis_cache(key TEXT PRIMARY KEY,value TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS repository_webhooks(id TEXT PRIMARY KEY,created INTEGER NOT NULL);`);
  const oauthWorkspace=()=> (db.query('PRAGMA table_info(repository_oauth)').all() as {name:string}[]).some(c=>c.name==='workspace');
  if(!oauthWorkspace()){try{db.exec('ALTER TABLE repository_oauth ADD COLUMN workspace TEXT');}catch(error){if(!oauthWorkspace())throw error;}}
  const user=(req: express.Request) => {
    const session=auth.webSession(heldCookie(req.headers.cookie,'joinlet_session') ?? '');
    if (!session) throw Object.assign(Error('Sign in to connect a repository.'),{status:401});
    if (req.method!=='GET' && (req.header('x-strukt-csrf')!==session.csrf || req.header('sec-fetch-site')==='cross-site' || (req.header('origin') && req.header('origin')!==auth.publicUrl))) throw Object.assign(Error('Invalid repository session.'),{status:403});
    const plan=auth.beta.accountPlan(session.userId);setRequestPlans(plan,plan);
    const access=hosted.context(req.headers.cookie,req.header('x-joinlet-workspace') ?? (typeof req.query.workspace==='string'?req.query.workspace:undefined));
    if(!access?.owner)throw Object.assign(Error('Sign in to manage this workspace.'),{status:403});
    return {...session,workspace:access.workspace};
  };
  const owned=(req: express.Request) => { const session=user(req), c=queue.get(String(req.params.id)); if(!c || c.owner!==session.userId || c.workspace!==session.workspace) throw Object.assign(Error('Repository connection not found.'),{status:404}); return {session,c}; };
  const connector=(req: express.Request) => {
    const raw=req.header('authorization')?.replace(/^Bearer /,'') ?? '';
    if(raw.length<32) throw Object.assign(Error('Invalid connector authorization.'),{status:401});
    const c=queue.list().find(c=>c.kind==='local' && JSON.parse(c.data).token===tokenHash(raw));
    if(!c || auth.accounts.get(c.owner)?.session_version!==c.version) throw Object.assign(Error('Connector was disconnected.'),{status:401});
    const plan=auth.beta.accountPlan(c.owner);setRequestPlans(plan,plan);
    return c;
  };
  const analyzerFor=async(owner:number)=>{
    const analyzer=await hostedRepositoryAnalyzer(hosted.store,owner,fetcher);
    if(!analyzer)return undefined;
    const identity=digest(hosted.store.settings(owner)??'');
    return { identity, async analyze(input:Parameters<typeof analyzer.analyze>[0]) {
      const key=digest(`${owner}:${identity}:`+JSON.stringify({files:input.files,facts:input.facts}));
      const cached=db.query('SELECT value FROM repository_analysis_cache WHERE key=? AND created>?').get(key,now()-30*86400_000) as {value:string}|null;
      if(cached)return JSON.parse(values.open(cached.value,`repository-analysis:${owner}`));
      const result=await analyzer.analyze(input);
      db.query('INSERT OR REPLACE INTO repository_analysis_cache(key,value,created) VALUES (?,?,?)').run(key,values.seal(JSON.stringify(result),`repository-analysis:${owner}`),now());return result;
    } };
  };
  const tokenFor=async(owner:number) => {
    const row=db.query('SELECT value,version FROM repository_credentials WHERE owner=?').get(owner) as {value:string;version:number}|null;
    if(!row || row.version!==auth.accounts.get(owner)?.session_version) throw Error('Authorize GitHub again.');
    const credentials=JSON.parse(values.open(row.value,`repository-github:${owner}`));
    if(credentials.expires && credentials.expires<now()+60_000) {
      if(!credentials.refreshToken) throw Error('GitHub authorization expired.');
      const response=await fetcher('https://github.com/login/oauth/access_token',{method:'POST',headers:{accept:'application/json','content-type':'application/json'},body:JSON.stringify({client_id:options.githubClientId,client_secret:options.githubClientSecret,grant_type:'refresh_token',refresh_token:credentials.refreshToken})});
      const next=await response.json() as {access_token?:string;refresh_token?:string;expires_in?:number};
      if(!response.ok || !next.access_token) throw Error('GitHub authorization expired.');
      Object.assign(credentials,{token:next.access_token,refreshToken:next.refresh_token ?? credentials.refreshToken,expires:next.expires_in?now()+next.expires_in*1000:null});
      db.query('UPDATE repository_credentials SET value=? WHERE owner=?').run(values.seal(JSON.stringify(credentials),`repository-github:${owner}`),owner);
    }
    return credentials.token as string;
  };
  const snapshot=async(workspace:string) => {const storage=hosted.store.adapter(workspace);return Object.fromEntries(await Promise.all((await storage.list()).map(async path=>[path,await storage.read(path)] as const))) as Record<string,string>;};
  const archive=async(workspace:string) => {if(!db.query('SELECT 1 FROM repository_archives WHERE workspace=?').get(workspace)) db.query('INSERT INTO repository_archives(workspace,files) VALUES (?,?)').run(workspace,JSON.stringify(await snapshot(workspace)));};
  const protect=(handler:express.RequestHandler):express.RequestHandler => (req,res,next)=>Promise.resolve().then(()=>handler(req,res,next)).catch(error=>{if(!res.headersSent)res.status(Number.isInteger(error?.status)?error.status:400).json({error:'Joinlet could not complete this repository request. Check the connection and permissions.'});});

  router.get('/api/repositories',protect((req,res)=>{const session=user(req), workspace=session.workspace;res.json({connections:queue.list().filter(c=>c.owner===session.userId&&c.workspace===workspace).map(view),workspace,githubConfigured:!!options.githubClientId,githubConnected:!!db.query('SELECT 1 FROM repository_credentials WHERE owner=?').get(session.userId)});}));
  router.post('/api/repositories/github/authorize',protect((req,res)=>{
    const session=user(req); if(!options.githubClientId) throw Error('GitHub is not configured.');
    const state=authToken(); db.query('INSERT INTO repository_oauth(state,owner,session,expires,workspace) VALUES (?,?,?,?,?)').run(tokenHash(state),session.userId,tokenHash(heldCookie(req.headers.cookie,'joinlet_session')!),now()+600_000,session.workspace);
    const url=new URL('https://github.com/login/oauth/authorize');url.searchParams.set('client_id',options.githubClientId);url.searchParams.set('redirect_uri',`${auth.publicUrl}/github/callback`);url.searchParams.set('state',state);res.json({url:url.href});
  }));
  router.get('/github/callback',protect(async(req,res,next)=>{
    const state=typeof req.query.state==='string'?req.query.state:'';
    const flow=db.query('SELECT * FROM repository_oauth WHERE state=?').get(tokenHash(state)) as {owner:number;session:string;expires:number;workspace:string|null}|null;
    if(!flow)return next();
    const session=user(req);if(flow.owner!==session.userId || flow.expires<now() || flow.session!==tokenHash(heldCookie(req.headers.cookie,'joinlet_session')!))throw Error('Authorization expired.');
    db.query('DELETE FROM repository_oauth WHERE state=?').run(tokenHash(state));
    const response=await fetcher('https://github.com/login/oauth/access_token',{method:'POST',headers:{accept:'application/json','content-type':'application/json'},body:JSON.stringify({client_id:options.githubClientId,client_secret:options.githubClientSecret,code:req.query.code,redirect_uri:`${auth.publicUrl}/github/callback`})});
    const body=await response.json() as {access_token?:string;refresh_token?:string;expires_in?:number};
    if(!response.ok || !body.access_token) throw Error('GitHub refused authorization.');
    // This authorizes a repository provider; it does not create or merge Joinlet accounts.
    db.query('INSERT OR REPLACE INTO repository_credentials(owner,value,version) VALUES (?,?,?)').run(session.userId,values.seal(JSON.stringify({token:body.access_token,refreshToken:body.refresh_token,expires:body.expires_in?now()+body.expires_in*1000:null}),`repository-github:${session.userId}`),auth.accounts.get(session.userId)!.session_version);
    res.redirect((options.siteUrl?'/':'/app/')+'?workspace='+encodeURIComponent(flow.workspace??session.workspace));
  }));
  router.get('/api/repositories/github/repos',protect(async(req,res)=>{
    const session=user(req),api=githubApi(await tokenFor(session.userId),fetcher), repos:unknown[]=[];
    for(let page=1;page<=20;page++){const batch=await api<Array<{full_name:string;default_branch:string;permissions?:{push?:boolean}}>>(`/user/repos?per_page=100&page=${page}&sort=updated`);repos.push(...batch.filter(r=>r.permissions?.push).map(r=>({name:r.full_name,branch:r.default_branch})));if(batch.length<100)break;}
    res.json({repos});
  }));
  router.get('/api/repositories/github/branches',protect(async(req,res)=>{
    const session=user(req),repo=String(req.query.repo);if(!/^[\w.-]+\/[\w.-]+$/.test(repo))throw Error('Invalid repository.');
    const api=githubApi(await tokenFor(session.userId),fetcher),branches:unknown[]=[];
    for(let page=1;page<=20;page++){const batch=await api<Array<{name:string}>>(`/repos/${repo}/branches?per_page=100&page=${page}`);branches.push(...batch.map(b=>b.name));if(batch.length<100)break;}res.json({branches});
  }));
  router.post('/api/repositories/github',protect(async(req,res)=>{
    const session=user(req),repo=req.body?.repo,branch=req.body?.branch;
    if(typeof repo!=='string'||typeof branch!=='string'||!/^[\w.-]+\/[\w.-]+$/.test(repo)||repo.includes('..'))throw Error('Invalid repository.');
    const token=await tokenFor(session.userId),info=await githubApi(token,fetcher)<{id:number;permissions?:{push?:boolean}}>(`/repos/${repo}`);
    if(!info.permissions?.push)throw Error('Repository write access is required.');
    await githubSnapshot(token,repo,branch,fetcher);
    const workspace=session.workspace;if(queue.forWorkspace(workspace))throw Error('Disconnect the current repository first.');await archive(workspace);
    const id=crypto.randomUUID(), workBranch=`strukt/shared-${digest(`${info.id}:${branch}`).slice(0,10)}`;
    queue.put({id,owner:session.userId,workspace,kind:'github',data:JSON.stringify({repo,branch,workBranch,repoId:info.id,locale:repositoryLocale(req.body?.locale)}),status:JSON.stringify(emptyStatus(id)),updated:now(),version:auth.accounts.get(session.userId)!.session_version});queue.enqueue(id);res.status(202).json(view(queue.get(id)!));
  }));
  router.post('/api/connectors/pairing',protect((req,res)=>{
    const session=user(req),workspace=session.workspace;if(queue.forWorkspace(workspace))throw Error('Disconnect the current repository first.');
    const code=randomBytes(12).toString('hex').toUpperCase();db.query('DELETE FROM repository_pairing WHERE expires<? OR owner=?').run(now(),session.userId);db.query('INSERT INTO repository_pairing(code,owner,workspace,expires,version,locale) VALUES (?,?,?,?,?,?)').run(tokenHash(code),session.userId,workspace,now()+600_000,auth.accounts.get(session.userId)!.session_version,repositoryLocale(req.body?.locale));res.json({code,expires:now()+600_000});
  }));
  router.post('/api/repository-connector/claim',protect(async(req,res)=>{
    if(typeof req.body?.code!=='string'||req.body.code.length!==24)throw Error('Invalid pairing code.');
    const pair=db.query('DELETE FROM repository_pairing WHERE code=? AND expires>? RETURNING *').get(tokenHash(req.body.code.toUpperCase()),now()) as {owner:number;workspace:string;version:number;locale:string}|null;
    if(!pair||auth.accounts.get(pair.owner)?.session_version!==pair.version)throw Error('Pairing expired.');await archive(pair.workspace);
    const token=authToken(),id=crypto.randomUUID();queue.put({id,owner:pair.owner,workspace:pair.workspace,kind:'local',data:JSON.stringify({token:tokenHash(token)}),status:JSON.stringify({...emptyStatus(id),phase:'folder'}),updated:now(),version:pair.version});res.json({id,token,locale:repositoryLocale(pair.locale)});
  }));
  router.post('/api/repository-connector/poll',protect((req,res)=>{const c=connector(req);db.query('UPDATE repository_connections SET updated=? WHERE id=?').run(now(),c.id);res.json({id:c.id,analysisIdentity:digest(hosted.store.settings(c.owner)??''),commands:queue.commands(c.id).map(command=>({id:command.id,...JSON.parse(command.data)}))});}));
  router.post('/api/repository-connector/analyze',protect(async(req,res)=>{
    const c=connector(req), input=req.body;
    if(!Array.isArray(input.files)||JSON.stringify(input).length>150_000)throw Error('Analysis request is too large.');
    const analyzer=await analyzerFor(c.owner);if(!analyzer)return res.status(409).json({error:'Configure an AI provider for code analysis.'});
    res.json(await analyzer.analyze(input));
  }));
  router.post('/api/repository-connector/update',protect(async(req,res)=>{
    const c=connector(req),{status,files,ack}=req.body;
    const acknowledged=typeof ack==='string'?queue.commands(c.id).find(command=>command.id===ack):undefined;
    const acknowledgedChanges=acknowledged?JSON.parse(acknowledged.data).changes as {path:string;text:string|null}[]|undefined:undefined;
    if(!status || typeof status.phase!=='string')throw Error('Invalid connector status.');
    if(files){
      if(typeof files!=='object'||Array.isArray(files)||Object.keys(files).length>2000||JSON.stringify(files).length>20_000_000)throw Error('Invalid workspace snapshot.');
      const storage=hosted.store.adapter(c.workspace),previous=await snapshot(c.workspace);
      const baseline=Object.fromEntries((db.query('SELECT path,text FROM repository_baseline WHERE connection=?').all(c.id) as {path:string;text:string}[]).map(r=>[r.path,r.text]));
      const changes=[];
      for(const [path,text] of Object.entries(files)){
        if(!validEvidencePath(path)||(text!==null&&typeof text!=='string'))throw Error('Invalid workspace file.');
        // Cloud edits after the last acknowledged filesystem snapshot must not be overwritten.
        if(!path.startsWith('context/')&&Object.hasOwn(baseline,path)&&previous[path]!==baseline[path]&&previous[path]!==text){
          if(acknowledgedChanges?.some(change=>change.path===path&&change.text===text))continue;
          throw Error('Cloud and folder edits conflict.');
        }
        changes.push({path,text:text as string|null,expected:previous[path]??null});
      }
      await writeBatch(storage,changes);
      const save=db.transaction(()=>{for(const [path,text]of Object.entries(files)){if(text===null)db.query('DELETE FROM repository_baseline WHERE connection=? AND path=?').run(c.id,path);else db.query('INSERT OR REPLACE INTO repository_baseline(connection,path,text) VALUES (?,?,?)').run(c.id,path,text as string);}});save();
    }
    queue.update(c.id,{...status,id:c.id,root:undefined});if(typeof ack==='string')queue.ack(c.id,ack);notify(c.workspace,Object.keys(files??{}));res.json({ok:true});
  }));
  router.post('/api/repository-connector/reply',protect((req,res)=>{
    const c=connector(req),id=req.body?.id;
    if(typeof id!=='string'||!queue.commands(c.id).some(command=>command.id===id))throw Error('Unknown connector request.');
    db.query('INSERT OR REPLACE INTO repository_replies(id,connection,value,created) VALUES (?,?,?,?)').run(id,c.id,values.seal(JSON.stringify(req.body.result),`repository-reply:${c.id}`),now());queue.ack(c.id,id);res.json({ok:true});
  }));
  const askConnector=async(c:RepositoryConnection,type:string,extra:Record<string,unknown>={})=>{
    const id=queue.command(c.id,{type,...extra}),deadline=Date.now()+120_000;
    try { while(Date.now()<deadline) { if(!queue.get(c.id))throw Error('Connector was disconnected.'); const row=db.query('SELECT value FROM repository_replies WHERE id=? AND connection=?').get(id,c.id) as {value:string}|null;if(row)return JSON.parse(values.open(row.value,`repository-reply:${c.id}`));await new Promise(done=>setTimeout(done,150)); } throw Error('Connector did not respond.'); }
    finally {db.query('DELETE FROM repository_replies WHERE id=? AND connection=?').run(id,c.id);queue.ack(c.id,id);}
  };
  router.post('/api/repositories/:id/mcp',protect((req,res)=>{
    const {c}=owned(req),token=authToken();db.query('UPDATE repository_connections SET data=? WHERE id=?').run(JSON.stringify({...JSON.parse(c.data),mcp:tokenHash(token)}),c.id);res.json({url:`${auth.publicUrl}/mcp/repositories/${c.id}`,token});
  }));
  router.use('/mcp/repositories/:id',(req,res,next)=>{res.set({'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, GET, OPTIONS','Access-Control-Allow-Headers':'authorization, content-type, mcp-protocol-version, mcp-session-id','Access-Control-Expose-Headers':'mcp-session-id'});if(req.method==='OPTIONS')return res.sendStatus(204);next();});
  router.all('/mcp/repositories/:id',protect(async(req,res)=>{
    const c=queue.get(String(req.params.id)),token=req.header('authorization')?.replace(/^Bearer /,'')??'';
    if(!c || token.length<32 || JSON.parse(c.data).mcp!==tokenHash(token) || auth.accounts.get(c.owner)?.session_version!==c.version)return res.status(401).set('WWW-Authenticate','Bearer').json({error:'Authorize this repository MCP session.'});
    const plan=auth.beta.accountPlan(c.owner);setRequestPlans(plan,plan);
    const adapter=hosted.store.adapter(c.workspace),loaded=await loadWorkspace(adapter);if(!loaded)return res.sendStatus(409);
    const disk=Object.fromEntries(await Promise.all(Object.keys(workspaceFiles(loaded.data)).map(async path=>[path,await adapter.read(path)] as const)));
    const ws:McpWorkspace={root:`repository:${c.id}`,archDir:c.workspace,adapter,data:loaded.data,warnings:loaded.warnings,disk,
      requestRepositorySync:async()=>{if(c.kind==='local')queue.command(c.id,{type:'sync'});else queue.enqueue(c.id);return view(queue.get(c.id)!);},
      onSaved:async paths=>{for(const path of paths)hosted.notify(c.workspace,path);},
    };
    if(c.kind==='github'){const data=JSON.parse(c.data);ws.repositoryReader=scopedRepositoryReader(await githubSnapshot(await tokenFor(c.owner),data.repo,data.branch,fetcher),readRepositoryConfig(await adapter.read('repository.json')));ws.repositoryAnalyzer=await analyzerFor(c.owner);}
    else {ws.inspectRepository=()=>askConnector(c,'inspect');ws.listRepositoryFiles=options=>askConnector(c,'source_list',{options});ws.readRepositorySource=(path,start,count,revision)=>askConnector(c,'source_page',{path,start,count,revision});ws.repositoryReader={read:path=>askConnector(c,'source_read',{path}),revision:async()=>JSON.parse(queue.get(c.id)?.status??'{}').analyzedRevision??'pending',list:async()=>{throw Error('Use list_repository_files to inspect this local connector.');}};}
    const server=createStruktServer(ws,{githubTools:false}),transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    await server.connect(transport);res.on('close',()=>{void transport.close();void server.close();});await transport.handleRequest(req,res,req.body);
  }));
  router.get('/api/repositories/:id/events',protect((req,res)=>{
    const {session,c}=owned(req);res.type('text/event-stream').set('Cache-Control','no-store').set('X-Accel-Buffering','no');let last='';
    const send=()=>{if(!auth.webSession(heldCookie(req.headers.cookie,'joinlet_session')??'')){res.end();return;}const current=queue.get(c.id);if(!current){res.end();return;}const text=JSON.stringify(view(current));if(text!==last){last=text;res.write(`event: status\ndata: ${text}\n\n`);}};
    send();const timer=setInterval(send,1000);req.on('close',()=>clearInterval(timer));
  }));
  router.get('/api/repositories/:id',protect((req,res)=>{res.json(view(owned(req).c));}));
  for(const kind of ['context','revision'] as const)router.get('/api/repositories/:id/'+kind,protect(async(req,res)=>{
    const {c}=owned(req);
    if(c.kind==='local'){const result=await askConnector(c,kind==='context'?'source_context':'source_revision');if(result?.error)return res.status(409).json(result);return res.json(result);}
    const data=JSON.parse(c.data),token=await tokenFor(c.owner),config=readRepositoryConfig(await hosted.store.adapter(c.workspace).read('repository.json'));
    if(kind==='revision'){const current=await githubApi(token,fetcher)<{object:{sha:string}}>(`/repos/${data.repo}/git/ref/heads/${encodeURIComponent(data.branch)}`);return res.json({revision:current.object.sha,policy:repositoryPolicy(config)});}
    const reader=scopedRepositoryReader(await githubSnapshot(token,data.repo,data.branch,fetcher),config);
    res.json(await repositorySourceContext(reader));
  }));
  router.post('/api/repositories/:id/sync',protect((req,res)=>{const {c}=owned(req);if(c.kind==='local')queue.command(c.id,{type:'sync'});else queue.enqueue(c.id);res.status(202).json(view(c));}));
  router.post('/api/repositories/:id/pick',protect((req,res)=>{const {c}=owned(req);if(c.kind!=='local')throw Error('Choose a local connection.');queue.command(c.id,{type:'pick'});res.status(202).json({ok:true});}));
  router.post('/api/repositories/:id/proposals/:proposal',protect(async(req,res)=>{
    const {c}=owned(req),status=JSON.parse(c.status) as RepositoryStatus,proposal=status.proposals.find(p=>p.id===req.params.proposal);
    if(!proposal)throw Error('Proposal not found.');
    if(req.body.action==='apply') {
      if(c.kind==='local')queue.command(c.id,{type:'review',proposal:proposal.id,action:'apply'});
      else {const data=JSON.parse(c.data),reader=await githubSnapshot(await tokenFor(c.owner),data.repo,data.branch,fetcher);await applyRepositoryProposal(hosted.store.adapter(c.workspace),reader,proposal);queue.enqueue(c.id);}
    }else if(req.body.action==='dismiss'){if(c.kind==='local')queue.command(c.id,{type:'review',proposal:proposal.id,action:'dismiss'});else {await discardRepositoryProposal(hosted.store.adapter(c.workspace),proposal.id);queue.enqueue(c.id);}}else throw Error('Invalid review action.');
    queue.update(c.id,{proposals:status.proposals.filter(p=>p.id!==proposal.id)});res.json(view(queue.get(c.id)!));
  }));
  router.post('/api/repositories/:id/disconnect',protect((req,res)=>{const {c}=owned(req);queue.remove(c.id);db.query('DELETE FROM repository_baseline WHERE connection=?').run(c.id);db.query('DELETE FROM repository_replies WHERE connection=?').run(c.id);res.json({ok:true});}));
  router.get('/api/repositories/:id/archive',protect((req,res)=>{const {c}=owned(req),row=db.query('SELECT files FROM repository_archives WHERE workspace=?').get(c.workspace) as {files:string}|null;res.json({files:row?JSON.parse(row.files):{}});}));
  router.post('/api/repositories/webhook',protect((req,res)=>{
    if(!options.repositoryWebhookSecret || !Buffer.isBuffer(req.body))throw Error('Webhook is unavailable.');
    const supplied=req.header('x-hub-signature-256')??'', expected='sha256='+createHmac('sha256',options.repositoryWebhookSecret).update(req.body).digest('hex');
    if(supplied.length!==expected.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return res.sendStatus(403);
    const delivery=req.header('x-github-delivery');if(!delivery||delivery.length>200)throw Error('Invalid webhook delivery.');
    if(db.query('SELECT 1 FROM repository_webhooks WHERE id=?').get(delivery))return res.json({ok:true});
    const body=JSON.parse(req.body.toString('utf8'));db.query('INSERT INTO repository_webhooks(id,created) VALUES (?,?)').run(delivery,now());
    for(const c of queue.list())if(c.kind==='github'){const data=JSON.parse(c.data);if(data.repoId===body.repository?.id && (body.ref===`refs/heads/${data.branch}`||body.pull_request?.head?.ref===data.branch))queue.enqueue(c.id);}res.json({ok:true});
  }));

  let stopping=false, activeJobs=0;
  let projecting=false;
  const notify = (workspace: string,paths:string[]=['strukt.json']) => { projecting=true; try { for(const path of paths)hosted.notify(workspace,path); } finally { projecting=false; } };
  async function runNext() {
    if(stopping || activeJobs>=2)return false;
    const job=queue.claim();if(!job)return false;
    const c=queue.get(job.connection);if(!c)return false; activeJobs++;
    const renew=setInterval(()=>queue.renew(job.id),60_000);renew.unref();
    try{
      if(auth.accounts.get(c.owner)?.session_version!==c.version)throw Error('Repository authorization was revoked.');
      const data=JSON.parse(c.data),token=await tokenFor(c.owner),api=githubApi(token,fetcher);
      const source=await githubSnapshot(token,data.repo,data.branch,fetcher);
      const refPath=`/repos/${data.repo}/git/ref/heads/${encodeURIComponent(data.workBranch)}`;
      try{await api(refPath);const response=await fetcher(`https://api.github.com/repos/${data.repo}/merges`,{method:'POST',headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json','content-type':'application/json'},body:JSON.stringify({base:data.workBranch,head:source.sha,commit_message:'chore(arch): follows source revision'})});if(!response.ok&&response.status!==204)throw Error('Source and architecture branches conflict.');}catch(error){if(!(error instanceof GithubHttpError&&error.status===404))throw error;}
      const target=await openGithubWorkspace({token,repo:data.repo,userId:0,baseBranch:data.branch,workBranch:data.workBranch,fetch:fetcher,beforeCommit:async()=>{if(!queue.get(c.id))throw Error('Repository disconnected before publication.');const current=await api<{object:{sha:string}}>(`/repos/${data.repo}/git/ref/heads/${encodeURIComponent(data.branch)}`);if(current.object.sha!==source.sha)throw Error('Source revision changed during analysis.');if(auth.accounts.get(c.owner)?.session_version!==c.version)throw Error('Authorization revoked.');}});
      const remoteFiles=Object.fromEntries(await Promise.all((await target.list()).map(async path=>[path,await target.read(path)] as const))) as Record<string,string>;
      const storage=hosted.store.adapter(c.workspace), cloud=await snapshot(c.workspace), baseline=Object.fromEntries((db.query('SELECT path,text FROM repository_baseline WHERE connection=?').all(c.id) as {path:string;text:string}[]).map(r=>[r.path,r.text]));
      if(Object.keys(baseline).length)for(const path of new Set([...Object.keys(cloud),...Object.keys(baseline)]))if(cloud[path]!==baseline[path]){
        if(remoteFiles[path]!==baseline[path]&&remoteFiles[path]!==cloud[path])throw Error('Concurrent GitHub and editor changes require review.');
        if(cloud[path]===undefined)delete remoteFiles[path];else remoteFiles[path]=cloud[path]!;
      }
      const adapter=createMemoryAdapter(remoteFiles), analyzer=await analyzerFor(c.owner);
      const result=await withAccessPlan(auth.beta.accountPlan(c.owner),()=>new RepositoryEngine(source,adapter,analyzer).run({name:data.repo.split('/')[1],locale:repositoryLocale(data.locale),progress:s=>queue.update(c.id,s)}));
      const instructions=target.syncAgentInstructions();
      if(instructions.conflicts.length){result.status.pending.push('Agent instructions need review: '+instructions.conflicts.join(', '));result.status.phase='review';}
      const latest=await snapshot(c.workspace);if(JSON.stringify(latest)!==JSON.stringify(cloud))throw Error('Editor changed during analysis. Retry against the new revision.');
      const files=Object.fromEntries([...adapter.files]);
      for(const [path,text] of Object.entries(files))await target.write(path,text);
      for(const path of await target.list())if(!Object.hasOwn(files,path))await target.remove(path);
      const pullRequest=await target.flush();
      if(!queue.get(c.id))throw Error('Repository was disconnected during synchronization.');
      const mutations=[...new Set([...Object.keys(files),...Object.keys(cloud)])].filter(path=>files[path]!==cloud[path]).map(path=>({path,text:files[path]??null,expected:cloud[path]??null}));
      await withAccessPlan(auth.beta.accountPlan(c.owner),()=>writeBatch(storage,mutations));
      db.transaction(()=>{db.query('DELETE FROM repository_baseline WHERE connection=?').run(c.id);for(const [path,text]of Object.entries(files))db.query('INSERT INTO repository_baseline(connection,path,text) VALUES (?,?,?)').run(c.id,path,text);})();
      queue.update(c.id,{...result.status,id:c.id,persistedRevision:target.commit});
      db.query('UPDATE repository_connections SET data=? WHERE id=?').run(JSON.stringify({...JSON.parse(queue.get(c.id)!.data),workBranch:target.branch,pullRequest,failures:0}),c.id);
      notify(c.workspace,mutations.map(change=>change.path));queue.finish(job.id,'done');
    }catch(error){const current=queue.get(c.id);if(current){const data=JSON.parse(current.data);db.query('UPDATE repository_connections SET data=? WHERE id=?').run(JSON.stringify({...data,failures:(data.failures??0)+1}),c.id);}queue.update(c.id,{phase:/conflict|changed/i.test(String(error))?'conflict':'paused',error:error instanceof Error?error.message:'Repository analysis failed.'});queue.finish(job.id,'failed');}
    finally{clearInterval(renew);activeJobs--;}return true;
  }
  let lastReconcile=0;
  const tick=async()=>{if(now()-lastReconcile>60_000){lastReconcile=now();for(const c of queue.list())if(c.kind==='github'&&JSON.parse(c.status).phase!=='conflict'&&(JSON.parse(c.data).failures??0)<3){ try {const data=JSON.parse(c.data),token=await tokenFor(c.owner),ref=await githubApi(token,fetcher)<{object:{sha:string}}>(`/repos/${data.repo}/git/ref/heads/${encodeURIComponent(data.branch)}`);if(ref.object.sha!==JSON.parse(c.status).analyzedRevision)queue.enqueue(c.id);} catch {queue.update(c.id,{phase:'paused',error:'Repository authorization or network is unavailable.'});} }}await runNext();};
  const timer=options.repositoryWorker?setInterval(()=>void tick().catch(()=>{}),1000):undefined;timer?.unref();
  return {router,queue,runNext,close(){stopping=true;clearInterval(timer);},async drained(){while(activeJobs)await new Promise(done=>setTimeout(done,100));},changed(workspace:string,path:string){if(projecting)return;const c=queue.forWorkspace(workspace);if(!c||path.startsWith('context/'))return;if(c.kind==='github')queue.enqueue(c.id);else void (async()=>{const storage=hosted.store.adapter(workspace);const baseline=db.query('SELECT text FROM repository_baseline WHERE connection=? AND path=?').get(c.id,path) as {text:string}|null;const prior=queue.commands(c.id).flatMap(command=>{const data=JSON.parse(command.data);return data.type==='apply'?(data.changes as {path:string;text:string|null}[]):[];}).filter(change=>change.path===path).at(-1);queue.command(c.id,{type:'apply',changes:[{path,text:await storage.read(path),expected:prior?prior.text:baseline?.text??null}]});})().catch(()=>queue.update(c.id,{phase:'error'}));}};
}
