import { posix } from 'node:path';
import { digest } from './reader';
import { parseSource, type SyntaxResult } from './syntax';
import type { RepositoryFact, SourceRef, RepositoryDependency } from './contracts';
import { developmentSource } from './sourceKinds';
import { detectRepositoryTechnologies } from './technologies';
export const CODE = /\.(?:[cm]?[jt]sx?|py|java|go|rs|rb|php|cs|fs|c|h|cpp|swift|kts?|scala|vue|svelte|astro)$/i;
const idOf=(path:string)=>`repo_${digest(path).slice(0,14)}`;
const labelOf=(path:string)=>path==='.'?'Application':path.split('/').pop()!;
const reference=(path:string,text:string,needle?:string):SourceRef=>{const lines=text.split(/\r?\n/);const index=Math.max(0,lines.findIndex(l=>needle?l.includes(needle):!!l.trim()));return {path,line:index+1,contains:lines[index]!.trim().slice(0,400)};};
export function repositoryOwnership(files:Map<string,string>){
 const packages=new Map<string,string>();
 const roots=new Set<string>();
 for(const[path,text]of files){
  if(path.endsWith('package.json'))try{const pkg=JSON.parse(text);if(typeof pkg.name==='string'){packages.set(pkg.name,posix.dirname(path));roots.add(posix.dirname(path));}}catch{}
 }
 const ordered=[...roots].sort((a,b)=>b.length-a.length);
 const moduleFor=(path:string)=>{const root=ordered.find(r=>r!=='.'&&path.startsWith(r+'/'));if(root)return root;const parts=path.split('/');if(parts.length>2&&['src','app','lib','apps','packages','services'].includes(parts[0]!))return parts.slice(0,2).join('/');return parts.length>1&&!['src','lib'].includes(parts[0]!)?parts[0]!:'.';};
 return {packages,moduleFor};
}
const cache=new Map<string,SyntaxResult>();
export const productionDependency=(dependency:RepositoryDependency)=>dependency.scope!=='development'&&dependency.usage!=='type'&&dependency.usage!=='unknown';
export async function extractRepositoryFacts(files:Map<string,string>):Promise<RepositoryFact[]>{
 const {packages,moduleFor}=repositoryOwnership(files),facts=new Map<string,RepositoryFact>(),parsed=new Map<string,SyntaxResult>();
 const put=(key:string,label:string,ref:SourceRef)=>{let fact=facts.get(key);if(!fact){fact={id:idOf(key),label,kind:key.startsWith('dependency:')?'dependency':'module',...(!key.startsWith('dependency:')?{path:key}:{}),refs:[],dependencies:[]};facts.set(key,fact);}if(!fact.refs.some(r=>r.path===ref.path&&r.line===ref.line))fact.refs.push(ref);return fact;};
 for(const[name,dir]of packages){const text=files.get(posix.join(dir,'package.json'))!;const pkg=JSON.parse(text);if(!pkg.workspaces||pkg.main||pkg.bin||pkg.exports)put(dir,name,reference(posix.join(dir,'package.json'),text,'"name"'));}
 for(const[path,text]of files)if(CODE.test(path)){
  const key=path.split('.').at(-1)+':'+digest(text);let syntax=cache.get(key);
  if(!syntax){syntax=await parseSource(path,text);if(cache.size>=4096)cache.delete(cache.keys().next().value!);cache.set(key,syntax);}parsed.set(path,syntax);
  if(!developmentSource(path)&&text.trim())put(moduleFor(path),labelOf(moduleFor(path)),reference(path,text));
 }
 // Compiler manifests guide resolution without changing legacy module paths or IDs.
 const manifestRoot=(path:string,filename:string)=>[...files.keys()].filter(file=>posix.basename(file)===filename&&(posix.dirname(file)==='.'||path.startsWith(posix.dirname(file)+'/'))).sort((a,b)=>b.length-a.length)[0];
 const namespaces=new Map<string,Set<string>>();
 for(const[path,syntax]of parsed)for(const namespace of syntax.declarations){for(const name of [namespace,namespace+'.'+posix.basename(path,posix.extname(path))]){const owners=namespaces.get(name)??new Set<string>();owners.add(path);namespaces.set(name,owners);}}
 const candidates=(base:string)=>[base,...['.ts','.tsx','.js','.jsx','.mts','.cts','.mjs','.cjs','.py','.go','.rs','.rb','.php','.cs','.fs','.c','.h','.cpp','.java','.kt','.scala','.swift','.vue','.svelte','.astro','/index.ts','/index.tsx','/index.js','/__init__.py','/mod.rs'].map(ext=>base+ext)].filter(p=>files.has(p));
 for(const[path,syntax]of parsed){
  const key=moduleFor(path),current=facts.get(key);if(!current)continue;
  if(syntax.limitations.length)current.limitations=[...(current.limitations??[]),...syntax.limitations.map(message=>`${path}: ${message}`)];
  for(const entry of syntax.imports){
   const ref={path,line:entry.line,contains:entry.contains},scope=developmentSource(path)?'development' as const:'production' as const;
   const unresolved=()=>{current.unresolved??=[];current.unresolved.push({name:entry.name,ref,usage:entry.usage,scope});};
   const name=entry.name;let targetKey:string|undefined;
   const builtin=/\.rs$/.test(path)&&/^(?:std|core|alloc)(?:::|$)/.test(name)||name.startsWith('node:')||name==='bun'||name.startsWith('bun:')||/\.py$/.test(path)&&/^(?:pathlib|typing|collections|asyncio|dataclasses|unittest|sys|os|json|re|math)(?:\.|$)/.test(name);
   if(builtin)continue;
   let targets:string[]=[];
   if(/\.py$/.test(path)&&name.startsWith('.')){const dots=name.match(/^\.+/)![0].length;targets=candidates(posix.join(posix.dirname(path),...Array(dots-1).fill('..'),name.slice(dots).replace(/\./g,'/')));}
   else if(name.startsWith('.')||entry.local&&!name.includes('::'))targets=candidates(posix.normalize(posix.join(posix.dirname(path),name)));
   else if(/\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/.test(path)){const dependency=name.startsWith('@')?name.split('/').slice(0,2).join('/'):name.split('/')[0]!;targetKey=packages.get(dependency)??`dependency:${dependency}`;}
   else if(/\.py$/.test(path)){const relative=name.replace(/\./g,'/');targets=[...new Set([...candidates(relative),...candidates(posix.join(key,relative)),...candidates(posix.join(posix.dirname(manifestRoot(path,'pyproject.toml')??posix.join(key,'pyproject.toml')),relative)),...candidates(posix.join(posix.dirname(manifestRoot(path,'pyproject.toml')??posix.join(key,'pyproject.toml')),'src',relative))])];if(!targets.length)targetKey=`dependency:${name.split('.')[0]}`;}
   else if(/\.rs$/.test(path)){const relative=name.replace(/^(?:crate|self|super)::/,'').split('::')[0]!;targets=candidates(posix.join(name.startsWith('crate::')?posix.join(posix.dirname(manifestRoot(path,'Cargo.toml')??posix.join(key,'Cargo.toml')),'src'):name.startsWith('super::')?posix.dirname(posix.dirname(path)):posix.dirname(path),relative));if(!targets.length&&!/^(?:crate|self|super)::/.test(name))targetKey=`dependency:${name.split('::')[0]}`;}
   else if(/\.go$/.test(path)){const manifestPath=manifestRoot(path,'go.mod')??posix.join(key,'go.mod'),manifest=files.get(manifestPath),root=posix.dirname(manifestPath);const module=manifest?.match(/^module\s+(\S+)/m)?.[1];if(module&&name.startsWith(module+'/'))targets=[...files.keys()].filter(p=>p.startsWith(posix.join(root,name.slice(module.length+1))+'/')&&p.endsWith('.go'));else targetKey=`dependency:${name}`;}
   else if(/\.rb$/.test(path))targetKey=`dependency:${name}`;
   else {const normalized=name.replace(/\\/g,'.');const match=[...namespaces.keys()].filter(ns=>normalized===ns||normalized.startsWith(ns+'.')).sort((a,b)=>b.length-a.length)[0];if(match)targets=[...namespaces.get(match)!];}
   if(targets.length){const owners=[...new Set(targets.map(moduleFor))];if(owners.length===1){targetKey=owners[0];const target=targets[0]!;put(targetKey!,labelOf(targetKey!),reference(target,files.get(target)!));}else {unresolved();continue;}}
   if(!targetKey){unresolved();continue;}
   if(targetKey===key)continue;
   let target=facts.get(targetKey);
   if(targetKey.startsWith('dependency:'))target=put(targetKey,targetKey.slice(11),ref);
   else if(!target){const own=[...files].find(([file])=>moduleFor(file)===targetKey&&(CODE.test(file)||file.endsWith('/package.json')||file==='package.json'));if(own)target=put(targetKey,labelOf(targetKey),reference(own[0],own[1]));}
   if(!target){unresolved();continue;}
   if(!current.dependencies.some(d=>d.target===target.id&&d.usage===entry.usage&&d.scope===scope))current.dependencies.push({target:target.id,ref,usage:entry.usage,scope});
  }
 }
 // Technologies use the same parsed declarations. Development/type-only imports do not define runtime identity.
 return detectRepositoryTechnologies([...facts.values()],files,moduleFor,parsed).map(f=>({...f,refs:f.refs.sort((a,b)=>a.path.localeCompare(b.path)||a.line-b.line).slice(0,20),dependencies:f.dependencies.sort((a,b)=>a.target.localeCompare(b.target)||(a.usage??'').localeCompare(b.usage??''))})).sort((a,b)=>a.id.localeCompare(b.id));
}
