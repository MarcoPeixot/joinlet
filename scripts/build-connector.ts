#!/usr/bin/env bun
import { mkdir, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';

const targets=process.argv.includes('--all')?['bun-darwin-arm64','bun-darwin-x64','bun-linux-x64','bun-linux-arm64','bun-windows-x64']:[`bun-${process.platform==='win32'?'windows':process.platform}-${process.arch}`];
for(const target of targets){
 const directory=resolve('dist/connectors',target);await mkdir(directory,{recursive:true});
 const filename=join(directory,target.includes('windows')?'joinlet.exe':'joinlet');
 const result=Bun.spawn(['bun','build','--compile',`--target=${target}`,'apps/cli/src/main.ts','--outfile',filename],{stdout:'inherit',stderr:'inherit'});if(await result.exited!==0)throw Error(`Could not build connector ${target}.`);
 await cp('packages/workspace/parsers',join(directory,'parsers'),{recursive:true});
 await cp('packages/layout/node_modules/elkjs/lib/elk-worker.min.js',join(directory,'elk-worker.js'));
 await cp('docs/third-party',join(directory,'docs/third-party'),{recursive:true});
 await rm(join(directory,'web'),{recursive:true,force:true});
 await cp('apps/web/dist',join(directory,'web'),{recursive:true});
 for(const file of ['LICENSE','THIRD_PARTY_NOTICES.md','TRADEMARKS.md','SOURCE.md'])await cp(file,join(directory,file));
 await writeFile(join(directory,'README.txt'),'Joinlet connector\n\nAdd this directory to PATH, then run:\n  joinlet connect\n\nFor an authenticated Cloud workspace, use the pairing command shown in the repository panel. Keep the connector running. Credentials and caches are stored outside Git. The web and parsers directories and elk-worker.js must remain next to the executable.\n\nSource: https://github.com/MarcoPeixot/joinlet\nLicense: AGPL-3.0-only\n');
 const archive=directory+'.tar.gz';
 const pack=Bun.spawn(['tar','-czf',archive,'-C',dirname(directory),basename(directory)],{stdout:'inherit',stderr:'inherit'});if(await pack.exited!==0)throw Error('Could not package connector.');
 const checksum=new Bun.CryptoHasher('sha256').update(await readFile(archive)).digest('hex');
 await writeFile(archive+'.sha256',checksum+'  '+basename(archive)+'\n');
 console.log(`Joinlet connector prepared: ${archive}`);
}
