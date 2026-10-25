import { workspace } from './appWorkspace';
import { hasPendingCodeEdits } from '../code/registry';
import { diagramStore } from '../state/appStore';
import { aiStore } from '../ai/session';
import type { RepositoryStatus } from '@strukt/workspace/repository-contracts';

let stop: (() => void) | undefined;
/** Source analyses notify the active editor even while the repository panel is closed. */
export async function followRepository(root: string): Promise<void> {
  stop?.(); let active=true, baseline:string|null=null, refreshing=false;
  stop=()=>{active=false;};
  const data=await fetch('/api/repositories').then(r=>r.ok?r.json():null).catch(()=>null) as {connections:(RepositoryStatus&{root?:string})[]}|null;
  if(!active)return;
  const connection=data?.connections.find(c=>c.root===root);if(!connection)return;
  baseline=null;
  const accept=async(status:RepositoryStatus)=>{
    if(!active||!status.persistedRevision||status.persistedRevision===baseline||refreshing)return;
    if(workspace.storage()?.label!==`${root}/.arch`)return;
    if(workspace.hasUnsaved()||hasPendingCodeEdits()||diagramStore.getState().readOnly||aiStore.getState().status==='loading'){workspace.setExternal(['repository-state.json']);return;}
    refreshing=true;
    try{await workspace.reload();baseline=status.persistedRevision;}catch{workspace.setExternal(['repository-state.json']);}finally{refreshing=false;}
  };
  void accept(connection);
  const events=typeof EventSource==='undefined'?null:new EventSource(`/api/repositories/${connection.id}/events`);
  events?.addEventListener('status',event=>{try{void accept(JSON.parse((event as MessageEvent).data));}catch{}});
  if(events)events.onerror=()=>events.close();
  const timer=setInterval(()=>{void fetch(`/api/repositories/${connection.id}`).then(r=>r.ok?r.json():null).then(status=>status&&accept(status)).catch(()=>{});},4000);
  stop=()=>{active=false;events?.close();clearInterval(timer);};
}
export function stopFollowingRepository(){stop?.();stop=undefined;}
