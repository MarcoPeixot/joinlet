import {expect,test} from 'bun:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {checkLinks} from '../apps/web/build/checkLinks';
test('local links honor source projections, Markdown syntax and HTML assets',async()=>{
 const root=await mkdtemp(join(tmpdir(),'joinlet-links-'));
 try{
  await mkdir(join(root,'.arch/docs'),{recursive:true});await mkdir(join(root,'docs'));
  await writeFile(join(root,'.arch/strukt.json'),JSON.stringify({docs:[{slug:'guide',source:'docs/guide.md'}]}));
  await writeFile(join(root,'README.md'),'[Guide](docs/guide.md)\n<img src="image.svg">\n```md\n[Not a link](absent)\n```\n[External](https://example.com/404)');
  await writeFile(join(root,'docs/guide.md'),'[Root](../README.md)');await writeFile(join(root,'.arch/docs/guide.md'),'[Root](../README.md)');await writeFile(join(root,'image.svg'),'<svg/>');
  expect(await checkLinks(root,['README.md','docs/guide.md','.arch/docs/guide.md'])).toEqual([]);
  await writeFile(join(root,'docs/broken.md'),'[Missing](absent.md)\n![Missing asset](absent.svg)');expect(await checkLinks(root,['docs/broken.md'])).toHaveLength(2);
 }finally{await rm(root,{recursive:true,force:true});}
});
