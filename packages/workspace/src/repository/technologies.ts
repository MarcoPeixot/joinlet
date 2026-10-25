import type { RepositoryFact, SourceRef } from './contracts';
import { developmentSource } from './sourceKinds';

interface TechnologyDefinition { id:string; name:string; icon:string; priority:number; packages?:string[]; extensions?:string[]; development?:boolean }
/** Browser-safe, bounded catalogue. Icon names resolve through the editor's existing bundled registry. */
export const REPOSITORY_TECHNOLOGIES:readonly TechnologyDefinition[] = [
  {id:'nextjs',name:'Next.js',icon:'si:nextdotjs',priority:110,packages:['next']},
  {id:'nuxt',name:'Nuxt',icon:'si:nuxt',priority:110,packages:['nuxt']},
  {id:'react',name:'React',icon:'si:react',priority:100,packages:['react','react-dom','react-native']},
  {id:'vue',name:'Vue',icon:'si:vuedotjs',priority:100,packages:['vue'],extensions:['vue']},
  {id:'svelte',name:'Svelte',icon:'si:svelte',priority:100,packages:['svelte','@sveltejs/kit'],extensions:['svelte']},
  {id:'angular',name:'Angular',icon:'si:angular',priority:100,packages:['@angular/core']},
  {id:'astro',name:'Astro',icon:'si:astro',priority:110,packages:['astro'],extensions:['astro']},
  {id:'nestjs',name:'NestJS',icon:'si:nestjs',priority:110,packages:['@nestjs/core','@nestjs/common']},
  {id:'hono',name:'Hono',icon:'si:hono',priority:100,packages:['hono']},
  {id:'express',name:'Express',icon:'si:express',priority:100,packages:['express']},
  {id:'fastify',name:'Fastify',icon:'si:fastify',priority:100,packages:['fastify']},
  {id:'django',name:'Django',icon:'si:django',priority:100,packages:['django','Django']},
  {id:'fastapi',name:'FastAPI',icon:'si:fastapi',priority:100,packages:['fastapi']},
  {id:'flask',name:'Flask',icon:'si:flask',priority:100,packages:['flask','Flask']},
  {id:'electron',name:'Electron',icon:'si:electron',priority:110,packages:['electron']},
  {id:'tauri',name:'Tauri',icon:'si:tauri',priority:110,packages:['@tauri-apps/api']},
  {id:'mcp',name:'MCP',icon:'si:modelcontextprotocol',priority:60,packages:['@modelcontextprotocol/sdk','mcp']},
  {id:'typescript',name:'TypeScript',icon:'si:typescript',priority:50,packages:['typescript'],extensions:['ts','tsx','mts','cts'],development:true},
  {id:'javascript',name:'JavaScript',icon:'si:javascript',priority:50,extensions:['js','jsx','mjs','cjs']},
  {id:'python',name:'Python',icon:'si:python',priority:50,extensions:['py']},
  {id:'go',name:'Go',icon:'si:go',priority:50,extensions:['go']},
  {id:'rust',name:'Rust',icon:'si:rust',priority:50,extensions:['rs']},
  {id:'java',name:'Java',icon:'si:openjdk',priority:50,extensions:['java']},
  {id:'kotlin',name:'Kotlin',icon:'si:kotlin',priority:50,extensions:['kt','kts']},
  {id:'swift',name:'Swift',icon:'si:swift',priority:50,extensions:['swift']},
  {id:'ruby',name:'Ruby',icon:'si:ruby',priority:50,extensions:['rb']},
  {id:'php',name:'PHP',icon:'si:php',priority:50,extensions:['php']},
  {id:'dotnet',name:'.NET',icon:'si:dotnet',priority:50,extensions:['cs','fs']},
  {id:'bun',name:'Bun',icon:'si:bun',priority:30},
  {id:'nodejs',name:'Node.js',icon:'si:nodedotjs',priority:25},
  {id:'docker',name:'Docker',icon:'si:docker',priority:20},
  {id:'terraform',name:'Terraform',icon:'si:terraform',priority:50,extensions:['tf']},
  {id:'kubernetes',name:'Kubernetes',icon:'si:kubernetes',priority:50},
  {id:'openapi',name:'OpenAPI',icon:'plug',priority:50},
  {id:'redis',name:'Redis',icon:'si:redis',priority:10,packages:['redis','ioredis']},
  {id:'postgresql',name:'PostgreSQL',icon:'si:postgresql',priority:10,packages:['pg','postgres','psycopg','psycopg2','asyncpg']},
  {id:'mysql',name:'MySQL',icon:'si:mysql',priority:10,packages:['mysql','mysql2']},
  {id:'mongodb',name:'MongoDB',icon:'si:mongodb',priority:10,packages:['mongodb','mongoose','pymongo']},
  {id:'sqlite',name:'SQLite',icon:'si:sqlite',priority:10,packages:['sqlite3','better-sqlite3','sqlite']},
  {id:'graphql',name:'GraphQL',icon:'si:graphql',priority:10,packages:['graphql','@apollo/client','@apollo/server']},
  {id:'prisma',name:'Prisma',icon:'si:prisma',priority:10,packages:['@prisma/client']},
  {id:'vite',name:'Vite',icon:'si:vite',priority:5,packages:['vite'],development:true},
  {id:'tailwindcss',name:'Tailwind CSS',icon:'si:tailwindcss',priority:5,packages:['tailwindcss'],development:true},
];
const definitions=new Map(REPOSITORY_TECHNOLOGIES.map(t=>[t.id,t]));
const packages=new Map(REPOSITORY_TECHNOLOGIES.flatMap(t=>(t.packages??[]).map(name=>[name,t] as const)));
const extensions=new Map(REPOSITORY_TECHNOLOGIES.flatMap(t=>(t.extensions??[]).map(ext=>[ext,t] as const)));
export const repositoryTechnology=(id:string|undefined)=>id?definitions.get(id):undefined;
const uniqueRefs=(refs:SourceRef[])=>[...new Map(refs.map(ref=>[ref.path+'\0'+ref.line,ref])).values()].sort((a,b)=>a.path.localeCompare(b.path)||a.line-b.line).slice(0,5);

/** Reuses the inventory and parsed import facts. No filesystem reads, network calls or directory-name guesses. */
export function detectRepositoryTechnologies(facts:RepositoryFact[],files:Map<string,string>,moduleFor:(path:string)=>string) {
  const byPath=new Map(facts.filter(f=>f.path!==undefined).map(f=>[f.path!,f]));
  const byId=new Map(facts.map(f=>[f.id,f]));
  const sourceCounts=new Map<string,Map<string,number>>();
  const add=(fact:RepositoryFact,id:string,ref:SourceRef)=>{
    if(!definitions.has(id))return;
    fact.technologies??=[];let technology=fact.technologies.find(t=>t.id===id);
    if(!technology){technology={id,refs:[]};fact.technologies.push(technology);}
    technology.refs=uniqueRefs([...technology.refs,ref]);
  };
  for(const fact of facts){
    const library=fact.kind==='dependency'?packages.get(fact.label):undefined;
    if(library)for(const ref of fact.refs)add(fact,library.id,ref);
    if(!fact.path){const definition=REPOSITORY_TECHNOLOGIES.find(t=>t.name===fact.tech);if(definition)for(const ref of fact.refs)add(fact,definition.id,ref);}
    for(const dependency of fact.dependencies){const target=byId.get(dependency.target);const technology=target?.kind==='dependency'?packages.get(target.label):undefined;if(technology)add(fact,technology.id,dependency.ref);}
  }
  for(const [path,text]of files){
    const fact=byPath.get(moduleFor(path));if(!fact)continue;
    const extension=path.split('.').at(-1)!.toLowerCase(),language=extensions.get(extension);
    const manifest=path.endsWith('package.json'),tsconfig=/(?:^|\/)tsconfig(?:\.[^/]*)?\.json$/.test(path),dockerfile=/(?:^|\/)Dockerfile(?:\.[^/]*)?$/.test(path);
    if(!language&&!manifest&&!tsconfig&&!dockerfile)continue;
    const lines=text.split(/\r?\n/),first=lines.findIndex(line=>line.trim().length>0);
    if(first<0)continue;
    const ref=(needle?:string):SourceRef=>{const index=needle?lines.findIndex(line=>line.includes(needle)):first;return {path,line:Math.max(0,index)+1,contains:lines[Math.max(0,index)]!.trim().slice(0,400)};};
    if(!developmentSource(path)){
      if(language){add(fact,language.id,ref());const counts=sourceCounts.get(fact.id)??new Map<string,number>();counts.set(language.id,(counts.get(language.id)??0)+1);sourceCounts.set(fact.id,counts);}
      if(/^[cm]?[jt]sx?$/.test(extension))for(let i=0;i<lines.length;i++){
        const match=lines[i]!.match(/^\s*(?:import\s+(?:.*?\s+from\s+)?|export\s+.*?\s+from\s+)["'](bun(?::[^"']+)?|node:[^"']+)["']/);
        if(match)add(fact,match[1]!.startsWith('bun')?'bun':'nodejs',{path,line:i+1,contains:lines[i]!.trim().slice(0,400)});
        if(match?.[1]==='bun:sqlite')add(fact,'sqlite',{path,line:i+1,contains:lines[i]!.trim().slice(0,400)});
      }
      if(dockerfile)add(fact,'docker',ref());
    }
    if(tsconfig)add(fact,'typescript',ref());
    if(manifest)try{
      const pkg=JSON.parse(text);
      for(const field of ['dependencies','peerDependencies','optionalDependencies','devDependencies']){
        for(const name of Object.keys(pkg[field]??{})){const technology=packages.get(name);if(technology&&(field!=='devDependencies'||technology.development))add(fact,technology.id,ref('"'+name+'"'));}
      }
      if(typeof pkg.engines?.node==='string')add(fact,'nodejs',ref('"node"'));
      if(typeof pkg.engines?.bun==='string')add(fact,'bun',ref('"bun"'));
    }catch{/* Broken manifests stay available for review; no guessed technology. */}
  }
  for(const fact of facts){
    const counts=sourceCounts.get(fact.id);
    fact.technologies?.sort((a,b)=>definitions.get(b.id)!.priority-definitions.get(a.id)!.priority||(counts?.get(b.id)??0)-(counts?.get(a.id)??0)||b.refs.length-a.refs.length||a.id.localeCompare(b.id));
    if(fact.technologies?.length){fact.primaryTechnology=fact.technologies[0]!.id;fact.refs=uniqueTechnologyRefs(fact);}
  }
  return facts;
}

export function uniqueTechnologyRefs(fact:RepositoryFact):SourceRef[]{return [...new Map([...(fact.technologies??[]).flatMap(t=>t.refs),...fact.refs].map(ref=>[ref.path+'\0'+ref.line,ref])).values()].slice(0,20);}
export function technologySummary(fact:RepositoryFact,limit=2){
  const language=fact.technologies?.find(t=>t.id!==fact.primaryTechnology&&repositoryTechnology(t.id)?.priority===50&&repositoryTechnology(t.id)?.extensions?.length);
  const ids=[fact.primaryTechnology,language?.id,...(fact.technologies??[]).map(t=>t.id)];
  return [...new Set(ids)].map(repositoryTechnology).filter(t=>!!t).slice(0,limit).map(t=>t.name).join(' · ');
}

export function technologyDocumentation(facts:RepositoryFact[],portuguese:boolean){
  const modules=facts.filter(f=>f.kind!=='dependency'&&f.technologies?.length).sort((a,b)=>(a.path??a.label).localeCompare(b.path??b.label));
  if(!modules.length)return '';
  return [`## ${portuguese?'Tecnologias identificadas':'Detected technologies'}`,'',portuguese?'Identificadas por manifestos, imports e tipos de arquivo no próprio módulo. O ícone destaca a tecnologia principal; dependências de dados não comprovam a existência de serviços em execução.':'Identified from module manifests, imports and file types. The icon highlights the primary technology; data dependencies do not prove that a deployed service exists.','',...modules.flatMap(f=>[`### ${f.label}${f.path?' — `'+f.path+'`':''}`,'',...f.technologies!.map(t=>`- **${repositoryTechnology(t.id)!.name}**${t.id===f.primaryTechnology?(portuguese?' (ícone)':' (icon)'):''}: ${t.refs.map(r=>'`'+r.path+':'+r.line+'`').join(', ')}`),''])].join('\n')+'\n';
}
