import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createFsAdapter } from '../fs';
import { withKnowledgeHarness } from '../agentHarness';
import { writeBatch } from './transaction';

export const AGENT_INSTRUCTION_FILES = ['AGENTS.md','CLAUDE.md'] as const;
export function agentInstructionText(current: string | null): string | null {
  const text=current??'# Project instructions\n';
  const starts=text.split('<!-- joinlet:knowledge-harness:start -->').length-1;
  const ends=text.split('<!-- joinlet:knowledge-harness:end -->').length-1;
  if(starts!==ends||starts>1||text.indexOf('<!-- joinlet:knowledge-harness:end -->')<text.indexOf('<!-- joinlet:knowledge-harness:start -->'))return null;
  return withKnowledgeHarness(text);
}

/** Updates only the marked Joinlet block in authorized root files; never creates IDE credentials. */
export async function syncAgentInstructions(root: string) {
  const storage=createFsAdapter(root),changes=[],conflicts:string[]=[];
  await storage.recover();
  for(const path of AGENT_INSTRUCTION_FILES) {
    try {
      const info=await lstat(join(root,path)).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
      if(info && (!info.isFile()||info.size>2_000_000)){conflicts.push(path);continue;}
      const expected=await storage.read(path),text=agentInstructionText(expected);
      if(text===null){conflicts.push(path);continue;}
      if(text!==expected)changes.push({path,text,expected});
    }catch{conflicts.push(path);}
  }
  await writeBatch(storage,changes);
  return {changed:changes.map(c=>c.path),conflicts};
}
