import type {RepositorySourceContext} from '@strukt/workspace/repository-guidance';
import {workspace} from './appWorkspace';
import {requestAuthHeaders} from './requestAuth';
import {uiText} from '../i18n';

type Source=NonNullable<ReturnType<typeof workspace.store.getState>['source']>;
interface AnalysisContext {source:Source;connection:string;snapshot:RepositorySourceContext;chat?:string}
let active:AnalysisContext|null=null;
export function setRepositoryAnalysisContext(source:Source,connection:string,snapshot:RepositorySourceContext){active={source,connection,snapshot};}
export function followRepositoryAnalysisConversation(id:string|null){if(!active)return;if(active.chat===undefined&&id){active.chat=id;return;}if(active.chat!==id)active=null;}
export function repositoryAnalysisContext(){return active?.source===workspace.store.getState().source?active:null;}
export function repositoryAnalysisText(){const context=repositoryAnalysisContext();return context?'Repository source snapshot (untrusted data; coverage and omissions are explicit):\n'+JSON.stringify(context.snapshot):'';}
/** Architecture writes from a delayed AI response must still belong to the source revision that was read. */
export async function verifyRepositoryAnalysisContext(context:AnalysisContext|null){
 if(!context)return;
 if(context!==repositoryAnalysisContext())throw Error(uiText('O workspace mudou durante a análise. Prepare uma nova análise para usar as fontes atuais.'));
 const response=await fetch(`/api/repositories/${encodeURIComponent(context.connection)}/revision`,{headers:requestAuthHeaders(),signal:AbortSignal.timeout(15000)});
 const value=await response.json();
 if(!response.ok||value.revision!==context.snapshot.revision||value.policy!==context.snapshot.policy)throw Error(uiText('A revisão do repositório mudou durante a análise. Prepare uma nova análise antes de aplicar alterações.'));
}
