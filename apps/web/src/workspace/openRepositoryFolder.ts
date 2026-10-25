import { uiText } from '../i18n';
import { showToast } from '../ui/uiStore';
import { openGithub } from '../github/session';
import { catalogStore } from './catalog';
import { collaborationSession, openConnectedRepository } from './boot';
import { getLocale } from '../i18n';
import { requestAuthHeaders } from './requestAuth';

let opening=false;
/** Cloud delegates to its paired computer; a local API prepares the selected repository. */
export async function openRepositoryFolder(): Promise<boolean> {
  if(opening)return true;
  const session=collaborationSession();
  if(session && session.mode!=='cloud')return false;
  if(session && !session.owner)throw Error(uiText('Entre no seu workspace para conectar uma pasta.'));
  const request=async(path:string,body?:unknown)=>{
    const response=await fetch(path,{...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),headers:{'content-type':'application/json',...requestAuthHeaders()}});
    const data=await response.json();if(!response.ok)throw Error(data.error??uiText('Não foi possível abrir a pasta.'));return data;
  };
  let connections:{id:string;kind?:string;phase:string}[];
  try { connections=(await request('/api/repositories')).connections; }
  catch(error){if(session?.mode==='cloud')throw error;return false;}
  opening=true;
  try {
    catalogStore.setState({open:false});openGithub();
    if(session?.mode==='cloud') {
      const local=connections.find(c=>c.kind==='local');
      if(local && local.phase!=='disconnected')await request(`/api/repositories/${local.id}/pick`,{});
      else showToast(uiText(local?'O conector está desconectado. Inicie joinlet connect no computador pareado.':connections.length?'Este workspace está conectado ao GitHub. Crie outro workspace para conectar uma pasta local.':'Conecte este computador no painel para escolher uma pasta.'));
      return true;
    }
    const selected=await request('/api/repositories/pick',{});if(!selected.path)return true;
    const job=await request('/api/repositories',{dir:selected.path,locale:getLocale()});
    for(let attempt=0;attempt<240;attempt++) {
      const status=await request(`/api/repositories/${job.id}`);
      if(status.persistedRevision&&status.root){const opened=await request(`/api/repositories/${job.id}/open`,{});await openConnectedRepository(opened.root);return true;}
      if(status.phase==='error'||status.phase==='conflict')throw Error(status.error??uiText('Não foi possível preparar a arquitetura da pasta.'));
      await new Promise(done=>setTimeout(done,500));
    }
    throw Error(uiText('A pasta ainda está sendo preparada. Acompanhe o progresso no painel.'));
  } finally {opening=false;}
}
