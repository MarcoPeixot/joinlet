import { mkdir, readFile, readdir, writeFile, chmod, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from '@strukt/workspace/repository-reader';

export interface ConnectorCredentials { id:string;token:string;root?:string;locale?:string }
const paths=(origin:string)=>{
  const directory=join(process.env.STRUKT_CONFIG_DIR?.trim()||join(homedir(),'.config','strukt'),'connectors');
  const prefix=digest(origin).slice(0,16);
  return {directory,prefix,current:join(directory,prefix+'.json'),saved:(id:string)=>join(directory,`${prefix}-${digest(id).slice(0,16)}.json`)};
};
async function read(path:string,origin:string):Promise<ConnectorCredentials|null> {
  try{const value=JSON.parse(await readFile(path,'utf8'));return value.origin===origin&&typeof value.id==='string'&&typeof value.token==='string'&&(value.root===undefined||typeof value.root==='string')?value:null;}catch{return null;}
}
async function save(path:string,origin:string,value:ConnectorCredentials) {
  const pending=path+'.'+randomUUID()+'.tmp';
  try {await writeFile(pending,JSON.stringify({...value,origin}),{mode:0o600});await chmod(pending,0o600);await rename(pending,path);}
  finally {await rm(pending,{force:true});}
}
/** Keep each paired workspace independently; the legacy file remains the last-used connection. */
export async function saveConnectorCredentials(origin:string,value:ConnectorCredentials) {
  const p=paths(origin);await mkdir(p.directory,{recursive:true,mode:0o700});
  const previous=await read(p.current,origin);
  if(previous&&previous.id!==value.id)await save(p.saved(previous.id),origin,previous);
  await save(p.saved(value.id),origin,value);await save(p.current,origin,value);
}
export async function loadConnectorCredentials(origin:string,root?:string|null):Promise<ConnectorCredentials> {
  const p=paths(origin),current=await read(p.current,origin);
  if(!root){if(current)return current;throw Error('Pair this computer with a code from Joinlet first.');}
  const saved=await readdir(p.directory).catch(()=>[]),matches=new Map<string,ConnectorCredentials>();
  for(const path of saved.filter(path=>path.startsWith(p.prefix)&&path.endsWith('.json'))) {
    const value=await read(join(p.directory,path),origin);
    if(value?.root&&resolve(value.root)===resolve(root))matches.set(value.id,value);
  }
  if(matches.size===1)return [...matches.values()][0]!;
  if(matches.size>1)throw Error('This folder is paired with several workspaces. Use a new pairing code from the workspace you want to open.');
  if(current&&!current.root)return current;
  throw Error('This folder is not paired with Joinlet. Use the pairing command from its workspace.');
}
