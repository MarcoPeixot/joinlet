import {stableStringify} from '@strukt/workspace';
import { checkProposal, planSnapshot } from '@strukt/ops';
import { createMemoryAdapter, contextFiles, loadWorkspace, workspaceFiles, withSnippet } from '@strukt/workspace';
import type { StorageAdapter } from '@strukt/workspace';
import type { RepositoryProposal, RepositoryReader } from '@strukt/workspace/repository-contracts';
import { writeBatch } from '@strukt/workspace/repository-transaction';

/** Human approval still revalidates the source anchors and current diagram before writing. */
export async function applyRepositoryProposal(adapter: StorageAdapter, reader: RepositoryReader, proposal: RepositoryProposal) {
  await reader.list();
  const revision=await reader.revision();
  if(proposal.revision&&proposal.revision!==revision)throw Error('Repository revision changed; analyze the current revision before applying this proposal.');
  if(!proposal.ops.length)throw Error('This proposal needs an agent to supply explicit diagram operations.');
  const refs=[];
  for(const ref of proposal.refs){const text=await reader.read(ref.path);if(!text||!text.split(/\r?\n/)[ref.line-1]?.includes(ref.contains))throw Error('Proposal evidence changed; analyze the current revision again.');refs.push(withSnippet(ref,text));}
  const captured=Object.fromEntries(await Promise.all((await adapter.list()).map(async path=>[path,await adapter.read(path)] as const)));
  const state=JSON.parse(captured['repository-state.json']??'{}');
  const expected=state.proposals?.find((entry:RepositoryProposal)=>entry.id===proposal.id);
  if(!expected||stableStringify(expected)!==stableStringify(proposal))throw Error('Proposal changed or was already resolved; refresh the review.');
  const loaded=await loadWorkspace(createMemoryAdapter(Object.fromEntries(Object.entries(captured).filter((entry):entry is [string,string]=>entry[1]!==null))));if(!loaded||loaded.warnings.length)throw Error('Workspace needs repair before reviewing proposals.');
  const config=JSON.parse(captured['repository.json']??'{}') as {diagram?:string},slug=config.diagram??'repository',snapshot=loaded.data.diagrams[slug];if(!snapshot)throw Error('Managed diagram is missing.');
  const checked=checkProposal({ops:proposal.ops,summary:proposal.summary},'edit',snapshot.model);if(!checked.ok)throw Error(checked.error);
  const plan=planSnapshot(snapshot.model,snapshot.layout,checked.ops);if(!plan.ok)throw Error(plan.error);
  const data={...loaded.data,diagrams:{...loaded.data.diagrams,[slug]:{model:plan.planned.model,layout:plan.planned.layout}},evidence:structuredClone(loaded.data.evidence??{})};
  data.evidence[slug]??={};
  for(const op of checked.ops)if('id'in op&&typeof op.id==='string'&&data.diagrams[slug]!.model.elements[op.id])data.evidence[slug]![op.id]=refs;
  const files:Record<string,string>={...workspaceFiles(data),...contextFiles(data)},changes=[];
  if(captured['repository-state.json']){const state=JSON.parse(captured['repository-state.json']);state.proposals=(state.proposals??[]).filter((p:RepositoryProposal)=>p.id!==proposal.id);files['repository-state.json']=JSON.stringify(state,null,2)+'\n';}
  for(const[path,text]of Object.entries(files)){const expected=captured[path]??null;if(expected!==text)changes.push({path,text,expected});}
  await reader.list();if(await reader.revision()!==revision)throw Error('Repository revision changed while reviewing the proposal.');
  await writeBatch(adapter,changes);return changes.map(c=>c.path);
}

export async function discardRepositoryProposal(adapter:StorageAdapter,id:string) {
 const path='repository-state.json',expected=await adapter.read(path);if(!expected)return;
 const state=JSON.parse(expected);state.proposals=(state.proposals??[]).filter((p:RepositoryProposal)=>p.id!==id);
 await writeBatch(adapter,[{path,expected,text:JSON.stringify(state,null,2)+'\n'}]);
}
