import { compareModels } from '@strukt/core';
import { parseDiagramJson } from '@strukt/json';
import { createMemoryAdapter } from '../storage';
import type { StorageAdapter } from '../storage';
import type { RepositoryAnalyzer, RepositoryReader } from './contracts';
import { RepositoryEngine, readRepositoryConfig } from './engine';
import { REPOSITORY_CONFIG, REPOSITORY_STATE } from './contracts';
import { loadWorkspace } from '../workspace';
import { architectureContract } from '../implementationPlan';

/** No mutation: inspect both the incoming source changes and outgoing desired architecture. */
export async function inspectRepository(reader: RepositoryReader, adapter: StorageAdapter, analyzer?: RepositoryAnalyzer) {
  const config=readRepositoryConfig(await adapter.read(REPOSITORY_CONFIG));
  const files=Object.fromEntries(await Promise.all((await adapter.list()).map(async path=>[path,await adapter.read(path)] as const)));
  const current=await loadWorkspace(createMemoryAdapter(Object.fromEntries(Object.entries(files).filter((entry):entry is [string,string]=>entry[1]!==null))));
  const result=await new RepositoryEngine(reader,adapter,analyzer).run({check:true});
  const source=parseDiagramJson(JSON.stringify(JSON.parse(result.files[REPOSITORY_STATE]!).base)).model;
  const desired=current?.data.diagrams[config.diagram]?.model;
  const differences=desired?compareModels(architectureContract(source),architectureContract(desired)):null;
  const reviewRequired=!!differences&&(Object.values(differences.elements).some(a=>a.length)||Object.values(differences.edges).some(a=>a.length));
  return {status:result.status,changed:result.changed,configured:true,writesCode:false,coverage:'partial',sourceToDiagramPending:result.changed.length>0,reviewRequired,sourceToDesiredArchitecture:differences,documents:current?.data.manifest.docs??[],nextSteps:['Review source evidence and pending proposals.','Implement intended code changes with the coding agent; diagram edits do not write application code.','Run joinlet sync, context, project tests and verify --strict.']};
}
