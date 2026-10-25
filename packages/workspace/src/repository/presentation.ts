import { createHash } from 'node:crypto';
import { parseDiagramJson } from '@strukt/json';
import type { RepositoryConfig, RepositoryFact } from './contracts';
import { repositoryTechnology, technologySummary } from './technologies';

export { developmentSource } from './sourceKinds';
const groupId=(path:string)=>'repo_group_'+createHash('sha256').update(path).digest('hex').slice(0,14);
const groups:Record<string,[string,string]>={apps:['Aplicações','Applications'],packages:['Pacotes compartilhados','Shared packages'],services:['Serviços','Services'],src:['Código','Source'],tools:['Ferramentas','Tools']};

export function repositoryPresentation(facts:RepositoryFact[],config:RepositoryConfig,sourceLabels:Map<string,string>) {
  const libraries=facts.filter(f=>f.kind==='dependency');
  const modules=facts.filter(f=>f.kind!=='dependency');
  const edges=facts.reduce((n,f)=>n+f.dependencies.length,0);
  const mode=config.view==='modules'||(config.view!=='dependencies'&&(facts.length>24||edges>60))?'modules':'dependencies';
  const visible=mode==='modules'?modules:facts;
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
  const parsed=parseDiagramJson(JSON.stringify({version:1,style:{direction:'down',styleMode:'plain'},nodes,connections:ordered.flatMap(f=>f.dependencies.filter(d=>ids.has(d.target)).map(d=>({from:f.id,to:d.target,...(mode==='dependencies'?{label:'imports'}:{})})))}));
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
  const lines=[`## ${portuguese?'Dependências por módulo':'Dependencies by module'}`,'',portuguese?'Relações estáticas de imports do código. Bibliotecas não são, por si só, serviços da arquitetura. Imports exclusivos de testes, fixtures e configuração de build ficam fora deste mapa.':'Static code import relationships. A library alone does not establish an architectural service. Imports exclusive to tests, fixtures and build configuration are outside this map.',''];
  for(const fact of facts.filter(f=>f.kind!=='dependency').sort((a,b)=>(a.path??a.label).localeCompare(b.path??b.label))){
    lines.push(`### ${fact.label}`, '', ...(fact.path?[`\`${fact.path}\``,'']:[]));
    const dependencies=fact.dependencies.map(d=>byId.get(d.target)).filter((f):f is RepositoryFact=>!!f).sort((a,b)=>a.label.localeCompare(b.label));
    lines.push(...(dependencies.length?dependencies.map(d=>`- ${d.label}${d.path?' — `'+d.path+'`':''}`):[portuguese?'Sem imports externos ao módulo reconhecidos.':'No recognized imports outside the module.']),'');
  }
  return lines.join('\n');
}
