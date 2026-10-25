import {posix} from 'node:path';
import {digest} from './reader';
import {addItem} from '../workspace';
import type {WorkspaceData} from '../workspace';
import {BOARD_MAX_ITEMS,itemCardId,reconcileBoard} from '../board';
import type {BoardConnection} from '../board';
import {normalizeFolder} from '../folders';
import type {RepositoryFact} from './contracts';

export interface SourceDocument {slug:string;title:string;folder:string;hash:string;sourceHash:string}
export interface RepositoryKnowledge {documents:Record<string,SourceDocument>;connections:Record<string,BoardConnection>;folders:Record<string,string>}
export const isRepositoryMarkdown=(path:string)=>/\.(?:md|markdown|mdx)$/i.test(path);
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const textOutsideCode=(text:string)=>{let fence='';return text.split(/\r?\n/).filter(line=>{const marker=line.match(/^\s*(`{3,}|~{3,})/);if(marker){if(!fence)fence=marker[1]![0]!;else if(fence===marker[1]![0])fence='';return false;}return !fence;}).join('\n').replace(/`[^`\n]*`/g,'');};
export function markdownTargets(text:string):string[]{const source=textOutsideCode(text);return [...source.matchAll(/(?<!!)\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)|^\s*\[[^\]\n]+\]:\s*(<[^>]+>|\S+)/gm)].map(match=>(match[1]??match[2]!).replace(/^<|>$/g,''));}
const sourceFolder=(path:string,pt:boolean)=>normalizeFolder([pt?'Repositório':'Repository',...path.split('/').slice(0,-1).slice(0,3).map(part=>part.slice(0,60))].join('/'))??(pt?'Repositório':'Repository');
const sourceTitle=(path:string,text:string)=>textOutsideCode(text).match(/^#\s+(.+?)\s*#*$/m)?.[1]?.replace(/[\[\]*_]/g,'').slice(0,200)||(/(?:^|\/)readme\./i.test(path)?'README — '+posix.dirname(path):posix.basename(path));
const projection=(path:string,text:string,pt:boolean)=>`> Joinlet · ${pt?'Fonte':'Source'}: \`${path}\`. ${pt?'Projeção do arquivo do repositório. Alterações feitas aqui são preservadas para revisão; o arquivo original não é substituído.':'Repository file projection. Edits here are preserved for review; the original file is not replaced.'}\n\n${text}`;

/** Source Markdown stays authoritative. Projections have stable ids and a hash baseline, never a second copy of the source in state. */
export function projectRepositoryDocuments(files:Map<string,string>,input:WorkspaceData,previous:Partial<RepositoryKnowledge>|undefined,pt:boolean){
 let data={...input,manifest:{...input.manifest,docs:[...input.manifest.docs]},docs:{...input.docs}};const documents:Record<string,SourceDocument>={},pending:string[]=[];
 const old=previous?.documents??{},paths=[...files.keys()].filter(isRepositoryMarkdown).sort();
 const renamed=new Set<string>();
 for(const path of paths){
  const source=files.get(path)!,sourceHash=digest(source);
  let prior=old[path];
  if(!prior){const matches=Object.entries(old).filter(([was,d])=>!files.has(was)&&!renamed.has(was)&&d.sourceHash===sourceHash);if(matches.length===1){prior=matches[0]![1];renamed.add(matches[0]![0]);}}
  const title=sourceTitle(path,source),folder=sourceFolder(path,pt),body=projection(path,source,pt);
  let slug=prior?.slug;
  if(!slug){
   if(data.board.cards.length>=BOARD_MAX_ITEMS){pending.push('Repository document limit reached; some Markdown files were not imported.');continue;}
   const added=addItem(data,'doc',title,body);data=added.data;slug=added.slug;
  }
  const entry=data.manifest.docs.find(d=>d.slug===slug);
  if(!entry){documents[path]=prior!;pending.push(`Repository document was removed in the editor; projection preserved as deleted: ${path}`);continue;}
  if(!prior||digest(data.docs[slug]??'')===prior.hash)data.docs[slug]=body;
  else if(data.docs[slug]!==body)pending.push(`Repository document has manual changes; review its source projection: ${path}`);
  data.manifest.docs=data.manifest.docs.map(d=>d.slug!==slug?d:{...d,source:path,...(!prior||d.title===prior.title?{title}:{}),...(!prior||d.folder===prior.folder?{folder}:{})});
  documents[path]={slug,title,folder,hash:digest(body),sourceHash};
  // Keep the original base on a conflict, so an unrelated sync never adopts a manual edit as generated content.
  if(prior&&digest(data.docs[slug]??'')!==digest(body))documents[path]={...prior,sourceHash};
 }
 for(const [path,prior]of Object.entries(old))if(!files.has(path)&&!renamed.has(path)){documents[path]=prior;pending.push(`Repository document source is unavailable; existing projection kept: ${path}`);}
 return {data,documents,pending};
}

export function moduleReadme(fact:RepositoryFact,documents:Record<string,SourceDocument>){
 const root=fact.path==='.'?'':fact.path?fact.path+'/':null;
 if(root===null)return undefined;
 return Object.entries(documents).find(([path])=>posix.dirname(path)===(root?root.slice(0,-1):'.')&&/(?:^|\/)readme\.(?:md|markdown|mdx)$/i.test(path))?.[1].slug;
}

/** Only actual item links, Markdown links and the generated overview/document binding become board relationships. */
export function connectRepositoryKnowledge(input:WorkspaceData,documents:Record<string,SourceDocument>,previous:Partial<RepositoryKnowledge>|undefined,diagram:string,document:string,pt:boolean,readmePath?:string){
 const data={...input,board:{...input.board,connections:input.board.connections.map(c=>({...c}))}};data.board=reconcileBoard(data.board,data.manifest);
 const known=new Set(data.board.cards.map(c=>c.id)),desired:Record<string,BoardConnection>={},pending:string[]=[];
 const connect=(from:string,to:string,label:string)=>{if(from===to||!known.has(from)||!known.has(to))return;const pair=[from,to].sort();const id='repo_link_'+digest(pair.join('\0')).slice(0,16);desired[id]={id,from,to,label};};
 const resolve=(target:string,from?:string)=>{
  if(target.startsWith('doc:'))return itemCardId('doc',target.slice(4).split('#')[0]!);
  if(target.startsWith('diagram:'))return itemCardId('diagram',target.slice(8).split('#')[0]!);
  if(/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(target))return null;
  let path:string;try{path=posix.normalize(posix.join(from?posix.dirname(from):'.',decodeURIComponent(target.split(/[?#]/)[0]!)));}catch{return null;}
  if(documents[path])return itemCardId('doc',documents[path]!.slug);
  const arch=path.match(/(?:^|\/)\.arch\/(docs|diagrams)\/([^/]+)\.(?:md|strukt\.json)$/);
  return arch?itemCardId(arch[1]==='docs'?'doc':'diagram',arch[2]!):null;
 };
 connect(itemCardId('diagram',diagram),itemCardId('doc',document),pt?'Documentação':'Documentation');
 for(const [slug,snapshot]of Object.entries(data.diagrams))for(const el of Object.values(snapshot.model.elements)){
  if(!el.link)continue;const to=resolve(el.link);if(to)connect(itemCardId('diagram',slug),to,pt?'Referência':'Reference');
 }
 if(readmePath&&documents[readmePath])connect(itemCardId('diagram',diagram),itemCardId('doc',documents[readmePath]!.slug),pt?'Contexto do projeto':'Project context');
 const sourceOf=new Map(Object.entries(documents).map(([path,d])=>[d.slug,path]));
 for(const [slug,text]of Object.entries(data.docs))for(const target of markdownTargets(text)){const to=resolve(target,sourceOf.get(slug));if(to)connect(itemCardId('doc',slug),to,pt?'Referência':'Reference');}
 const old=previous?.connections??{};
 data.board.connections=data.board.connections.filter(c=>!old[c.id]||desired[c.id]||!same(c,old[c.id]));
 for(const candidate of Object.values(desired)){
  const current=data.board.connections.find(c=>c.id===candidate.id);
  if(current){if(same(current,old[current.id]))Object.assign(current,candidate);continue;}
  if(old[candidate.id])continue; // A person removed this generated relation.
  if(data.board.connections.some(c=>(c.from===candidate.from&&c.to===candidate.to)||(c.to===candidate.from&&c.from===candidate.to)))continue;
  if(data.board.connections.length>=BOARD_MAX_ITEMS){pending.push('Overview connection limit reached; some verified links were not added.');break;}
  data.board.connections.push(candidate);
 }
 return {data,connections:desired,pending};
}

/** Assign only generated items; changing an existing folder manually wins on later runs. */
export function organizeRepositoryItems(data:WorkspaceData,diagrams:string[],doc:string,previous:Partial<RepositoryKnowledge>|undefined,pt:boolean){
 const folders:Record<string,string>={},base=pt?'Arquitetura':'Architecture';
 for(const [kind,slugs]of [['diagram',diagrams],['doc',[doc]]] as const){const key=kind==='diagram'?'diagrams':'docs';data.manifest[key]=data.manifest[key].map(entry=>{if(!slugs.includes(entry.slug))return entry;const id=itemCardId(kind,entry.slug);folders[id]=base;return previous?.folders?.[id]!==undefined?entry.folder===previous.folders[id]?{...entry,folder:base}:entry:entry.folder?entry:{...entry,folder:base};});}
 return folders;
}
