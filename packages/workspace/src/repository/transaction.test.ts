import { describe,expect,it } from 'vitest';
import { createMemoryAdapter } from '../storage';
import { writeBatch } from './transaction';

describe('architecture batch coordination',()=>{
 it('checks every expected file before writing any file',async()=>{
  const adapter=createMemoryAdapter({a:'old',b:'human'});
  await expect(writeBatch(adapter,[{path:'a',expected:'old',text:'new'},{path:'b',expected:'old',text:'new'}])).rejects.toThrow('changed');
  expect(await adapter.read('a')).toBe('old');expect(await adapter.read('b')).toBe('human');
 });
 it('rolls back its partial batch while preserving a concurrent external edit',async()=>{
  const adapter=createMemoryAdapter({a:'old',b:'old'}),write=adapter.write;
  adapter.write=async(path,text)=>{if(path==='b'){await write('a','human');throw Error('write failed');}await write(path,text);};
  await expect(writeBatch(adapter,[{path:'a',expected:'old',text:'new'},{path:'b',expected:'old',text:'new'}])).rejects.toThrow('write failed');
  expect(await adapter.read('a')).toBe('human');expect(await adapter.read('b')).toBe('old');
 });
});
