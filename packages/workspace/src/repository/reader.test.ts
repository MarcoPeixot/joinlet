import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localReader} from './reader';
it('honors nested ignore rules without Git and invalidates them when changed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'joinlet-ignore-'));
 try {
  await mkdir(join(root,'src'));await writeFile(join(root,'.gitignore'),'private/\n*.secret\n');
  await writeFile(join(root,'src','.gitignore'),'generated.ts\n');await writeFile(join(root,'src','generated.ts'),'private source');await writeFile(join(root,'src','api.ts'),'public source');await writeFile(join(root,'token.secret'),'secret');
  const reader=await localReader(root,{incremental:true});
  expect((await reader.list()).map(e=>e.path)).toContain('src/api.ts');
  expect((await reader.list()).map(e=>e.path)).not.toContain('src/generated.ts');
  expect((await reader.list()).map(e=>e.path)).not.toContain('token.secret');
  await writeFile(join(root,'src','.gitignore'),'api.ts\n');reader.invalidate('src/.gitignore');
  const paths=(await reader.list()).map(e=>e.path);expect(paths).toContain('src/generated.ts');expect(paths).not.toContain('src/api.ts');
 } finally {await rm(root,{recursive:true,force:true});}
});
