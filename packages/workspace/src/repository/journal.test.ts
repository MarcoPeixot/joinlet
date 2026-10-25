import {it,expect,vi} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createFsAdapter} from '../fs';
import {journaledBatch} from './journal';

it('recovers an interrupted filesystem batch after reopening and preserves later human edits',async()=>{
 const root=await mkdtemp(join(tmpdir(),'joinlet-recovery-')),config=await mkdtemp(join(tmpdir(),'joinlet-recovery-config-'));
 vi.stubEnv('STRUKT_CONFIG_DIR',config);
 try {
  const adapter=createFsAdapter(root);await adapter.write('a','old');await adapter.write('b','old');
  const interrupted=journaledBatch(adapter,root,async path=>{if(path===join(root,'b'))throw Error('interrupted');});
  await expect(interrupted([{path:'a',text:'new',expected:'old'},{path:'b',text:'new',expected:'old'}])).rejects.toThrow('interrupted');
  expect(await readFile(join(root,'a'),'utf8')).toBe('new');
  await createFsAdapter(root).recover();expect(await adapter.read('a')).toBe('old');expect(await adapter.read('b')).toBe('old');
  await expect(interrupted([{path:'a',text:'new',expected:'old'},{path:'b',text:'new',expected:'old'}])).rejects.toThrow();
  await writeFile(join(root,'a'),'human');
  await expect(createFsAdapter(root).recover()).rejects.toThrow('external edit');
  expect(await adapter.read('a')).toBe('human');
 } finally {vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});await rm(config,{recursive:true,force:true});}
});
