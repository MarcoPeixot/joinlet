import type {RepositoryReader,RepositoryConfig} from './contracts';
import {matchGlob} from '../sources';
import type {RepositorySourceContext} from './guidance';
import {sourcePath,digest} from './reader';
const analyzable=(path:string)=>sourcePath(path)&&/\.(?:[cm]?[jt]sx?|py|java|go|rs|rb|php|cs|fs|c|h|cpp|swift|kts?|scala|vue|svelte|astro|md|markdown|mdx|json|ya?ml|toml|tf|xml|mod|gradle)$|(?:^|\/)Dockerfile$/.test(path);
export function scopedRepositoryReader(reader:RepositoryReader,config:Pick<RepositoryConfig,'include'|'exclude'>):RepositoryReader{
 const allowed=(path:string)=>sourcePath(path)&&config.include.some(p=>matchGlob(p,path))&&!config.exclude.some(p=>matchGlob(p,path));
 return {policy:repositoryPolicy(config),revision:()=>reader.revision(),list:async()=>(await reader.list()).filter(e=>allowed(e.path)),read:path=>allowed(path)?reader.read(path):Promise.resolve(null)};
}
export const repositoryPolicy=(config:Pick<RepositoryConfig,'include'|'exclude'>)=>digest(JSON.stringify([config.include,config.exclude]));
export async function repositorySourceIdentity(reader:RepositoryReader){return {revision:await repositoryRevision(reader),policy:reader.policy};}
export async function repositoryRevision(reader:RepositoryReader){await reader.list();return reader.revision();}
export async function listRepositoryFiles(reader:RepositoryReader,options:{prefix?:string;offset?:number;limit?:number}={}){
 const prefix=options.prefix??'';if(prefix&&(prefix.startsWith('/')||prefix.split('/').some(p=>p==='..'||p==='.')||prefix.includes('\\')))throw Error('Invalid repository path prefix.');
 const offset=options.offset??0,limit=options.limit??100;
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>500)throw Error('Invalid inventory page.');
 const entries=(await reader.list()).filter(e=>analyzable(e.path)&&e.path.startsWith(prefix)).sort((a,b)=>a.path.localeCompare(b.path));
 return {revision:await reader.revision(),files:entries.slice(offset,offset+limit),total:entries.length,nextOffset:offset+limit<entries.length?offset+limit:null};
}
export async function readRepositorySource(reader:RepositoryReader,path:string,start=1,count=200,expected?:string){
 if(!analyzable(path)||!Number.isSafeInteger(start)||start<1||!Number.isSafeInteger(count)||count<1||count>500)throw Error('Invalid repository source request.');
 const revision=await repositoryRevision(reader);if(expected&&revision!==expected)throw Error('Repository revision changed; refresh the analysis plan.');
 const text=await reader.read(path);if(text===null)throw Error('Source is unavailable, excluded, binary or oversized.');
 const lines=text.split(/\r?\n/),selected:string[]=[];let bytes=0;
 if((lines[start-1]?.length??0)>40000)throw Error('The requested source line exceeds the response limit; inspect a narrower source.');
 for(const line of lines.slice(start-1,start-1+count)){bytes+=line.length;if(bytes>40000)break;selected.push(line);}
 if(await repositoryRevision(reader)!==revision)throw Error('Repository changed while reading source.');
 return {path,revision,start,lineCount:lines.length,lines:selected,nextLine:start-1+selected.length<lines.length?start+selected.length:null};
}
/** A bounded source snapshot for the existing Joinlet chat; omitted files remain explicit and accessible via MCP. */
export async function repositorySourceContext(reader:RepositoryReader):Promise<RepositorySourceContext>{
 const entries=(await reader.list()).filter(e=>analyzable(e.path)),revision=await reader.revision();
 const rank=(path:string)=>/(?:^|\/)README\./i.test(path)?0:/(?:^|\/)(?:package\.json|pyproject\.toml|go\.mod|Cargo\.toml)$/.test(path)?1:/(?:^|\/)(?:main|index|app|server)\.[^.]+$/.test(path)?2:/\.(md|markdown|mdx)$/.test(path)?4:3;
 entries.sort((a,b)=>rank(a.path)-rank(b.path)||a.path.localeCompare(b.path));
 const files:RepositorySourceContext['files']=[],unreadable:string[]=[];let size=0,reads=0;
 for(const entry of entries){if(reads>=80||size>=99000)break;if((entry.bytes??0)>60000)continue;reads++;const text=await reader.read(entry.path);if(text===null){const cost=JSON.stringify(entry.path).length;if(size+cost>100000)break;unreadable.push(entry.path);size+=cost;continue;}const cost=JSON.stringify({path:entry.path,text}).length;if(text.length>60000||size+cost>100000)continue;files.push({path:entry.path,text});size+=cost;}
 if(await repositoryRevision(reader)!==revision)throw Error('Repository changed during context preparation. Retry against the current revision.');
 const omitted=entries.length-files.length;return {revision,...(reader.policy?{policy:reader.policy}:{}),files,total:entries.length,omitted,unreadable,complete:omitted===0};
}
