import { autoLayout } from '@strukt/layout';
import { importArchitecture } from '@strukt/dsl/import';
import type { SourceKind, Source } from '../sources';
import { parseSources, printSources, matchesInclude } from '../sources';
import { parseSyncState, printSyncState } from '../syncState';
import { printDiagramJson } from '@strukt/json';
import { addItem } from '../workspace';
import type { WorkspaceData } from '../workspace';
import { mergeIntoDiagram } from '../syncMerge';
import { applyOps } from '@strukt/core';

/** Discover only formats with a matching importer; arbitrary YAML is not treated as Kubernetes. */
export async function synchronizeDiscoveredSources(texts: Map<string,string>, data: WorkspaceData, before: Map<string,string|null>) {
  const discovered=new Map<SourceKind,string[]>();
  for(const [path,text]of texts){
    let kind:SourceKind|undefined;
    if(/\.tf$/.test(path))kind='terraform';
    else if(/\.d2$/.test(path))kind='d2';
    else if(/\.(mmd|mermaid)$/.test(path))kind='mermaid';
    else if(/\.(likec4|c4)$/.test(path))kind='likec4';
    else if(/\.dsl$/.test(path)&&/\bworkspace\s*\{/.test(text))kind='structurizr';
    else if(/\.(json|ya?ml)$/.test(path)&&/^[\s{]*(?:["']?openapi["']?\s*:)/m.test(text))kind='openapi';
    else if(/\.ya?ml$/.test(path)&&/^apiVersion:\s*\S+/m.test(text)&&/^kind:\s*\S+/m.test(text))kind='kubernetes';
    if(kind)discovered.set(kind,[...(discovered.get(kind)??[]),path]);
  }
  const configured=parseSources(before.get('sources.json')??null);
  if(configured.diagnostics.length)throw Error('Source mappings need repair before repository synchronization.');
  const sources=[...configured.sources];
  for(const [kind,paths]of discovered){
    const missing=paths.filter(path=>!sources.some(s=>s.kind===kind&&matchesInclude(s.include,path)));
    if(!missing.length)continue;
    if(kind==='openapi') {
      for(const path of missing){
        let id='repository-openapi-'+path.replace(/[^a-zA-Z0-9_-]/g,'-').toLowerCase();
        const prefix=id;let n=2;while(sources.some(source=>source.id===id))id=prefix+'-'+n++;
        sources.push({id,kind,diagram:id,mode:'merge',include:[path]});
      }
      continue;
    }
    const id=`repository-${kind}`;
    const current=sources.find(s=>s.id===id);
    if(current){current.include=[...new Set([...current.include,...missing])].sort();continue;}
    sources.push({id,kind,diagram:id,mode:'merge',include:missing.sort()});
  }
  const state=parseSyncState(before.get('sync.json')??null);
  if(state.warnings.length)throw Error('Source synchronization baseline needs repair.');
  const pending:string[]=[];
  for(const source of sources){
    const matches=[...texts].filter(([path])=>matchesInclude(source.include,path));
    if(!matches.length){pending.push(`No files matched source ${source.id}.`);continue;}
    const groups=source.kind==='openapi'?matches.map(([,text])=>text):[matches.map(([,text])=>text).join(source.kind==='kubernetes'?'\n---\n':'\n')];
    // OpenAPI sources are registered per file in normal use; avoid merging unrelated ids without review.
    if(groups.length>1){pending.push(`Source ${source.id} has multiple OpenAPI files; split its mapping for review.`);continue;}
    const imported=importArchitecture(groups[0]!,source.kind);
    if(!imported.model.order.length&&imported.diagnostics.length){pending.push(`Importer could not analyze ${source.id}.`);continue;}
    if(!data.diagrams[source.diagram]){
      const item=addItem(data,'diagram',source.diagram);data=item.data;
      if(item.slug!==source.diagram)throw Error('Source diagram name conflicts with an existing item.');
    }
    const snapshot=data.diagrams[source.diagram]!,base=state.state.sources[source.id]?.base;
    const merged=mergeIntoDiagram(snapshot.model,imported.model,base,source.mode),applied=applyOps(snapshot.model,merged.ops);
    if(!applied.ok)throw Error(applied.error.message);
    pending.push(...merged.notes.map(note=>note.message));
    const nodes=Object.keys(snapshot.layout.nodes).length?{...snapshot.layout.nodes}:await autoLayout(applied.model);let i=0;
    for(const id of applied.model.order)if(!nodes[id]){nodes[id]={x:(i%4)*300,y:Math.floor(i/4)*180};i++;}
    data={...data,diagrams:{...data.diagrams,[source.diagram]:{model:applied.model,layout:{...snapshot.layout,nodes}}}};
    state.state.sources[source.id]={diagram:source.diagram,base:imported.model};
  }
  const files:Record<string,string>={};if(sources.length){files['sources.json']=printSources(sources);files['sync.json']=printSyncState(state.state);}
  return {data,files,pending};
}
