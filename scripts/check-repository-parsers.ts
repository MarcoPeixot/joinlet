import assert from 'node:assert/strict';
import {parseSource} from '../packages/workspace/src/repository/syntax.ts';
import {syntaxFixtures} from '../packages/workspace/src/repository/syntaxFixtures.ts';
for(const [extension,text,expected,line] of syntaxFixtures){
 const result=await parseSource('probe.'+extension,text);
 assert(result.imports.some(ref=>ref.name===expected&&ref.line===line),`Parser failed: ${extension}`);
}
console.log(`${syntaxFixtures.length} syntax probes passed on ${process.versions.bun?'Bun':'Node'}.`);
