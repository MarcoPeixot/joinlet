import './journeyMessages';
import {repositoryMessage} from '../panels/repositoryMessages';
import {uiText} from '../i18n';
import {Check,ChevronDown,ChevronUp,X} from 'lucide-react';
import {m} from 'motion/react';
import {useEffect,useState} from 'react';
import {useStore} from 'zustand';
import {IconButton} from '../ui/IconButton';
import {FADE} from '../ui/motion';
import {useSettings} from '../settings/store';
import {isBrowserPreview} from '../settings/publicAccess';
import {useGithub,openGithub} from '../github/session';
import {openSaveVersion} from '../versions/session';
import {workspace,useWorkspace} from '../workspace/appWorkspace';
import {useCatalog} from '../workspace/catalog';
import {requestAuthHeaders} from '../workspace/requestAuth';
import {navigationIdentity} from '../workspace/navigation';
import {diagramStore} from '../state/appStore';
import {isViewOnly} from '../workspace/boot';
import {showToast,uiStore} from '../ui/uiStore';
import {collaborationViewState,useCollaborationSlice} from '../workspace/collaborationView';
import {hasPendingCodeEdits} from '../code/registry';
import {journey,type JourneyStep,type JourneyConnection} from './journey';
import {startTour,useTour} from './tour';
import {useFirstRunVisible,useStartCardVisible} from './useFirstRun';
import {isPristineSample} from './firstRun';
const LABELS:Record<JourneyStep,string>={edit:'Editar diagrama',document:'Adicionar documentação',version:'Salvar uma versão',backup:'Exportar backup',ai:'Gerar com IA',publish:'Publicar no GitHub',connect:'Conectar projeto',explore:'Explorar mapa',evidence:'Abrir evidência',review:'Revisar análise',save:'Confirmar gravação'};
export function Checklist(){
 const state=useStore(journey.store,s=>s),source=useWorkspace(s=>s.source),save=useWorkspace(s=>s.save),data=useWorkspace(s=>s.data);
 const activeId=useCatalog(s=>s.activeId),cloud=useCatalog(s=>s.cloud);
 const roomPending=useCollaborationSlice(s=>s.client?.pending??0),roomStatus=useCollaborationSlice(s=>s.status);
 const configured=useSettings(s=>!!s.view?.active),githubReady=useGithub(s=>!!s.repo?.ghReady);
 const firstRun=useFirstRunVisible(),empty=useStartCardVisible(),tour=useTour(s=>s.step!==null);
 const [review,setReview]=useState(false);
 useEffect(()=>{
  const adapter=workspace.storage();if(!source||!adapter){journey.close();return;}
  const identity=activeId??navigationIdentity(adapter)??source.label;
  journey.open(identity);setReview(false);
  let active=true;
  const poll=async()=>{const captured=journey.token();const unavailable=()=>{if(active&&workspace.store.getState().source===source)journey.unavailable(captured);};try{const response=await fetch('/api/repositories',{headers:requestAuthHeaders()});if(!response.ok){unavailable();return;}const body=await response.json();if(!active||workspace.store.getState().source!==source||!journey.matches(captured))return;
   const connection=(body.connections as (JourneyConnection&{root?:string})[]).find(c=>cloud||source.label===c.root+'/.arch');if(connection)journey.connection(connection,captured);else unavailable();
  }catch{unavailable();}};
  void poll();const timer=setInterval(()=>void poll(),4000);
  let documentToken:ReturnType<typeof journey.token>=null;
  const content=workspace.store.subscribe((next,previous)=>{
   if(next.source!==source)return;
   if(next.data?.docs!==previous.data?.docs&&Object.entries(next.data?.docs??{}).some(([slug,text])=>text.trim().length>=20&&text!==previous.data?.docs[slug])){documentToken=journey.token();journey.saved(false);}
   if(next.save==='saved'&&previous.save!=='saved'&&documentToken){journey.complete('document',documentToken);documentToken=null;}
  });
  const diagram=diagramStore.subscribe((next,previous)=>{
   if(workspace.store.getState().source!==source)return;
   if(next.selection!==previous.selection&&next.selection.nodes.length&&workspace.store.getState().view.kind==='diagram')journey.complete('explore');
   if(next.model!==previous.model&&next.past!==previous.past&&next.past.length&&!isPristineSample(next.model)){journey.complete('edit');journey.saved(false);}
  });
  return()=>{active=false;clearInterval(timer);diagram();content();};
 },[source,activeId,cloud]);
 useEffect(()=>{journey.saved(save==='saved'&&!workspace.hasUnsaved()&&!hasPendingCodeEdits()&&!roomPending&&(roomStatus===null||roomStatus==='connected'));},[save,state.connection,state.done.review,roomPending,roomStatus]);
 if(firstRun||empty||tour||state.hidden||!source)return null;
 const readonly=isViewOnly();
 const list:JourneyStep[]=readonly?['explore','evidence','backup']:state.repository?['connect','explore','evidence','review','save']:['edit','document','version','backup'];
 const evidence=Object.values(data?.evidence??{}).some(elements=>Object.values(elements).some(refs=>refs.some(r=>r.line&&r.contains)));
 const applicable=list.filter(step=>step!=='evidence'||evidence);
 const done=applicable.filter(step=>state.done[step]);
 const run=async(step:JourneyStep)=>{
  if(step==='connect'||step==='publish'){openGithub();return;}
  if(step==='version'){openSaveVersion();return;}
  if(step==='backup'){await (await import('../workspace/boot')).exportZip();return;}
  if(step==='document'){await workspace.create('doc',uiText('Notas'));return;}
  if(step==='edit'){let id='Node',n=2;while(Object.hasOwn(diagramStore.getState().model.elements,id))id='Node'+n++;diagramStore.getState().apply([{op:'add_node',id,label:uiText('Componente')}]);return;}
  if(step==='explore'){await workspace.show({kind:'diagram'});return;}
  if(step==='evidence'){
   const entries=Object.entries(data?.evidence??{});const entry=entries.flatMap(([slug,elements])=>Object.entries(elements).map(([id,refs])=>({slug,id,refs}))).find(e=>!e.id.startsWith('edge:')&&e.refs.some(r=>r.line&&r.contains));
   if(entry){await workspace.openDiagram(entry.slug);diagramStore.getState().select({nodes:[entry.id],edges:[]});uiStore.setState({inspectorTab:'overview',rightPanel:null});}else showToast(uiText('Use uma conexão de repositório para consultar evidências do código.'));return;
  }
  if(step==='review'){setReview(true);return;}
  if(step==='save'){const captured=journey.token();journey.saved(false);await workspace.flush();const response=await fetch('/api/repositories',{headers:requestAuthHeaders()});if(response.ok){const body=await response.json();if(workspace.store.getState().source===source&&journey.matches(captured)){const c=body.connections.find((c:JourneyConnection&{root?:string})=>cloud||source.label===c.root+'/.arch');if(c)journey.connection(c,captured);}}const room=collaborationViewState();journey.saved(!workspace.hasUnsaved()&&!hasPendingCodeEdits()&&!room.client?.pending&&(room.status===null||room.status==='connected'));if(!journey.store.getState().done.save)showToast(uiText('Aguardando confirmação da gravação.'));}
 };
 return <m.section aria-label={uiText('Primeiros passos')} className="mx-2 mb-2 shrink-0 rounded-[12px] bg-panel-2 px-2 py-1.5" initial={{opacity:0}} animate={{opacity:1}} transition={FADE}>
  <div className="flex items-center gap-1 pl-1.5"><span className="flex-1 whitespace-nowrap text-caption font-medium text-muted">{uiText('Começando ·')} {done.length}/{applicable.length}</span>
   <IconButton label={uiText('Fazer o tour')} className="h-6 min-w-6 px-1.5 text-caption" onClick={startTour}>Tour</IconButton>
   <IconButton label={uiText(state.collapsed?'Expandir primeiros passos':'Recolher primeiros passos')} onClick={()=>journey.preferences({collapsed:!state.collapsed})}>{state.collapsed?<ChevronUp/>:<ChevronDown/>}</IconButton>
   <IconButton label={uiText('Ocultar primeiros passos')} onClick={()=>journey.preferences({hidden:true})}><X/></IconButton>
  </div>
  {!state.collapsed&&<ul className="mt-1 flex flex-col">{list.map(step=><li key={step}>{step==='evidence'&&!evidence?<p className="p-1 text-meta text-muted">{uiText('Não se aplica: não há evidência de código neste workspace.')}</p>:<button type="button" aria-pressed={!!state.done[step]} className="flex min-h-7 w-full items-center gap-2 rounded-control pl-1.5 text-left text-caption text-muted hover:bg-panel-3/60 hover:text-ink" onClick={()=>void run(step).catch(error=>showToast(String(error)))}><span className="flex h-4 w-4 flex-none items-center justify-center rounded-full border border-line-strong">{state.done[step]&&<Check size={10}/>}</span><span className={state.done[step]?'line-through text-faint':''}>{uiText(LABELS[step])}</span></button>}</li>)}</ul>}
  {!state.collapsed&&!readonly&&!isBrowserPreview()&&(configured||githubReady)&&<div className="flex flex-col text-meta text-muted"><span>{uiText('Opcional')}</span>{configured&&<button type="button" aria-pressed={!!state.done.ai} onClick={()=>{void import('../ai/session').then(m=>{m.aiStore.getState().setMode('generate');m.aiStore.getState().setOpen(true);});}}>{uiText('Gerar com IA')}{state.done.ai?' ✓':''}</button>}{githubReady&&<button type="button" aria-pressed={!!state.done.publish} onClick={openGithub}>{uiText('Publicar no GitHub')}{state.done.publish?' ✓':''}</button>}</div>}
  {readonly&&<p className="text-meta text-muted">{uiText('Você pode explorar e exportar este workspace. Edição exige permissão.')}</p>}
  {review&&<div role="region" aria-label={uiText('Revisar análise')} className="p-1 text-meta"><p>{uiText('A análise tem cobertura parcial. Confira as evidências e as pendências antes de confirmar.')}</p><code>{state.revision?.slice(0,12)}</code>{state.connection?.pending.map(p=><p key={p}>{repositoryMessage(p)}</p>)}<button type="button" disabled={!!state.connection?.proposals.length||!state.done.explore||(!state.done.evidence&&evidence)} onClick={()=>{if(!evidence)journey.complete('evidence');journey.confirmReview();setReview(false);}}>{uiText('Revisei esta análise')}</button>{!!state.connection?.proposals.length&&<p>{uiText('Resolva ou dispense as propostas antes de confirmar a revisão.')}</p>}</div>}
 </m.section>;
}
