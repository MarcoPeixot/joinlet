import {repositoryMessage} from './repositoryMessages';
import { useEffect, useState, useRef } from 'react';
import { zipFiles } from '@strukt/workspace/zip';
import { downloadBlob } from '../export/png';
import { FolderOpen, GitBranch, LoaderCircle, RefreshCw } from 'lucide-react';
import type { RepositoryStatus } from '@strukt/workspace/repository-contracts';
import { getLocale, uiText } from '../i18n';
import { Button } from '../ui/Button';
import { CopyCode } from '../ui/CopyCode';
import { inputClass } from '../ui/controls';
import { requestAuthHeaders } from '../workspace/requestAuth';
import { openConnectedRepository, openFolderPicker } from '../workspace/boot';
import { canPickFolder } from '../workspace/folder';

const PHASE: Record<string,string> = { queued:'Aguardando análise',folder:'Escolha a pasta no computador',git:'Verificando Git',files:'Lendo arquivos',architecture:'Analisando arquitetura',sync:'Gravando arquitetura',ready:'Arquitetura atualizada',review:'Revisão necessária',paused:'Análise pendente',conflict:'Conflito encontrado',disconnected:'Conector desconectado',error:'Não foi possível sincronizar' };
type Connection = RepositoryStatus & {kind?:'local'|'github';repo?:string;branch?:string;updated?:number;pendingWrites?:number};
export function RepositoryConnection({ cloud = false }: { cloud?: boolean }) {
  const [connections,setConnections]=useState<Connection[]>([]),[available,setAvailable]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[path,setPath]=useState(''),[pair,setPair]=useState<string|null>(null),[repos,setRepos]=useState<{name:string;branch:string}[]>([]),[repo,setRepo]=useState(''),[branch,setBranch]=useState(''),[branches,setBranches]=useState<string[]>([]);
  const [instructions,setInstructions]=useState(false),[mcp,setMcp]=useState<{url:string;token?:string}|null>(null);
  const pendingOpen=useRef<string|null>(null);
  const request=async(path:string,body?:unknown)=>{const response=await fetch(path,body===undefined?{headers:requestAuthHeaders()}:{method:'POST',headers:{'content-type':'application/json',...requestAuthHeaders()},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Error(data.error??uiText('Não foi possível conectar o repositório.'));return data;};
  useEffect(()=>{let active=true;const poll=async()=>{try{const data=await request('/api/repositories');if(active){setAvailable(true);setConnections(data.connections);}}catch{if(active)setAvailable(false);}};void poll();const timer=setInterval(()=>void poll(),1500);return()=>{active=false;clearInterval(timer);};},[]);
  const run=async(work:()=>Promise<void>)=>{setBusy(true);setError(null);try{await work();}catch(error){setError(String(error instanceof Error?error.message:error));}finally{setBusy(false);}};
  const connect=async(dir:string)=>{const job=await request('/api/repositories',{dir,locale:getLocale()});pendingOpen.current=job.id;setConnections([job]);};
  useEffect(()=>{const job=connections.find(c=>c.id===pendingOpen.current&&c.persistedRevision);if(!cloud&&job){pendingOpen.current=null;void run(async()=>{const opened=await request(`/api/repositories/${job.id}/open`,{});await openConnectedRepository(opened.root);});}},[connections,cloud]);
  const pick=()=>run(async()=>{if(!available){setInstructions(true);return;}const result=await request('/api/repositories/pick',{});if(result.path){setPath(result.path);await connect(result.path);}});
  const loadRepos=()=>run(async()=>{try{const data=await request('/api/repositories/github/repos');setRepos(data.repos);}catch{const auth=await request('/api/repositories/github/authorize',{});window.location.assign(auth.url);}});
  const chooseRepo=async(name:string)=>{setRepo(name);setBranch(repos.find(r=>r.name===name)?.branch??'');const data=await request(`/api/repositories/github/branches?repo=${encodeURIComponent(name)}`);setBranches(data.branches);};
  return <section className="flex flex-col gap-3 rounded-panel border border-line bg-panel p-3">
    <h2 className="text-title font-semibold">{uiText('Repositório e sincronização')}</h2>
    <p className="text-caption text-muted">{uiText('Abra a arquitetura existente ou gere .arch a partir do código e dos documentos do projeto.')}</p>
    {!cloud&&<>
      <Button disabled={busy} icon={<FolderOpen size={14}/>} onClick={()=>void pick()}>{uiText('Conectar pasta')}</Button>
      {available&&<form className="flex gap-2" onSubmit={event=>{event.preventDefault();void run(()=>connect(path));}}><input className={`${inputClass} min-w-0 flex-1`} aria-label={uiText('Pasta local')} value={path} onChange={event=>setPath(event.target.value)} placeholder={uiText('Selecione uma pasta ou informe o caminho')}/><Button type="submit" disabled={busy||!path.trim()}>{uiText('Conectar')}</Button></form>}
      {instructions&&<CopyCode text="joinlet connect" label={uiText('Copiar comando de conexão')}/>}
      {!available&&canPickFolder()&&<Button variant="secondary" onClick={()=>void openFolderPicker()}>{uiText('Abrir pasta no navegador (limitado)')}</Button>}
      {!available&&<p className="text-caption text-muted">{canPickFolder()?uiText('Acesso direto do navegador: salva .arch; Git e acompanhamento em segundo plano exigem o conector.'):uiText('Execute joinlet connect no computador para habilitar pasta, Git e análise do projeto.')}</p>}
    </>}
    {cloud&&available&&connections.length===0&&<>
      <Button disabled={busy} icon={<FolderOpen size={14}/>} onClick={()=>void run(async()=>{const result=await request('/api/connectors/pairing',{locale:getLocale()});setPair(result.code);})}>{uiText('Conectar computador')}</Button>
      {pair&&<div className="text-caption"><p>{uiText('Execute no computador. O código expira em dez minutos.')}</p><CopyCode text={`joinlet connect --cloud-url ${window.location.origin} --pair ${pair}`} label={uiText('Copiar comando de conexão')}/></div>}
      <Button variant="secondary" disabled={busy} icon={<GitBranch size={14}/>} onClick={()=>void loadRepos()}>{uiText('Conectar repositório GitHub')}</Button>
      {repos.length>0&&<><select aria-label={uiText('Repositório GitHub')} className={inputClass} value={repo} onChange={event=>void run(()=>chooseRepo(event.target.value))}><option value="">{uiText('Escolher repositório')}</option>{repos.map(r=><option key={r.name}>{r.name}</option>)}</select><select aria-label={uiText('Branch do repositório')} className={inputClass} value={branch} onChange={event=>setBranch(event.target.value)}>{branches.map(b=><option key={b}>{b}</option>)}</select><Button disabled={busy||!repo||!branch} onClick={()=>void run(async()=>{const result=await request('/api/repositories/github',{repo,branch,locale:getLocale()});setConnections([result]);})}>{uiText('Analisar e conectar')}</Button></>}
    </>}
    {connections.map(connection=><div key={connection.id} className="flex flex-col gap-2 border-t border-line pt-3">
      <p role="status" className="flex items-center gap-2 font-medium">{['queued','files','architecture','sync'].includes(connection.phase)&&<LoaderCircle size={14} className="animate-spin"/>}{uiText(PHASE[connection.phase]??connection.phase)}</p>
      {(connection.repo||connection.root)&&<p className="break-all font-mono text-caption">{connection.repo??connection.root}{connection.branch?` · ${connection.branch}`:''}</p>}
      {connection.total>0&&<progress className="w-full" max={connection.total} value={connection.completed}/>}
      {connection.analyzedRevision&&<p className="text-caption text-muted">{uiText('Revisão analisada')}: {connection.analyzedRevision.slice(0,12)}</p>}
      {cloud&&connection.pendingWrites!==undefined&&connection.pendingWrites>0&&<p className="text-caption text-muted">{uiText(connection.kind==='local'?'Alterações salvas no cloud; aguardando gravação na pasta.':'Alterações salvas no cloud; publicação no Git pendente.')}</p>}
      {connection.persistedRevision&&<p className="text-caption text-muted">{uiText(connection.kind==='github'?'Último commit publicado':'Arquivos gravados na pasta')}: {connection.persistedRevision.slice(0,12)}</p>}
      {connection.git&&<p className="text-caption text-muted">{connection.git.version}{connection.git.branch?' · '+connection.git.branch:''}{connection.git.upstream?` · ↑${connection.git.ahead??'?'} ↓${connection.git.behind??'?'}`:''}{connection.git.repository&&!connection.git.remoteFresh?' · '+uiText('Atualidade do remoto não confirmada'):''}</p>}
      {connection.git&&!connection.git.repository&&<p className="text-caption text-muted">{uiText(connection.git.available?'Pasta sem Git; a sincronização local continua disponível.':'Git não está instalado; a sincronização da pasta continua disponível.')}</p>}
      <p className="text-caption text-muted">{uiText('Cobertura parcial: fontes reconhecidas e evidências verificadas.')}</p>
      {connection.pending.map(p=><p key={p} className="text-caption text-muted">{repositoryMessage(p)}</p>)}
      {connection.error&&<p role="alert" className="text-caption text-danger">{repositoryMessage(connection.error)}</p>}
      {connection.proposals.map(p=><details key={p.id} className="text-caption"><summary>{p.summary}</summary><p>{p.reason}</p><div className="flex gap-2 py-2">{p.ops.length>0&&<Button size="sm" disabled={busy} onClick={()=>void run(async()=>{await request(`/api/repositories/${connection.id}/proposals/${p.id}`,{action:'apply'});})}>{uiText('Aplicar proposta')}</Button>}<Button size="sm" variant="ghost" disabled={busy} onClick={()=>void run(async()=>{await request(`/api/repositories/${connection.id}/proposals/${p.id}`,{action:'dismiss'});})}>{uiText('Dispensar')}</Button></div>{p.refs.map(r=><code className="block" key={`${r.path}:${r.line}`}>{r.path}:{r.line}</code>)}</details>)}
      <div className="flex flex-wrap gap-2">
        {!cloud&&connection.persistedRevision&&<Button size="sm" onClick={()=>void run(async()=>{const opened=await request(`/api/repositories/${connection.id}/open`,{});await openConnectedRepository(opened.root);})}>{uiText('Abrir arquitetura')}</Button>}
        {cloud&&connection.kind==='local'&&<Button size="sm" onClick={()=>void run(async()=>{await request(`/api/repositories/${connection.id}/pick`,{});})}>{uiText('Escolher pasta')}</Button>}
        {cloud&&<Button size="sm" variant="ghost" onClick={()=>void run(async()=>{const archive=await request(`/api/repositories/${connection.id}/archive`);downloadBlob(new Blob([zipFiles(archive.files)],{type:'application/zip'}),'joinlet-previous-workspace.zip');})}>{uiText('Exportar workspace anterior')}</Button>}
        <Button size="sm" variant="secondary" icon={<RefreshCw size={13}/>} onClick={()=>void run(async()=>{await request(`/api/repositories/${connection.id}/sync`,{});})}>{uiText('Sincronizar')}</Button>
        <Button size="sm" variant="secondary" onClick={()=>void run(async()=>{setMcp(cloud?await request(`/api/repositories/${connection.id}/mcp`,{}):{url:window.location.origin+'/mcp'});})}>{uiText('Configurar MCP')}</Button>
        <Button size="sm" variant="ghost" onClick={()=>void run(async()=>{await request(`/api/repositories/${connection.id}/disconnect`,{});setConnections(connections.filter(c=>c.id!==connection.id));})}>{uiText('Desconectar')}</Button>
      </div>
    </div>)}
    {mcp&&<div className="text-caption"><p>{uiText('Configure o agente com esta URL. Guarde o token fora do repositório.')}</p><CopyCode text={mcp.url} label={uiText('Copiar URL MCP')}/>{mcp.token&&<CopyCode text={`Authorization: Bearer ${mcp.token}`} label={uiText('Copiar autorização MCP')}/>}</div>}
    {error&&<p role="alert" className="text-caption text-danger">{error}</p>}
  </section>;
}
