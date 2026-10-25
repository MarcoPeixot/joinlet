import './repositoryMessages';
import {useEffect,useState} from 'react';
import {Sparkles,X} from 'lucide-react';
import type {RepositoryStatus} from '@strukt/workspace/repository-contracts';
import {canDeepenRepository,repositoryAnalysisInstruction} from '@strukt/workspace/repository-guidance';
import type {RepositorySourceContext} from '@strukt/workspace/repository-guidance';
import {getLocale,uiText} from '../i18n';
import {useWorkspace,workspace} from '../workspace/appWorkspace';
import {useCatalog} from '../workspace/catalog';
import {requestAuthHeaders} from '../workspace/requestAuth';
import {setRepositoryAnalysisContext} from '../workspace/repositoryAnalysis';
import {openSettings,useSettings,refreshSettings} from '../settings/store';
import {Button} from '../ui/Button';
import {CopyCode} from '../ui/CopyCode';
import {showToast,toggleRightPanel,uiStore} from '../ui/uiStore';

type Connection=RepositoryStatus&{pendingWrites?:number};
const announced=new Set<string>();
export function RepositoryEnrichmentNotice(){
 const source=useWorkspace(s=>s.source),cloud=useCatalog(s=>s.cloud),workspaceId=useCatalog(s=>s.activeId),configured=useSettings(s=>!!s.view?.active);
 const [connection,setConnection]=useState<Connection|null>(null),[expanded,setExpanded]=useState(false),[hidden,setHidden]=useState(false),[agent,setAgent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 useEffect(()=>{let alive=true;setConnection(null);setHidden(false);setAgent(false);void refreshSettings();
  const poll=async()=>{try{const res=await fetch('/api/repositories',{headers:requestAuthHeaders()});if(!res.ok)return;const data=await res.json();if(!alive)return;const c=(data.connections as Connection[]).find(c=>cloud||source?.label===c.root+'/.arch');setConnection(c??null);if(c&&canDeepenRepository(c)&&!announced.has(c.id)){announced.add(c.id);showToast(uiText('A base do repositório está pronta. Aprofunde os diagramas e documentos com IA ou seu agente.'));}}catch{/* A browser-only workspace has no repository API. */}};
  void poll();const timer=setInterval(()=>void poll(),3000);return()=>{alive=false;clearInterval(timer);};
 },[source?.label,cloud,workspaceId]);
 if(!connection||!canDeepenRepository(connection)||hidden)return null;
 const analyze=async()=>{if(!configured){openSettings('ai');return;}const captured=source;if(!captured)return;setBusy(true);setError(null);
  try{const response=await fetch(`/api/repositories/${connection.id}/context`,{headers:requestAuthHeaders(),signal:AbortSignal.timeout(15000)}),snapshot=await response.json() as RepositorySourceContext&{error?:string};if(!response.ok)throw Error(snapshot.error??uiText('Não foi possível preparar as fontes do repositório.'));if(workspace.store.getState().source!==captured)return;
   const {chatStore}=await import('../chat/session');if(workspace.store.getState().source!==captured)return;chatStore.getState().newChat();setRepositoryAnalysisContext(captured,connection.id,snapshot);if(uiStore.getState().rightPanel!=='chat')toggleRightPanel('chat');
   const instruction=repositoryAnalysisInstruction(getLocale(),snapshot.revision)+'\n\n'+uiText('Fontes fornecidas: {0} de {1} arquivos; {2} ainda não foram lidos.',[snapshot.files.length,snapshot.total,snapshot.omitted])+'\n\n'+uiText('Leia as fontes anexadas. Comece refinando a organização ou criando um lote de até oito vistas/documentos ausentes. Informe o que falta ler e os próximos lotes.');
   void chatStore.getState().send(instruction);setExpanded(false);
  }catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}
 };
 return <aside aria-label={uiText('Aprofundar a análise do repositório')} className="nowheel nopan nodrag overflow-y-auto rounded-panel border border-line bg-panel p-3 shadow-lg" style={{maxWidth:'min(28rem, calc(100vw - 2rem))',maxHeight:'min(70dvh, 36rem)'}}>
  <div className="flex items-center gap-2"><Sparkles size={15} className="shrink-0 text-accent"/><button className="min-w-0 flex-1 text-left text-caption font-medium" onClick={()=>setExpanded(!expanded)} aria-expanded={expanded}>{uiText(connection.pending.length?'Base preparada; há pendências para revisão':'Arquitetura inicial sincronizada')} · {uiText('Aprofundar com IA')}</button><button aria-label={uiText('Ocultar aviso')} onClick={()=>setHidden(true)}><X size={14}/></button></div>
  {expanded&&<div className="mt-2 flex flex-col gap-2 text-caption"><p className="text-muted">{uiText('A IA do Joinlet ou seu agente local pode ler as fontes e refinar documentação, pastas, diagramas e conexões. A preparação inicial não substitui uma análise detalhada da codebase.')}</p>
   {connection.knowledge&&<p className="text-muted">{uiText('{0} Markdown importados · {1} relações verificadas no Overview',[connection.knowledge.documents,connection.knowledge.connections])}</p>}
   <div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy} icon={<Sparkles size={13}/>} onClick={()=>void analyze()}>{uiText(busy?'Preparando fontes…':configured?'Analisar com IA do Joinlet':'Configurar IA do Joinlet')}</Button><Button size="sm" variant="secondary" onClick={()=>setAgent(!agent)}>{uiText('Usar meu agente local')}</Button><Button size="sm" variant="ghost" onClick={()=>toggleRightPanel('github')}>{uiText('Ver sincronização e MCP')}</Button></div>
   {agent&&<><p className="text-muted">{uiText('Cole a tarefa no agente com acesso ao checkout ou configure o MCP desta conexão. Ele poderá percorrer as fontes por páginas e atualizar os itens existentes.')}</p><CopyCode text={repositoryAnalysisInstruction(getLocale(),connection.analyzedRevision)} label={uiText('Copiar tarefa para o agente')}/></>}
   {error&&<p role="alert" className="text-danger">{error}</p>}
  </div>}
 </aside>;
}
