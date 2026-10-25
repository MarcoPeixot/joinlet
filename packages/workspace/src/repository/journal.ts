import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, stat, mkdir, readFile, writeFile, rename, rm, open, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import type { StorageAdapter } from '../storage';
import { StorageConflict } from '../storage';
import type { FileMutation } from './transaction';

async function journalPaths(root:string) {
  const canonical=await realpath(root).catch(()=>resolve(root));
  const directory=join(process.env.STRUKT_CONFIG_DIR?.trim()||join(homedir(),'.config','strukt'),'repository-journals');
  const prefix=join(directory,createHash('sha256').update(canonical).digest('hex'));
  return {directory,lock:prefix+'.lock',journal:prefix+'.json'};
}
/** Explicit recovery before a mutating connection/init. Read-only checks never invoke it. */
export async function recoverJournal(adapter:StorageAdapter,root:string,guard:(path:string)=>Promise<void>) {
  const {journal}=await journalPaths(root);
  if(await readFile(journal,'utf8').catch(()=>null))await journaledBatch(adapter,root,guard)([]);
}

/** Per-repository durable journal outside Git. CAS recovery never overwrites a subsequent user edit. */
export function journaledBatch(adapter: StorageAdapter, root: string, guard: (path: string) => Promise<void>) {
  return async (changes: FileMutation[]) => {
    const {directory,lock,journal}=await journalPaths(root);
    await mkdir(directory,{recursive:true,mode:0o700});
    let handle;
    try{handle=await open(lock,'wx',0o600);await handle.writeFile(String(process.pid));}
    catch(error){
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      const pid=Number(await readFile(lock,'utf8').catch(()=>''));let alive=false;
      if(Number.isSafeInteger(pid)&&pid>0)try{process.kill(pid,0);alive=true;}catch{}
      if(alive)throw new StorageConflict('Another Joinlet process is writing this repository.');
      await rm(lock,{force:true});handle=await open(lock,'wx',0o600);await handle.writeFile(String(process.pid));
    }
    const replace=async(path:string,text:string|null)=>{
      const target=join(root,path);await guard(target);
      const info=await stat(target).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;});
      if(info)await access(target,constants.W_OK);
      if(text===null){await adapter.remove(path);return;}
      await mkdir(dirname(target),{recursive:true});
      const temporary=join(dirname(target),`.joinlet-${crypto.randomUUID()}.tmp`);
      try{await writeFile(temporary,text,{mode:info?info.mode&0o777:0o600});await rename(temporary,target);}finally{await rm(temporary,{force:true});}
    };
    try{
      const pending=await readFile(journal,'utf8').catch(()=>null);
      if(pending){
        const entries=JSON.parse(pending) as FileMutation[];
        for(const change of entries.reverse()){
          if(await adapter.read(change.path)===change.text)await replace(change.path,change.expected);
          else if(await adapter.read(change.path)!==change.expected)throw new StorageConflict('Interrupted repository write conflicts with an external edit.');
        }
        await rm(journal,{force:true});
      }
      if(!changes.length)return;
      for(const change of changes)if(await adapter.read(change.path)!==change.expected)throw new StorageConflict(`${change.path} changed before the batch was committed.`);
      await writeFile(journal,JSON.stringify(changes),{mode:0o600});
      for(const change of changes)await replace(change.path,change.text);
      await rm(journal,{force:true});
    }finally{await handle.close();await rm(lock,{force:true});}
  };
}
