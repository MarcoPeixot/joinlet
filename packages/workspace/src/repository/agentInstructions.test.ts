import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentInstructionText, syncAgentInstructions } from './agentInstructions';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const directory=async()=>{const root=await mkdtemp(join(tmpdir(),'joinlet-agent-instructions-'));roots.push(root);return root;};
it('maintains both agent entry points without replacing human instructions and writes nothing twice',async()=>{
 const root=await directory(),manual='# Team rules\n\nUse our test runner.\n';
 await writeFile(join(root,'AGENTS.md'),manual);
 expect((await syncAgentInstructions(root)).changed).toEqual(['AGENTS.md','CLAUDE.md']);
 const text=await readFile(join(root,'AGENTS.md'),'utf8');
 expect(text.startsWith(manual)).toBe(true);expect(text).toContain('.arch/context/ARCHITECTURE.md');expect(text).toContain('.arch/context/llms.txt');
 expect(await readFile(join(root,'CLAUDE.md'),'utf8')).toContain('joinlet:knowledge-harness:start');
 expect(await syncAgentInstructions(root)).toEqual({changed:[],conflicts:[]});
 const edited=text+'\nAdditional author instructions.\n';await writeFile(join(root,'AGENTS.md'),edited);
 expect((await syncAgentInstructions(root)).changed).toEqual([]);expect(await readFile(join(root,'AGENTS.md'),'utf8')).toBe(edited);
});
it('preserves malformed markers and symbolic links as explicit conflicts',async()=>{
 const root=await directory(),outside=await directory(),broken='# Rules\n<!-- joinlet:knowledge-harness:start -->\n';
 await writeFile(join(root,'AGENTS.md'),broken);await writeFile(join(outside,'rules.md'),'Outside instructions');await symlink(join(outside,'rules.md'),join(root,'CLAUDE.md'));
 expect(await syncAgentInstructions(root)).toEqual({changed:[],conflicts:['AGENTS.md','CLAUDE.md']});
 expect(await readFile(join(root,'AGENTS.md'),'utf8')).toBe(broken);expect(await readFile(join(outside,'rules.md'),'utf8')).toBe('Outside instructions');
 expect(agentInstructionText('<!-- joinlet:knowledge-harness:end --><!-- joinlet:knowledge-harness:start -->')).toBeNull();
});
