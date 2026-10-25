import { createHash } from 'node:crypto';
import { parseDiagramJson } from '@strukt/json';
import type { RepositoryConfig, RepositoryFact } from './contracts';
import { repositoryTechnology, technologySummary } from './technologies';
const production=(d:RepositoryFact['dependencies'][number])=>d.scope!=='development'&&d.usage!=='type'&&d.usage!=='unknown';

export { developmentSource } from './sourceKinds';
const groupId=(path:string)=>'repo_group_'+createHash('sha256').update(path).digest('hex').slice(0,14);
const groups:Record<string,[string,string]>={apps:['Aplicações','Applications'],packages:['Pacotes compartilhados','Shared packages'],services:['Serviços','Services'],src:['Código','Source'],tools:['Ferramentas','Tools']};

export function repositoryPresentation(facts:RepositoryFact[],config:RepositoryConfig,sourceLabels:Map<string,string>) {
  const referenced=new Set(facts.flatMap(f=>f.dependencies.filter(production).map(d=>d.target)));
  const libraries=facts.filter(f=>f.kind==='dependency'&&referenced.has(f.id));
  const modules=facts.filter(f=>f.kind!=='dependency');
  const edges=facts.reduce((n,f)=>n+f.dependencies.length,0);
  const mode=config.view==='modules'||(config.view!=='dependencies'&&(facts.length>24||edges>60))?'modules':'dependencies';
  const visible=mode==='modules'?modules:[...modules,...libraries];
  const ids=new Set(visible.map(f=>f.id));
  const ordered=[...visible].sort((a,b)=>(a.path??a.label).localeCompare(b.path??b.label));
  const folders=new Map<string,RepositoryFact[]>();
  if(mode==='modules')for(const fact of ordered){
    const folder=fact.path?.includes('/')?fact.path.split('/')[0]:undefined;
    if(folder)folders.set(folder,[...(folders.get(folder)??[]),fact]);
  }
  const grouped=new Map([...folders].filter(([,members])=>members.length>1));
  const makeNode=(fact:RepositoryFact)=>{
    const short=fact.kind==='module'&&fact.path&&fact.path!=='.'&&sourceLabels.get(fact.id)===fact.label?fact.path.split('/').at(-1)!:fact.label;
    const stack=technologySummary(fact),icon=repositoryTechnology(fact.primaryTechnology)?.icon??(fact.kind==='dependency'?'plug':'layers');
    return {id:fact.id,label:mode==='modules'?short:fact.label,tech:stack||(mode==='modules'?fact.path:fact.tech),icon,presentation:'card',description:[fact.label,fact.path,technologySummary(fact,Infinity)].filter(Boolean).join(' · ')};
  };
  const nodes:unknown[]=[];
  for(const [folder,members]of grouped)nodes.push({id:groupId(folder),type:'group',label:(groups[folder]?.[config.locale==='pt-BR'?0:1]??folder)+' · '+folder,icon:'folder',children:members.map(makeNode)});
  for(const fact of ordered)if(!fact.path||!grouped.has(fact.path.split('/')[0]!))nodes.push(makeNode(fact));
  const parsed=parseDiagramJson(JSON.stringify({version:1,style:{direction:'down',styleMode:'plain'},nodes,connections:ordered.flatMap(f=>f.dependencies.filter((d,i,list)=>production(d)&&ids.has(d.target)&&list.findIndex(other=>other.target===d.target&&production(other))===i).map(d=>({from:f.id,to:d.target,...(mode==='dependencies'?{label:'imports'}:{})})))}));
  if(parsed.diagnostics.some(d=>d.severity==='error'))throw Error('Repository extraction produced an invalid model.');
  return {model:parsed.model,mode:mode as 'modules'|'dependencies',modules,libraries};
}

/** Prefer the repository README; nested extension/package READMEs never replace the project introduction. */
export function repositoryReadme(texts:Map<string,string>) {
  const candidates=[...texts].filter(([path])=>/(^|\/)readme(?:\.[^/]*)?$/i.test(path));
  candidates.sort(([a],[b])=>a.split('/').length-b.split('/').length||Number(!/^readme\.md$/i.test(a))-Number(!/^readme\.md$/i.test(b))||a.localeCompare(b));
  const readme=candidates[0];
  const overview=readme?.[1].split(/\n\s*\n/).filter(p=>p.trim()&&!/^\s*(?:#|<|!\[|\[!\[|```|~~~|\||[-*+]\s|\d+\.\s|>)/.test(p)).slice(0,2).join('\n\n').slice(0,2500);
  return {readme,overview};
}

export function dependencyDocumentation(facts:RepositoryFact[],portuguese:boolean) {
  const byId=new Map(facts.map(f=>[f.id,f]));
  const lines=[`## ${portuguese?'Dependências por módulo':'Dependencies by module'}`,'',portuguese?'Relações estáticas de imports do código. Bibliotecas não são, por si só, serviços da arquitetura. Tipos e imports exclusivos de testes, fixtures e configuração de build ficam fora do mapa principal; estão separados abaixo.':'Static code import relationships. A library alone does not establish an architectural service. Type-only, test, fixture and build imports are outside the main map and listed separately below.',''];
  for(const fact of facts.filter(f=>f.kind!=='dependency').sort((a,b)=>(a.path??a.label).localeCompare(b.path??b.label))){
    lines.push(`### ${fact.label}`, '', ...(fact.path?[`\`${fact.path}\``,'']:[]));
    for(const [title,filter] of [
      [portuguese?'Produção (imports estáticos)':'Production (static imports)',production],
      [portuguese?'Tipos':'Types',(d:RepositoryFact['dependencies'][number])=>d.scope!=='development'&&d.usage==='type'],
      [portuguese?'Desenvolvimento':'Development',(d:RepositoryFact['dependencies'][number])=>d.scope==='development'],
    ] as const){
      const dependencies=fact.dependencies.filter(filter).map(d=>({fact:byId.get(d.target),ref:d.ref})).filter(d=>!!d.fact).sort((a,b)=>a.fact!.label.localeCompare(b.fact!.label));
      if(dependencies.length)lines.push(`#### ${title}`,'',...dependencies.map(d=>`- ${d.fact!.label}${d.fact!.path?' — `'+d.fact!.path+'`':''} — `+ '`'+d.ref.path+':'+d.ref.line+'`'),'');
    }
    if(!fact.dependencies.length)lines.push(portuguese?'Sem imports externos ao módulo reconhecidos.':'No recognized imports outside the module.','');
    if(fact.unresolved?.length)lines.push(`#### ${portuguese?'Referências não resolvidas':'Unresolved references'}`,'',...fact.unresolved.map(r=>`- ${r.name} — `+'`'+r.ref.path+':'+r.ref.line+'`'),'');
    if(fact.limitations?.length)lines.push(`#### ${portuguese?'Limitações sintáticas':'Syntax limitations'}`,'',...fact.limitations.map(l=>'- '+l),'');

  }
  return lines.join('\n');
}
