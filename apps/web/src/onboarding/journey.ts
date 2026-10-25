import { createStore } from 'zustand/vanilla';
export type JourneyStep='edit'|'document'|'version'|'backup'|'ai'|'publish'|'connect'|'explore'|'evidence'|'review'|'save';
export interface JourneyToken {workspace:string;revision:string|null}
export interface JourneyConnection {analyzedRevision:string|null;persistedRevision:string|null;pendingWrites?:number;phase:string;pending:string[];proposals:unknown[];error?:string}
interface Progress {done:Partial<Record<JourneyStep,true>>;revision:string|null;hidden:boolean;collapsed:boolean}
interface JourneyState extends Progress {workspace:string|null;repository:boolean;confirmed:boolean;connection:JourneyConnection|null}
const blank=():Progress=>({done:{},revision:null,hidden:false,collapsed:false});
const revisionSteps:JourneyStep[]=['connect','explore','evidence','review','save'];
const steps:JourneyStep[]=['edit','document','version','backup','ai','publish',...revisionSteps];
export function createJourney(storage?:Pick<Storage,'getItem'|'setItem'>){
 const memory=new Map<string,Progress>();
 const key=(workspace:string)=>'joinlet:onboarding:v2:'+workspace;
 const read=(workspace:string):Progress=>{
  if(memory.has(workspace))return memory.get(workspace)!;
  try{const raw=JSON.parse(storage?.getItem(key(workspace))??'null');if(raw?.version===2){const done:Progress['done']={};for(const step of steps)if(Object.hasOwn(raw.done??{},step)&&raw.done[step]===true)done[step]=true;return {done,revision:typeof raw.revision==='string'?raw.revision:null,hidden:raw.hidden===true,collapsed:raw.collapsed===true};}
   const legacy=JSON.parse(storage?.getItem('strukt:checklist')??'null');return {...blank(),hidden:legacy?.hidden===true,collapsed:legacy?.collapsed===true};
  }catch{return blank();}
 };
 const store=createStore<JourneyState>(()=>({...blank(),workspace:null,repository:false,confirmed:false,connection:null}));
 const persist=()=>{const {workspace,done,revision,hidden,collapsed}=store.getState();if(!workspace)return;memory.set(workspace,{done:{...done},revision,hidden,collapsed});try{storage?.setItem(key(workspace),JSON.stringify({version:2,done,revision,hidden,collapsed}));}catch{/* Progress remains available in this session. */}};
 const token=():JourneyToken|null=>{const state=store.getState();return state.workspace?{workspace:state.workspace,revision:state.revision}:null;};
 const matches=(captured:JourneyToken|null)=>{const now=token();return !!captured&&!!now&&captured.workspace===now.workspace&&captured.revision===now.revision;};
 const complete=(step:JourneyStep,captured=token())=>{if(!matches(captured)||store.getState().done[step])return;store.setState(s=>({done:{...s.done,[step]:true}}));persist();};
 return {store,token,matches,complete,
  open(workspace:string,repository=false){if(store.getState().workspace===workspace){if(repository)store.setState({repository:true});return;}store.setState({...read(workspace),workspace,repository,confirmed:false,connection:null});},
  close(){store.setState({...blank(),workspace:null,repository:false,confirmed:false,connection:null});},
  connection(connection:JourneyConnection,captured=token()){
   if(!matches(captured))return;
   const previous=store.getState(),revision=connection.analyzedRevision;
   const done={...previous.done};if(revision!==previous.revision)for(const step of revisionSteps)delete done[step];
   if(revision&&connection.persistedRevision)done.connect=true;else delete done.connect;
   if(!connection.persistedRevision||connection.pendingWrites||['queued','sync','conflict','error','disconnected'].includes(connection.phase))delete done.save;
   store.setState({repository:true,revision,connection,done,confirmed:true});persist();
  },
  unavailable(captured=token()){if(!matches(captured)||!store.getState().repository)return;store.setState(s=>({confirmed:false,connection:s.connection?{...s.connection,phase:'disconnected'}:null,done:{...s.done,save:undefined}}));persist();},
  confirmReview(){const state=store.getState();if(state.connection?.proposals.length||state.connection?.phase==='conflict'||!state.done.evidence||!state.done.explore)return;complete('review');},
  saved(saved:boolean){const state=store.getState();const c=state.connection;if(state.repository){if(!saved&&state.confirmed)store.setState({confirmed:false});const okay=saved&&state.confirmed&&state.done.review&&c?.persistedRevision&&!c.pendingWrites&&['ready','review','paused'].includes(c.phase)&&!c.error;if(okay)complete('save');else if(state.done.save){store.setState(s=>({done:{...s.done,save:undefined}}));persist();}}},
  preferences(change:Partial<Pick<Progress,'hidden'|'collapsed'>>){store.setState(change);persist();},
 };
}
let storage:Storage|undefined;try{storage=globalThis.localStorage;}catch{}
export const journey=createJourney(storage);
